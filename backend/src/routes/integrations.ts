// Configuración de la integración con CRM externo (Fase 5). Protegido por requireAuth.
import express, { Router } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { emitToUser } from "../lib/io.js";
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
// Webhook de Meta Lead Ads (formularios): es ÚNICO para toda la plataforma (Meta lo llama por Page,
// y el page_id mapea a la cuenta). Se pega en la app de Meta → Webhooks → Página → campo "leadgen".
const LEADGEN_WEBHOOK_URL = `${APP_BASE_URL}/api/webhooks/leadgen`;
const LEADGEN_VERIFY_TOKEN = process.env.META_LEADGEN_VERIFY_TOKEN ?? "";

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
      // Formularios de Meta (Lead Ads): captura del lead + respuesta automática por WhatsApp.
      metaPageId: i.metaPageId,
      metaPageTokenSet: Boolean(i.metaPageToken),
      leadgenEnabled: i.leadgenEnabled,
      leadgenLineId: i.leadgenLineId,
      leadgenReply: i.leadgenReply,
      leadgenReplies: i.leadgenReplies ?? [],
      leadgenWebhookUrl: LEADGEN_WEBHOOK_URL,
      leadgenVerifyToken: LEADGEN_VERIFY_TOKEN,
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
  // Formularios de Meta (Lead Ads)
  metaPageId: z.string().max(60).nullable().optional(),
  metaPageToken: z.string().max(600).nullable().optional(),
  leadgenEnabled: z.boolean().optional(),
  leadgenLineId: z.string().max(40).nullable().optional(),
  leadgenReply: z.string().max(1000).nullable().optional(),
  // Variantes rotativas de la auto-respuesta: texto o audio de la biblioteca (máx. 10).
  leadgenReplies: z.array(z.union([
    z.object({ kind: z.literal("text"), body: z.string().min(1).max(1000) }),
    z.object({ kind: z.literal("audio"), clipId: z.string().min(1).max(40) }),
  ])).max(10).nullable().optional(),
});

// PUT /api/integrations — actualiza la configuración.
integrationsRouter.put("/", async (req, res) => {
  const parsed = putSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Input inválido", details: parsed.error.flatten() });
  }
  const { kommoBaseUrl, kommoToken, metaPageId, metaPageToken, ...rest } = parsed.data;
  const data: Record<string, unknown> = { ...rest };
  // Page de Meta: solo dígitos (el id de la Page). Vacío = desvincular.
  if (metaPageId !== undefined) {
    const digits = (metaPageId ?? "").replace(/\D/g, "");
    data.metaPageId = digits || null;
  }
  // Page access token: cifrado en reposo (igual que el capiToken del pixel y el token de Kommo).
  if (metaPageToken !== undefined) {
    data.metaPageToken = metaPageToken && metaPageToken.trim() !== "" ? encryptSecret(metaPageToken.trim()) : null;
  }
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
      metaPageId: i.metaPageId, metaPageTokenSet: Boolean(i.metaPageToken),
      leadgenEnabled: i.leadgenEnabled, leadgenLineId: i.leadgenLineId, leadgenReply: i.leadgenReply,
      leadgenReplies: i.leadgenReplies ?? [],
      leadgenWebhookUrl: LEADGEN_WEBHOOK_URL, leadgenVerifyToken: LEADGEN_VERIFY_TOKEN,
    },
  });
});

// ---- Bienvenida automática de líneas QR (User.waQrWelcome*) ----
// Variantes rotativas (texto/audio) que se mandan solas al PRIMER mensaje de un contacto nuevo en
// las líneas Baileys/QR. El envío y el dedup viven en lib/flow-engine (maybeSendQrWelcome).
const qrWelcomeSchema = z.object({
  enabled: z.boolean().optional(),
  replies: z.array(z.union([
    z.object({ kind: z.literal("text"), body: z.string().min(1).max(1000) }),
    z.object({ kind: z.literal("audio"), clipId: z.string().min(1).max(40) }),
  ])).max(10).optional(),
});

integrationsRouter.get("/qr-welcome", async (req, res) => {
  const u = await prisma.user.findUnique({
    where: { id: req.userId! },
    select: { waQrWelcomeEnabled: true, waQrWelcomeReplies: true },
  });
  return res.json({ enabled: u?.waQrWelcomeEnabled ?? false, replies: u?.waQrWelcomeReplies ?? [] });
});

