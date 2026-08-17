// Configuración de la integración con CRM externo (Fase 5). Protegido por requireAuth.
import express, { Router } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { sendTestIntegration } from "../lib/integrations.js";
import { markPurchase } from "../lib/purchase.js";
import { encryptSecret, decryptSecret } from "../lib/crypto.js";
import {
  normalizeKommoBase, kommoLead, kommoContactPhone, kommoStatusName,
  isWonStageName, extractRefFromText, KOMMO_WON_STATUS_ID,
} from "../lib/kommo.js";

export const integrationsRouter = Router();
// Webhook ENTRANTE (público, sin Bearer): lo llama el CRM externo (Kommo) al cerrar una venta.
export const inboundIntegrationsRouter = Router();

const APP_BASE_URL = (process.env.APP_BASE_URL ?? "http://localhost:4000").replace(/\/$/, "");

// URL lista para pegar en el Salesbot de Kommo (incluye el token opaco del usuario).
const inboundPurchaseUrl = (token: string | null) =>
  token ? `${APP_BASE_URL}/api/integrations/inbound/purchase?token=${token}` : null;
// URL del webhook NATIVO de Kommo (estilo ScaleOS): se pega en Kommo → Configuración → Webhooks,
// con los eventos "Etapa del lead modificada" + "Mensaje entrante". Mismo token opaco.
const kommoWebhookUrl = (token: string | null) =>
  token ? `${APP_BASE_URL}/api/integrations/inbound/kommo?token=${token}` : null;

async function ensureIntegration(userId: string) {
  const existing = await prisma.integration.findUnique({ where: { userId } });
  const integ = existing ?? (await prisma.integration.create({ data: { userId } }));
  // Genera el token del webhook entrante la primera vez (para el Purchase desde Kommo).
  if (!integ.inboundToken) {
    return prisma.integration.update({
      where: { userId },
      data: { inboundToken: crypto.randomBytes(24).toString("hex") },
    });
  }
  return integ;
}

// GET /api/integrations — configuración actual.
integrationsRouter.get("/", async (req, res) => {
  const i = await ensureIntegration(req.userId!);
  return res.json({
    integration: {
      mode: i.mode,
      webhookUrl: i.webhookUrl,
      secret: i.secret,
      onLead: i.onLead,
      onPurchase: i.onPurchase,
      enabled: i.enabled,
      // Webhook entrante (Kommo → Publi.lat) para disparar el Purchase al cerrar la venta.
      inboundPurchaseUrl: inboundPurchaseUrl(i.inboundToken),
      // Integración Kommo nativa (estilo ScaleOS): URL + token de la API del cliente + webhook.
      kommoBaseUrl: i.kommoBaseUrl,
      kommoTokenSet: Boolean(i.kommoToken),
      kommoWebhookUrl: kommoWebhookUrl(i.inboundToken),
    },
  });
});

const putSchema = z.object({
  mode: z.enum(["nativo", "webhook", "kommo"]).optional(),
  webhookUrl: z.string().url().nullable().optional(),
  secret: z.string().max(200).nullable().optional(),
  onLead: z.boolean().optional(),
  onPurchase: z.boolean().optional(),
  enabled: z.boolean().optional(),
  kommoBaseUrl: z.string().max(200).nullable().optional(),
  kommoToken: z.string().max(4000).nullable().optional(),
});

