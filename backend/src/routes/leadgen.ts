// Webhook de Meta Lead Ads (formularios instantáneos): captura el lead en Publi.lat apenas se envía el
// formulario. FASE 1 = captura (Contact + LeadForm); la respuesta automática es FASE 2. Es PÚBLICO (Meta lo
// llama sin Bearer): la seguridad es el verify_token (GET) + que el page_id matchee una cuenta con leadgen
// prendido y token cargado. Aditivo: NO toca la atribución ni el flujo de WhatsApp.
import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { decryptSecret } from "../lib/crypto.js";

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
      // FASE 2 (después): respuesta automática por WhatsApp según lead.answers + integ.leadgenReply/leadgenLineId.
    }
  }
}
