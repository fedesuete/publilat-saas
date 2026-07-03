// Webhook de la WhatsApp Cloud API (oficial) — público (lo invoca Meta).
// Maneja anuncios Click-to-WhatsApp (CTWA): el primer mensaje trae un `referral` con
// `ctwa_clid`. Creamos el lead, lo guardamos en el Inbox y disparamos Lead por CAPI con
// action_source="business_messaging". Convive con el webhook de Evolution (Baileys).
import { Router } from "express";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { emitToUser } from "../lib/io.js";
import { resolveUserPixel } from "../lib/pixel.js";
import { sendCapiEvent } from "../lib/meta-capi.js";
import { getCloudMediaBase64 } from "../lib/wa-cloud.js";
import { detectPayment } from "../lib/payment-detect.js";
import { notify } from "../lib/notifications.js";
import { onInboundFlow } from "../lib/flow-engine.js";

export const cloudWebhookRouter = Router();

// Valida la firma X-Hub-Signature-256 que Meta envía: HMAC-SHA256 del body crudo con el
// app secret. Sin firma válida no procesamos (evita webhooks falsificados).
function validMetaSignature(req: import("express").Request): boolean {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    console.warn("[cloud-webhook] META_APP_SECRET no configurado: no se puede validar la firma");
    return false;
  }
  const header = req.get("x-hub-signature-256");
  if (!header || !header.startsWith("sha256=")) return false;
  const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
  if (!raw || raw.length === 0) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(raw).digest("hex");
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Extrae el texto de un mensaje de la Cloud API (varios tipos).
function extractText(msg: Record<string, any>): string {
  return (
    msg?.text?.body ??
    msg?.image?.caption ??
    msg?.document?.caption ??
    msg?.video?.caption ??
    msg?.button?.text ??
    msg?.interactive?.button_reply?.title ??
    msg?.interactive?.list_reply?.title ??
    ""
  );
}