// PUT /api/integrations — actualiza la configuración.
integrationsRouter.put("/", async (req, res) => {
  const parsed = putSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Input inválido", details: parsed.error.flatten() });
  }
  const { kommoBaseUrl, kommoToken, ...rest } = parsed.data;
  const data: Record<string, unknown> = { ...rest };
  // URL de Kommo: solo dominios *.kommo.com (guard SSRF — la escribe el usuario a mano).
  if (kommoBaseUrl !== undefined) {
    if (kommoBaseUrl === null || kommoBaseUrl.trim() === "") data.kommoBaseUrl = null;
    else {
      const normalized = normalizeKommoBase(kommoBaseUrl);
      if (!normalized) return res.status(400).json({ error: "La URL de Kommo debe ser https://<tu-subdominio>.kommo.com" });
      data.kommoBaseUrl = normalized;
    }
  }
  // Token de larga duración de Kommo: cifrado en reposo (como el capiToken del pixel).
  if (kommoToken !== undefined) {
    data.kommoToken = kommoToken && kommoToken.trim() !== "" ? encryptSecret(kommoToken.trim()) : null;
  }
  await ensureIntegration(req.userId!);
  const i = await prisma.integration.update({
    where: { userId: req.userId! },
    data,
  });
  return res.json({
    integration: {
      mode: i.mode, webhookUrl: i.webhookUrl, secret: i.secret,
      onLead: i.onLead, onPurchase: i.onPurchase, enabled: i.enabled,
      kommoBaseUrl: i.kommoBaseUrl, kommoTokenSet: Boolean(i.kommoToken),
      kommoWebhookUrl: kommoWebhookUrl(i.inboundToken),
    },
  });
});

// POST /api/integrations/test — dispara un webhook de prueba.
integrationsRouter.post("/test", async (req, res) => {
  try {
    const status = await sendTestIntegration(req.userId!);
    return res.json({ ok: status >= 200 && status < 300, status });
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Falló el test" });
  }
});

// Extrae el monto de formatos varios ("15.000", "15000,50", "Gs 15000") -> número.
export function parseInboundAmount(raw: unknown): number {
  if (typeof raw === "number") return raw;
  let s = String(raw ?? "").replace(/[^\d.,]/g, "");
  if (!s) return NaN;
  if (s.includes(",")) {
    // Coma = decimal (es-AR/PY); los puntos son separadores de miles.
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    // Solo puntos en grupos de 3 (ej "15.000", "1.234.567") = separador de miles.
    s = s.replace(/\./g, "");
  }
  // Cualquier otro caso con un punto (ej "15.5") queda como decimal.
  return Number(s);
}

