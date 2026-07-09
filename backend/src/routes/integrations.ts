// Configuración de la integración con CRM externo (Fase 5). Protegido por requireAuth.
import { Router } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { sendTestIntegration } from "../lib/integrations.js";
import { markPurchase } from "../lib/purchase.js";

export const integrationsRouter = Router();
// Webhook ENTRANTE (público, sin Bearer): lo llama el CRM externo (Kommo) al cerrar una venta.
export const inboundIntegrationsRouter = Router();

const APP_BASE_URL = (process.env.APP_BASE_URL ?? "http://localhost:4000").replace(/\/$/, "");

// URL lista para pegar en el Salesbot de Kommo (incluye el token opaco del usuario).
const inboundPurchaseUrl = (token: string | null) =>
  token ? `${APP_BASE_URL}/api/integrations/inbound/purchase?token=${token}` : null;

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
});

// PUT /api/integrations — actualiza la configuración.
integrationsRouter.put("/", async (req, res) => {
  const parsed = putSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Input inválido", details: parsed.error.flatten() });
  }
  await ensureIntegration(req.userId!);
  const i = await prisma.integration.update({
    where: { userId: req.userId! },
    data: parsed.data,
  });
  return res.json({
    integration: {
      mode: i.mode, webhookUrl: i.webhookUrl, secret: i.secret,
      onLead: i.onLead, onPurchase: i.onPurchase, enabled: i.enabled,
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
  amount: z.union([z.string(), z.number()]).optional(),
  value: z.union([z.string(), z.number()]).optional(),
  monto: z.union([z.string(), z.number()]).optional(),
  currency: z.string().optional(),
  moneda: z.string().optional(),
});

// POST /api/integrations/inbound/purchase?token=... — el CRM externo (Kommo) avisa una venta
// cerrada. Matcheamos el contacto por el `ref` (código que viajó en el mensaje) y disparamos
// el Purchase a Meta con el MISMO external_id/fbp/fbc + monto. Idempotente por contacto.
inboundIntegrationsRouter.post("/purchase", async (req, res) => {
  const token = String(req.query.token ?? req.headers["x-publilat-token"] ?? "").trim();
  if (!token) return res.status(401).json({ error: "Falta el token." });
  const integ = await prisma.integration.findUnique({ where: { inboundToken: token } });
  if (!integ) return res.status(401).json({ error: "Token inválido." });

  const parsed = inboundSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Input inválido." });
  const b = parsed.data;

  const ref = normalizeRef(b.ref ?? b.code ?? b.external_id ?? b.externalId);
  if (!ref) return res.status(400).json({ error: "Falta el ref/code de la venta." });
  const amount = parseInboundAmount(b.amount ?? b.value ?? b.monto);
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "Monto inválido." });
  const currency = String(b.currency ?? b.moneda ?? "ARS").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3) || "ARS";

  // Buscamos el contacto por el código dentro de la cuenta del token. Si el ref viene con el
  // external_id completo (UUID), también probamos por externalId.
  let contact = await prisma.contact.findFirst({
    where: { userId: integ.userId, code: ref },
    orderBy: { createdAt: "desc" },
  });
  if (!contact && (b.external_id || b.externalId)) {
    contact = await prisma.contact.findFirst({ where: { userId: integ.userId, externalId: String(b.external_id ?? b.externalId) } });
  }
  if (!contact) return res.status(404).json({ error: "No se encontró un contacto con ese ref.", ref });

  // Idempotencia: si ya se marcó la compra, no re-disparamos (Meta igual deduplica por eventId).
  if (contact.stage === "COMPRO") {
    return res.json({ ok: true, alreadyPurchased: true, contactId: contact.id });
  }

  const result = await markPurchase(integ.userId, contact.id, amount, currency);
  if (!result) return res.status(404).json({ error: "Contacto no encontrado." });
  return res.json({ ok: result.ok, purchaseSent: result.ok, error: result.error, contactId: contact.id });
});
