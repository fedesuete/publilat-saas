// Webhook de Meta Lead Ads (formularios instantáneos): captura el lead en Publi.lat apenas se envía el
// formulario. FASE 1 = captura (Contact + LeadForm); la respuesta automática es FASE 2. Es PÚBLICO (Meta lo
// llama sin Bearer): la seguridad es el verify_token (GET) + que el page_id matchee una cuenta con leadgen
// prendido y token cargado. Aditivo: NO toca la atribución ni el flujo de WhatsApp.
import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { decryptSecret } from "../lib/crypto.js";
import { notify } from "../lib/notifications.js";
import { parseVariants, pickVariant, sendLeadVariant } from "../lib/leadgen-send.js";

export const leadgenRouter = Router();
const VERIFY_TOKEN = process.env.META_LEADGEN_VERIFY_TOKEN ?? "";

// GET — verificación del webhook (Meta manda hub.challenge al suscribir la Page).
leadgenRouter.get("/", (req: Request, res: Response) => {
  const mode = String(req.query["hub.mode"] ?? "");
  const token = String(req.query["hub.verify_token"] ?? "");
  const challenge = String(req.query["hub.challenge"] ?? "");
  if (mode === "subscribe" && VERIFY_TOKEN && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

// POST — evento de leadgen. Respondemos 200 YA (Meta reintenta si no) y procesamos async.
leadgenRouter.post("/", (req: Request, res: Response) => {
  res.sendStatus(200);
  void processLeadgen(req.body).catch((e) => console.error("[leadgen] error:", e instanceof Error ? e.message : String(e)));
});

interface LeadData { name: string | null; phone: string | null; email: string | null; answers: Array<{ q: string; a: string }> }

// Plantilla del mensaje automático: {{nombre}} (primer nombre), {{nombre_completo}}, {{email}} y
// {{respuesta}} (la 1ª respuesta que NO es un dato de contacto — suele ser "qué te interesa").
// Sin plantilla configurada NO se manda nada (la respuesta automática es opt-in por cuenta).
export function renderLeadReply(tpl: string, lead: LeadData): string {
  const full = (lead.name ?? "").trim();
  const first = full.split(/\s+/)[0] ?? "";
  const CONTACT_FIELDS = ["full_name", "name", "nombre", "nombre_completo", "phone_number", "phone", "telefono", "teléfono", "celular", "email", "correo"];
  const extra = lead.answers.find((x) => !CONTACT_FIELDS.includes((x.q ?? "").toLowerCase()) && (x.a ?? "").trim())?.a ?? "";
  return tpl
    .replace(/\{\{\s*nombre_completo\s*\}\}/gi, full)
    .replace(/\{\{\s*nombre\s*\}\}/gi, first)
    .replace(/\{\{\s*email\s*\}\}/gi, lead.email ?? "")
    .replace(/\{\{\s*respuesta\s*\}\}/gi, extra)
    .trim();
}

// Elige la línea desde la que se auto-responde: la configurada (si sigue activa) o, si no hay
// ninguna configurada, la línea activa menos usada. Elegible = conectada, activa y con día pagado
// vigente (mismo criterio que el redirector: sin día pagado no se manda nada).
async function pickLeadgenLine(userId: string, preferredId: string | null): Promise<string | null> {
  const base = { userId, connected: true, status: "active", NOT: { phone: "" }, expiresAt: { gt: new Date() } };
  if (preferredId) {
    const pinned = await prisma.waLine.findFirst({ where: { ...base, id: preferredId }, select: { id: true } });
    if (pinned) return pinned.id;
  }
  const any = await prisma.waLine.findFirst({ where: base, orderBy: { lastUsedAt: { sort: "asc", nulls: "first" } }, select: { id: true } });
  return any?.id ?? null;
}

// FASE 2 — respuesta automática por WhatsApp al lead del formulario. Best-effort: cualquier fallo
// queda logueado y NO rompe la captura (el lead ya está guardado). Requiere plantilla configurada,
// teléfono en el formulario y una línea con día pagado vigente.
async function autoReplyLead(
  integ: { userId: string; leadgenReply: string | null; leadgenReplies: unknown; leadgenLineId: string | null },
  contact: { id: string; phone: string | null; lineId: string | null },
  lead: LeadData,
): Promise<void> {
  // Variantes rotativas (texto/audio); si no hay, cae al mensaje único legacy. Sin nada = solo captura.
  const variants = parseVariants(integ.leadgenReplies);
  const legacy = integ.leadgenReply?.trim();
  if (!variants.length && !legacy) return; // opt-in: sin mensajes configurados no se escribe nada
  if (!contact.phone) { console.warn("[leadgen] lead sin teléfono, no se auto-responde"); return; }

  const lineId = contact.lineId ?? (await pickLeadgenLine(integ.userId, integ.leadgenLineId));
  if (!lineId) {
    console.warn(`[leadgen] user ${integ.userId} sin línea activa con día vigente → no se auto-responde`);
    await notify(integ.userId, "line_down", "No pudimos responder un lead de Meta",
      "Entró un lead de tu formulario de Meta pero no tenés ninguna línea de WhatsApp activa con días. Activá una línea para que la respuesta automática salga sola.").catch(() => undefined);
    return;
  }
  // El envío sale por la línea DEL CONTACTO: se la asignamos antes (el lead entra sin línea).
  if (contact.lineId !== lineId) {
    await prisma.contact.update({ where: { id: contact.id }, data: { lineId } }).catch(() => undefined);
  }
  // Elegimos UNA variante al azar (texto o audio). Legacy: si no hay variantes, el mensaje único.
  const variant = pickVariant(variants) ?? (legacy ? { kind: "text" as const, body: legacy } : null);
  if (!variant) return;
  const text = variant.kind === "text" ? renderLeadReply(variant.body, lead) : undefined;
  if (variant.kind === "text" && !text) return;
  const ok = await sendLeadVariant(integ.userId, contact.id, variant, text);
  if (ok) {
    console.log(`[leadgen] variante enviada: ${variant.kind}`);
    // Queda como CONTACTADO en el CRM (el operador ve que ya se le escribió).
    await prisma.contact.update({ where: { id: contact.id }, data: { stage: "CONTACTADO" } }).catch(() => undefined);
    console.log(`[leadgen] auto-respuesta enviada al contacto ${contact.id}`);
  } else {
    console.warn(`[leadgen] no se pudo enviar la auto-respuesta al contacto ${contact.id}`);
  }
}

// Trae los datos del lead por la Graph API (nombre + teléfono + TODAS las respuestas del formulario).
async function fetchLead(leadgenId: string, token: string): Promise<LeadData | null> {
  try {
    const r = await fetch(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(leadgenId)}?access_token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(9000) },
    );
    const d = (await r.json()) as { error?: unknown; field_data?: Array<{ name?: string; values?: string[] }> };
    if (!r.ok || d.error) { console.warn("[leadgen] fetch lead error:", JSON.stringify(d.error ?? d).slice(0, 160)); return null; }
    const fields = d.field_data ?? [];
    const pick = (names: string[]) => fields.find((f) => names.includes((f.name ?? "").toLowerCase()))?.values?.[0] ?? null;
    return {
      name: pick(["full_name", "name", "nombre", "nombre_completo"]),
      phone: pick(["phone_number", "phone", "telefono", "teléfono", "celular"]),
      email: pick(["email", "correo"]),
      answers: fields.map((f) => ({ q: f.name ?? "", a: (f.values ?? []).join(", ") })),
    };
  } catch (e) {
    console.warn("[leadgen] fetch lead fail:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

async function processLeadgen(body: unknown): Promise<void> {
  const entries = (body as { entry?: Array<{ id?: string; changes?: Array<{ field?: string; value?: { leadgen_id?: string; form_id?: string; ad_id?: string; page_id?: string } }> }> })?.entry ?? [];
  for (const entry of entries) {
    const entryPageId = String(entry.id ?? "");
    for (const change of entry.changes ?? []) {
      if (change.field !== "leadgen") continue;
      const v = change.value ?? {};
      const leadgenId = String(v.leadgen_id ?? "");
      const pageId = String(v.page_id ?? entryPageId);
      if (!pageId || !leadgenId) continue;
      // Idempotencia: Meta reenvía el webhook; si ya lo tenemos, salteamos.
      if (await prisma.leadForm.findUnique({ where: { leadgenId }, select: { id: true } })) continue;
      // Mapeo Page → cuenta (Integration con ese metaPageId, leadgen prendido y token cargado).
      const integ = await prisma.integration.findFirst({ where: { metaPageId: pageId, leadgenEnabled: true, metaPageToken: { not: null } } });
      if (!integ?.metaPageToken) { console.warn(`[leadgen] page ${pageId} sin cuenta con leadgen activo`); continue; }
      let token: string;
      try { token = decryptSecret(integ.metaPageToken); } catch { console.warn("[leadgen] token indescifrable"); continue; }
      const lead = await fetchLead(leadgenId, token);
      if (!lead) continue;
      const phone = lead.phone ? lead.phone.replace(/\D/g, "") : null;
      const adId = String(v.ad_id ?? "") || null;
      // Contacto: reusa el existente por teléfono, o lo crea (sin línea; la Fase 2 elige la línea).
      const existing = phone ? await prisma.contact.findFirst({ where: { userId: integ.userId, phone }, orderBy: { createdAt: "desc" } }) : null;
      const contact = existing ?? await prisma.contact.create({
        data: { userId: integ.userId, externalId: crypto.randomUUID(), phone, name: lead.name, source: "leadform", adId, stage: "NUEVO" },
      });
      await prisma.leadForm.create({
        data: { userId: integ.userId, contactId: contact.id, leadgenId, formId: String(v.form_id ?? "") || null, adId, answers: lead.answers },
      });
      console.log(`[leadgen] lead capturado ${leadgenId} → contacto ${contact.id} (${lead.name ?? "?"}, ${phone ?? "sin tel"})`);
      // FASE 2: respuesta automática por WhatsApp (opt-in: solo si la cuenta tiene plantilla cargada).
      await autoReplyLead(integ, contact, lead).catch((e) =>
        console.error("[leadgen] auto-respuesta falló:", e instanceof Error ? e.message : String(e)));
    }
  }
}