// Normaliza el código de referencia (el `ref:` que viaja en el mensaje de WhatsApp).
export function normalizeRef(raw: unknown): string {
  return String(raw ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const inboundSchema = z.object({
  ref: z.union([z.string(), z.number()]).optional(),
  code: z.union([z.string(), z.number()]).optional(),
  external_id: z.string().optional(),
  externalId: z.string().optional(),
  // Teléfono: la forma SIMPLE de vincular Kommo (casi todos los CRM tienen el número a mano,
  // pero no el código). Si no viene ref/code, matcheamos por teléfono.
  phone: z.union([z.string(), z.number()]).optional(),
  telefono: z.union([z.string(), z.number()]).optional(),
  tel: z.union([z.string(), z.number()]).optional(),
  amount: z.union([z.string(), z.number()]).optional(),
  value: z.union([z.string(), z.number()]).optional(),
  monto: z.union([z.string(), z.number()]).optional(),
  currency: z.string().optional(),
  moneda: z.string().optional(),
});

// POST /api/integrations/inbound/purchase?token=... — el CRM externo (Kommo) avisa una venta
// cerrada. Matcheamos el contacto por `ref` (código, lo más preciso) O por `phone` (lo más simple
// para Kommo: casi todos tienen el número), y disparamos el Purchase a Meta con el mismo
// external_id/fbp/fbc + monto. Idempotente por contacto (si ya es COMPRO, no re-dispara).
inboundIntegrationsRouter.post("/purchase", async (req, res) => {
  const token = String(req.query.token ?? req.headers["x-publilat-token"] ?? "").trim();
  if (!token) return res.status(401).json({ error: "Falta el token." });
  const integ = await prisma.integration.findUnique({ where: { inboundToken: token } });
  if (!integ) return res.status(401).json({ error: "Token inválido." });

  const parsed = inboundSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Input inválido." });
  const b = parsed.data;

  const ref = normalizeRef(b.ref ?? b.code ?? b.external_id ?? b.externalId);
  const phoneDigits = String(b.phone ?? b.telefono ?? b.tel ?? "").replace(/\D/g, "");
  if (!ref && !phoneDigits) return res.status(400).json({ error: "Falta el ref/code o el teléfono de la venta." });
  const amount = parseInboundAmount(b.amount ?? b.value ?? b.monto);
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "Monto inválido." });
  const currency = String(b.currency ?? b.moneda ?? "ARS").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3) || "ARS";

  // Buscamos el contacto dentro de la cuenta del token, en este orden de PRECISIÓN:
  //   1) por el código (ref) — el más preciso (ata la venta al clic del anuncio).
  //   2) por external_id completo (UUID), si vino.
  //   3) por TELÉFONO — la forma simple para Kommo: exacto, y si no, por los últimos 8 dígitos
  //      (tolera que Kommo mande el número con/sin el 9, país o área). Agarra el más reciente.
  let contact = ref
    ? await prisma.contact.findFirst({ where: { userId: integ.userId, code: ref }, orderBy: { createdAt: "desc" } })
    : null;
  if (!contact && (b.external_id || b.externalId)) {
    contact = await prisma.contact.findFirst({ where: { userId: integ.userId, externalId: String(b.external_id ?? b.externalId) } });
  }
  if (!contact && phoneDigits) {
    contact = await prisma.contact.findFirst({ where: { userId: integ.userId, phone: phoneDigits }, orderBy: { createdAt: "desc" } });
    if (!contact && phoneDigits.length >= 8) {
      const tail = phoneDigits.slice(-8);
      contact = await prisma.contact.findFirst({ where: { userId: integ.userId, phone: { endsWith: tail } }, orderBy: { createdAt: "desc" } });
    }
  }
  if (!contact) return res.status(404).json({ error: "No se encontró un contacto con ese ref/teléfono.", ...(ref ? { ref } : {}), ...(phoneDigits ? { phone: phoneDigits } : {}) });

  // Idempotencia: si ya se marcó la compra, no re-disparamos (Meta igual deduplica por eventId).
  if (contact.stage === "COMPRO") {
    return res.json({ ok: true, alreadyPurchased: true, contactId: contact.id });
  }

  const result = await markPurchase(integ.userId, contact.id, amount, currency);
  if (!result) return res.status(404).json({ error: "Contacto no encontrado." });
  return res.json({ ok: result.ok, purchaseSent: result.ok, error: result.error, contactId: contact.id });
});

// ============================ WEBHOOK NATIVO DE KOMMO (estilo ScaleOS) ============================
// POST /api/integrations/inbound/kommo?token=... — recibe los webhooks NATIVOS de Kommo (form-
// urlencoded anidado). El cliente solo pega esta URL en Kommo → Configuración → Webhooks y tilda:
//   • "Etapa del lead modificada" → si la etapa es GANADA (id 142 universal, o nombre tipo
//     ganado/compró/venta/won/aprobado), registramos la venta con el `price` del lead y disparamos
//     el Purchase a Meta con la atribución del clic. Idempotente (contacto ya COMPRO = no-op).
//   • "Mensaje entrante" → si el texto trae el `ref:CODIGO` del /go, atamos el lead de Kommo al
//     contacto nuestro (KommoLink) y le completamos el teléfono vía la API de Kommo. Así la venta
//     matchea aunque el WhatsApp lo atienda Kommo y nunca veamos el inbound.
// Kommo exige responder < 2 segundos → ACK inmediato y el procesamiento sigue en background.

// Normaliza a array lo que qs puede parsear como array u objeto de índices ("0","1",…).
function toArray(v: unknown): Record<string, unknown>[] {
  if (Array.isArray(v)) return v as Record<string, unknown>[];
  if (v && typeof v === "object") return Object.values(v) as Record<string, unknown>[];
  return [];
}