// Dispara el Lead de CTWA por CAPI (business_messaging + ctwa_clid). Best-effort.
async function fireCtwaLead(userId: string, contact: { id: string; externalId: string; phone: string | null; ctwaClid: string | null }) {
  const creds = await resolveUserPixel(userId, "Lead");
  const metaEvent = await prisma.metaEvent.create({
    data: {
      userId,
      contactId: contact.id,
      eventName: "Lead",
      pixelId: creds?.pixelId ?? process.env.META_PIXEL_ID ?? "",
      payload: {},
      status: "pending",
    },
  });
  try {
    const result = await sendCapiEvent({
      eventName: "Lead",
      externalId: contact.externalId,
      phone: contact.phone ?? undefined,
      actionSource: "business_messaging",
      ctwaClid: contact.ctwaClid ?? undefined,
      eventId: contact.externalId,
      pixelId: creds?.pixelId,
      capiToken: creds?.capiToken,
    });
    await prisma.metaEvent.update({
      where: { id: metaEvent.id },
      data: { status: "sent", pixelId: result.pixelId, payload: result.payload as object, response: result.response as object },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[CTWA Lead] error:", message);
    await prisma.metaEvent.update({ where: { id: metaEvent.id }, data: { status: "failed", response: { error: message } } });
  }
}

// GET — verificación del webhook (Meta manda hub.challenge + verify token).
cloudWebhookRouter.get("/", async (req, res) => {
  const mode = req.query["hub.mode"];
  const verifyToken = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && typeof verifyToken === "string") {
    // 1) Token global de la app (Embedded Signup / Tech Provider).
    const globalToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    if (globalToken && verifyToken === globalToken) {
      return res.status(200).send(String(challenge ?? ""));
    }
    // 2) Token por línea (alta manual de credenciales).
    const line = await prisma.waLine.findFirst({ where: { provider: "cloud", verifyToken } });
    if (line) return res.status(200).send(String(challenge ?? ""));
  }
  return res.sendStatus(403);
});

// POST — mensajes entrantes.
cloudWebhookRouter.post("/", async (req, res) => {
  // Validamos la firma de Meta ANTES de procesar (rechaza payloads falsificados).
  if (!validMetaSignature(req)) {
    console.warn("[cloud-webhook] firma X-Hub-Signature-256 inválida o ausente -> 401");
    return res.sendStatus(401);
  }
  res.sendStatus(200); // responder rápido; Meta reintenta si fallamos
  try {
    const entries: any[] = req.body?.entry ?? [];
    console.log(`[cloud-webhook] POST recibido: ${entries.length} entry(s)`);
    for (const entry of entries) {
      for (const change of entry?.changes ?? []) {
        const value = change?.value;
        const phoneNumberId: string | undefined = value?.metadata?.phone_number_id;
        const msgCount = Array.isArray(value?.messages) ? value.messages.length : 0;
        console.log(`[cloud-webhook] field=${change?.field} phone_number_id=${phoneNumberId ?? "—"} messages=${msgCount}`);
        if (!phoneNumberId) continue;

        const line = await prisma.waLine.findFirst({
          where: { provider: "cloud", wabaPhoneNumberId: phoneNumberId },
        });
        if (!line) {
          console.warn(`[cloud-webhook] SIN línea Cloud para phone_number_id=${phoneNumberId} -> no se entrega`);
          continue;
        }
        console.log(`[cloud-webhook] match línea ${line.id} (user ${line.userId})`);
        const userId = line.userId;

        const owner = await prisma.user.findUnique({ where: { id: userId }, select: { paymentDetection: true } });
        const paymentMode = owner?.paymentDetection ?? "off";

        // Ignoramos cambios que no sean mensajes (statuses/echoes): solo procesamos value.messages.
        for (const msg of value?.messages ?? []) {
          if (!msg?.from) continue;
          // Idempotencia: si ya guardamos este mensaje (mismo id), lo salteamos.
          if (msg.id) {
            const dup = await prisma.message.findFirst({ where: { waMessageId: msg.id }, select: { id: true } });
            if (dup) continue;
          }
          const phone = String(msg.from).replace(/\D/g, "");
          if (!phone) continue;
          const text = extractText(msg);
          const referral = msg.referral; // presente sólo en el 1er msg de un anuncio CTWA

          // 1) Resolver contacto por teléfono (o crearlo).
          let contact = await prisma.contact.findFirst({
            where: { userId, phone },
            orderBy: { createdAt: "desc" },
          });
          let isNewCtwaLead = false;

          if (!contact) {
            contact = await prisma.contact.create({
              data: {
                userId,
                externalId: crypto.randomUUID(),
                phone,
                waJid: String(msg.from),
                lineId: line.id,
                source: referral?.ctwa_clid ? "ctwa" : "wa",
                stage: "NUEVO",
                ...(referral?.ctwa_clid
                  ? { ctwaClid: referral.ctwa_clid, campaignId: referral.source_id ?? undefined, adId: referral.source_id ?? undefined }
                  : {}),
              },
            });
            isNewCtwaLead = !!referral?.ctwa_clid;
            void notify(userId, "lead", "Nuevo lead 💬", `Te escribió un contacto nuevo (${phone}).`);
          } else {
            const patch: Record<string, unknown> = {};
            if (!contact.waJid) patch.waJid = String(msg.from);
            if (!contact.lineId) patch.lineId = line.id;
            if (referral?.ctwa_clid && !contact.ctwaClid) {
              patch.ctwaClid = referral.ctwa_clid;
              patch.campaignId = referral.source_id ?? contact.campaignId;
              patch.source = "ctwa";
              isNewCtwaLead = true;
            }
            if (contact.stage === "NUEVO") patch.stage = "CONTACTADO";
            if (Object.keys(patch).length) {
              contact = await prisma.contact.update({ where: { id: contact.id }, data: patch });
            }
          }

          // 2) Media entrante (imagen/documento) -> base64 para el Inbox y la detección.
          let mediaType: string | null = null;
          let mediaData: string | null = null;
          const mediaId: string | undefined = msg.image?.id ?? msg.document?.id;
          if (mediaId) {
            const m = await getCloudMediaBase64(line, mediaId);
            if (m?.base64) {
              mediaData = m.base64;
              mediaType = m.mimetype ?? (msg.image ? "image/jpeg" : "application/octet-stream");
            }
          }

          // 3) Guardar el mensaje + emitir al Inbox.
          const message = await prisma.message.create({
            data: { contactId: contact.id, lineId: line.id, direction: "in", body: text, mediaType, mediaData, waMessageId: msg.id },
          });
          const mediaUrl = mediaData ? `data:${mediaType};base64,${mediaData}` : null;
          emitToUser(userId, "inbox:message", {
            contactId: contact.id,
            message: { id: message.id, direction: "in", body: text, mediaUrl, createdAt: message.createdAt },
            stage: contact.stage,
          });

          // 4) Lead CTWA (sólo en el 1er mensaje con referral).
          if (isNewCtwaLead) {
            void fireCtwaLead(userId, { id: contact.id, externalId: contact.externalId, phone: contact.phone, ctwaClid: contact.ctwaClid });
          }

          // 5) Detección de pago (texto + comprobante por imagen/PDF con IA).
          void detectPayment({
            mode: paymentMode,
            userId,
            contact: { id: contact.id, externalId: contact.externalId, stage: contact.stage, name: contact.name },
            instance: line.sessionId ?? "",
            item: {},
            text,
            imageBase64: mediaData,
            imageMediaType: mediaType,
          });

          // 6) Automatizaciones/secuencias (best-effort).
          void onInboundFlow(userId, contact.id, text);
        }
      }
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[wa/cloud/webhook] error:", message);
  }
});