integrationsRouter.put("/qr-welcome", async (req, res) => {
  const parsed = qrWelcomeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido", details: parsed.error.flatten() });
  const data: Record<string, unknown> = {};
  if (parsed.data.enabled !== undefined) data.waQrWelcomeEnabled = parsed.data.enabled;
  if (parsed.data.replies !== undefined) data.waQrWelcomeReplies = parsed.data.replies;
  const u = await prisma.user.update({
    where: { id: req.userId! },
    data,
    select: { waQrWelcomeEnabled: true, waQrWelcomeReplies: true },
  });
  return res.json({ enabled: u.waQrWelcomeEnabled, replies: u.waQrWelcomeReplies ?? [] });
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

// "Línea Kommo" INERTE por cuenta: los mensajes espejados necesitan un lineId (Message.lineId es
// obligatorio) pero NO hay una línea de WhatsApp real. Creamos una con provider="kommo", NO conectada,
// phone vacío y sin expiresAt → la rotación de /go y el vencimiento de días la IGNORAN (pickLine exige
// connected:true + expiresAt futuro + phone no vacío). Es solo el contenedor del chat espejado.
async function ensureKommoLine(userId: string): Promise<string> {
  const existing = await prisma.waLine.findFirst({ where: { userId, provider: "kommo" }, select: { id: true } });
  if (existing) return existing.id;
  const line = await prisma.waLine.create({
    data: { userId, phone: "", label: "Kommo", provider: "kommo", connected: false, status: "active" },
    select: { id: true },
  });
  return line.id;
}

// Procesa los eventos de MENSAJE de Kommo: (1) ESPEJA el chat al Inbox de Publi.lat (contacto + mensaje +
// emit en vivo, para operar todo desde un solo panel) y (2) captura el ref para atar el lead a la
// atribución. Aditivo: los mensajes cuelgan de la línea Kommo inerte, NO tocan warmup/rotación/billing de
// las líneas reales. Nota: el webhook "Mensaje entrante" de Kommo trae el TEXTO (no la imagen), y solo los
// entrantes; el saliente (responder desde Publi.lat) es fase 2 (API de chat de Kommo + inbox.ts).
async function processKommoMessages(userId: string, creds: KommoCreds, events: Record<string, unknown>[]): Promise<void> {
  let kommoLineId: string | null = null;
  for (const m of events) {
    const type = String(m.type ?? "").toLowerCase();
    const direction = type === "incoming" ? "in" : type === "outgoing" ? "out" : null;
    if (!direction) continue; // solo mensajes de chat
    const text = String(m.text ?? "").trim();
    const kommoContactId = String(m.contact_id ?? "") || null;
    const kommoLeadId = String(m.entity_id ?? m.element_id ?? "");
    // Teléfono del contacto en Kommo (para matchear/crear el Contact en Publi.lat).
    const phone = creds && kommoContactId ? await kommoContactPhone(creds.baseUrl, creds.token, kommoContactId) : null;

    // Contacto: 1) por ref (atribución, solo entrantes), 2) por teléfono, 3) lo creamos (espejo).
    const ref = direction === "in" ? extractRefFromText(text) : null;
    let contact =
      (ref ? await prisma.contact.findFirst({ where: { userId, code: ref }, orderBy: { createdAt: "desc" } }) : null) ??
      (phone ? await prisma.contact.findFirst({ where: { userId, phone }, orderBy: { createdAt: "desc" } }) : null);
    if (!contact) {
      kommoLineId = kommoLineId ?? (await ensureKommoLine(userId));
      contact = await prisma.contact.create({
        data: { userId, externalId: crypto.randomUUID(), phone: phone ?? null, lineId: kommoLineId, source: "kommo", stage: "CONTACTADO" },
      });
    } else if (!contact.phone && phone) {
      await prisma.contact.update({ where: { id: contact.id }, data: { phone } }).catch(() => undefined);
    }

    // Atribución: atar el lead de Kommo al contacto (para el Purchase por ref).
    if (ref && kommoLeadId) {
      await prisma.kommoLink.upsert({
        where: { userId_kommoLeadId: { userId, kommoLeadId } },
        create: { userId, kommoLeadId, kommoContactId, contactId: contact.id },
        update: { kommoContactId, contactId: contact.id },
      }).catch(() => undefined);
      console.log(`[kommo] ref ${ref} atado al lead ${kommoLeadId || "?"} (contacto ${contact.id})`);
    }

    // ESPEJO del mensaje al Inbox: cuelga SIEMPRE de la línea Kommo inerte (no ensucia el cupo de warmup de
    // las líneas reales) y se emite en vivo, igual que el webhook de WhatsApp.
    if (!text) continue; // por ahora solo texto (el webhook de Kommo no manda la imagen del comprobante)
    kommoLineId = kommoLineId ?? (await ensureKommoLine(userId));
    const msg = await prisma.message.create({
      data: { contactId: contact.id, lineId: kommoLineId, direction, body: text },
      select: { id: true, createdAt: true },
    });
    emitToUser(userId, "inbox:message", {
      contactId: contact.id,
      message: { id: msg.id, direction, body: text, mediaUrl: null, createdAt: msg.createdAt },
    });
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

// ── Bot autoresponder por Salesbot de Kommo (widget_request) — SALIDA estilo ScaleOS ─────────────
// Kommo NO deja mandar por API a su WhatsApp nativo (amocrmwa); el ÚNICO puente es su Salesbot. En el paso
// "Widget" del Salesbot, Kommo pega a esta URL con { token(JWT), data, return_url }. Nosotros: (1) ACK <2s,
// (2) calculamos la respuesta, (3) CONTINUAMOS el bot posteando a return_url los handlers "show" → Kommo
// manda esos mensajes por el WhatsApp del cliente. Así el bot contesta SIN que Publi.lat sea el gateway de
// WhatsApp (Kommo sigue siendo el transporte; el WhatsApp no se mueve). Público: lo llama el Salesbot.
inboundIntegrationsRouter.post("/kommo-bot", express.json({ limit: "1mb" }), express.urlencoded({ extended: true, limit: "1mb" }), async (req, res) => {
  const token = String(req.query.token ?? "").trim();
  const integ = token ? await prisma.integration.findUnique({ where: { inboundToken: token } }) : null;
  if (!integ) return res.status(401).json({ error: "Token inválido." });

  const body = (req.body ?? {}) as Record<string, unknown>;
  // TEMP (debug): ver el formato EXACTO con el que Kommo llama al widget_request (content-type + payload).
  console.log(`[kommo-bot] ct=${req.get("content-type") ?? "?"} keys=${Object.keys(body).join(",")} raw=${JSON.stringify(body).slice(0, 700)}`);
  const data = (body.data ?? {}) as Record<string, unknown>;
  const returnUrl = String(body.return_url ?? "").trim();
  const incoming = String(data.message ?? data.text ?? "").trim();

  // ACK YA: Kommo corta el bot si no respondemos <2s. El continue va en background.
  res.json({ ok: true });

  if (!returnUrl) { console.warn(`[kommo-bot] user ${integ.userId}: sin return_url`); return; }
  // Guard SSRF: el return_url TIENE que ser del dominio Kommo del cliente (no un destino arbitrario).
  let ru: URL | null = null;
  try { ru = new URL(returnUrl); } catch { /* inválido */ }
  if (!ru || !/(^|\.)(kommo\.com|amocrm\.com)$/.test(ru.hostname)) {
    console.warn(`[kommo-bot] user ${integ.userId}: return_url sospechoso (${ru?.hostname ?? "inválido"}) — se descarta`);
    return;
  }

  void (async () => {
    const reply = await computeKommoBotReply(integ.userId, incoming);
    if (!reply) { console.log(`[kommo-bot] user ${integ.userId}: sin respuesta (bot mudo)`); return; }
    const creds = kommoCreds(integ);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (creds) headers.Authorization = "Bearer " + creds.token; // el continue vive en el dominio del cliente
    const payload = {
      data: {},
      execute_handlers: [{ handler: "show", params: { type: "text", value: reply } }],
    };
    const r = await fetch(returnUrl, { method: "POST", headers, body: JSON.stringify(payload) });
    console.log(`[kommo-bot] user ${integ.userId}: in(${incoming.length} chars) -> continue ${r.status}`);
  })().catch((e) => console.error("[kommo-bot] error:", e instanceof Error ? e.message : e));
});

// Respuesta del bot para un mensaje entrante que llega por el Salesbot de Kommo.
// MVP: usa el `botWelcome` de la cuenta (o un saludo por defecto) para PROBAR el circuito de punta a punta.
// Fase 2: enganchar el bot de carga/descarga real (runChatBot) con estado por conversación.
async function computeKommoBotReply(userId: string, _incoming: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { botWelcome: true, brandName: true } });
  const welcome = (u?.botWelcome ?? "").trim();
  if (welcome) return welcome;
  const marca = (u?.brandName ?? "").trim();
  return `¡Hola! 👋 Gracias por escribir${marca ? ` a ${marca}` : ""}. Ya te atendemos por acá. ¿Qué necesitás?`;
}