// Matchea un contacto nuestro por teléfono (exacto y por los últimos 8 dígitos, igual que
// /inbound/purchase: tolera el número con/sin 9, país o área).
async function findContactByPhone(userId: string, phoneDigits: string) {
  if (!phoneDigits) return null;
  let contact = await prisma.contact.findFirst({ where: { userId, phone: phoneDigits }, orderBy: { createdAt: "desc" } });
  if (!contact && phoneDigits.length >= 8) {
    const tail = phoneDigits.slice(-8);
    contact = await prisma.contact.findFirst({ where: { userId, phone: { endsWith: tail } }, orderBy: { createdAt: "desc" } });
  }
  return contact;
}

type KommoCreds = { baseUrl: string; token: string } | null;
function kommoCreds(integ: { kommoBaseUrl: string | null; kommoToken: string | null }): KommoCreds {
  if (!integ.kommoBaseUrl || !integ.kommoToken) return null;
  try {
    return { baseUrl: integ.kommoBaseUrl, token: decryptSecret(integ.kommoToken) };
  } catch {
    return null; // token indescifrable: seguimos sin API (el ref-link igual funciona)
  }
}

// Procesa los eventos de MENSAJE ENTRANTE: captura el ref y ata el lead de Kommo al contacto.
async function processKommoMessages(userId: string, creds: KommoCreds, events: Record<string, unknown>[]): Promise<void> {
  for (const m of events) {
    if (String(m.type ?? "") !== "incoming") continue; // solo lo que escribe el cliente
    const ref = extractRefFromText(String(m.text ?? ""));
    if (!ref) continue;
    const contact = await prisma.contact.findFirst({ where: { userId, code: ref }, orderBy: { createdAt: "desc" } });
    if (!contact) continue;
    const kommoLeadId = String(m.entity_id ?? m.element_id ?? "");
    const kommoContactId = String(m.contact_id ?? "") || null;
    if (kommoLeadId) {
      await prisma.kommoLink.upsert({
        where: { userId_kommoLeadId: { userId, kommoLeadId } },
        create: { userId, kommoLeadId, kommoContactId, contactId: contact.id },
        update: { kommoContactId, contactId: contact.id },
      });
    }
    // Enriquecemos el teléfono (solo si no lo teníamos: acá el inbound de WhatsApp no pasa por nosotros).
    if (!contact.phone && creds && kommoContactId) {
      const phone = await kommoContactPhone(creds.baseUrl, creds.token, kommoContactId);
      if (phone) {
        await prisma.contact.update({ where: { id: contact.id }, data: { phone } }).catch(() => undefined);
      }
    }
    console.log(`[kommo] ref ${ref} atado al lead ${kommoLeadId || "?"} (contacto ${contact.id})`);
  }
}

// Procesa los eventos de CAMBIO DE ETAPA: etapa ganada -> venta -> Purchase a Meta.
async function processKommoStatus(userId: string, creds: KommoCreds, events: Record<string, unknown>[]): Promise<void> {
  for (const s of events) {
    const kommoLeadId = String(s.id ?? "");
    if (!kommoLeadId) continue;
    const statusId = Number(s.status_id ?? 0);
    let won = statusId === KOMMO_WON_STATUS_ID; // 142 = "Closed - won" universal de Kommo
    let stageName: string | null = null;
    if (!won && creds && statusId) {
      stageName = await kommoStatusName(creds.baseUrl, creds.token, String(s.pipeline_id ?? ""), String(statusId));
      won = stageName ? isWonStageName(stageName) : false;
    }
    if (!won) {
      console.log(`[kommo] lead ${kommoLeadId} -> etapa "${stageName ?? statusId}" (no es ganada, se ignora)`);
      continue;
    }
    console.log(`[kommo] lead ${kommoLeadId} -> etapa GANADA "${stageName ?? statusId}"`);

    // Monto: el price viene en el propio webhook; si falta, lo pedimos a la API.
    let amount = parseInboundAmount(s.price);
    if ((!Number.isFinite(amount) || amount <= 0) && creds) {
      const lead = await kommoLead(creds.baseUrl, creds.token, kommoLeadId);
      if (lead) amount = lead.price;
    }

    // Contacto nuestro: 1) por el vínculo ref→lead (lo más preciso), 2) por teléfono vía la API.
    let contactId: string | null = null;
    const link = await prisma.kommoLink.findUnique({ where: { userId_kommoLeadId: { userId, kommoLeadId } } });
    if (link) contactId = link.contactId;
    if (!contactId && creds) {
      const lead = await kommoLead(creds.baseUrl, creds.token, kommoLeadId);
      for (const cId of lead?.contactIds ?? []) {
        const phone = await kommoContactPhone(creds.baseUrl, creds.token, cId);
        const contact = phone ? await findContactByPhone(userId, phone) : null;
        if (contact) {
          contactId = contact.id;
          // Dejamos el vínculo armado para los próximos eventos de este lead.
          await prisma.kommoLink.upsert({
            where: { userId_kommoLeadId: { userId, kommoLeadId } },
            create: { userId, kommoLeadId, kommoContactId: cId, contactId: contact.id },
            update: { kommoContactId: cId, contactId: contact.id },
          }).catch(() => undefined);
          break;
        }
      }
    }
    if (!contactId) { console.log(`[kommo] etapa ganada del lead ${kommoLeadId} SIN contacto matcheado (sin ref ni teléfono)`); continue; }

    const contact = await prisma.contact.findUnique({ where: { id: contactId } });
    if (!contact || contact.userId !== userId) continue;
    if (contact.stage === "COMPRO") continue; // idempotente: ya registrada
    if (!Number.isFinite(amount) || amount <= 0) {
      console.log(`[kommo] lead ${kommoLeadId} ganado pero SIN monto (price vacío en Kommo) — no se manda Purchase`);
      continue;
    }
    const result = await markPurchase(userId, contact.id, amount, "ARS");
    console.log(`[kommo] venta del lead ${kommoLeadId}: $${amount} -> Purchase ${result?.ok ? "ENVIADO" : `falló (${result?.error ?? "?"})`}`);
  }
}

// Los webhooks nativos de Kommo llegan como application/x-www-form-urlencoded con claves anidadas
// (leads[status][0][id]=...) — extended:true los convierte en objetos.
inboundIntegrationsRouter.post("/kommo", express.urlencoded({ extended: true, limit: "1mb" }), async (req, res) => {
  const token = String(req.query.token ?? "").trim();
  if (!token) return res.status(401).json({ error: "Falta el token." });
  const integ = await prisma.integration.findUnique({ where: { inboundToken: token } });
  if (!integ) return res.status(401).json({ error: "Token inválido." });

  // ACK YA (Kommo exige < 2s y reintenta si no; nuestras consultas a su API pueden tardar más).
  res.json({ ok: true });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const leads = (body.leads ?? {}) as Record<string, unknown>;
  const message = (body.message ?? {}) as Record<string, unknown>;
  const creds = kommoCreds(integ);
  const statusEvents = toArray(leads.status);
  const messageEvents = toArray(message.add);
  // Visibilidad: un renglón por webhook (sin esto, un evento ignorado no deja rastro y el debug es a ciegas).
  const otros = Object.keys(body).filter((k) => k !== "leads" && k !== "message" && k !== "account");
  console.log(`[kommo] webhook (user ${integ.userId}): ${statusEvents.length} etapa(s), ${messageEvents.length} mensaje(s)${otros.length ? `, otros: ${otros.join(",")}` : ""}`);
  void (async () => {
    await processKommoMessages(integ.userId, creds, messageEvents);
    await processKommoStatus(integ.userId, creds, statusEvents);
  })().catch((e) => console.error("[kommo] error procesando webhook:", e instanceof Error ? e.message : e));
});
