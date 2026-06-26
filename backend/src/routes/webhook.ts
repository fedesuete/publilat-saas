// Webhook de Evolution API (público: lo invoca el contenedor).
// Traduce eventos de WhatsApp a nuestro modelo: QR, estado de línea y mensajes entrantes.
// El mensaje entrante se matchea al lead por el `code` incrustado (o por teléfono).
import { Router } from "express";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { emitToUser } from "../lib/io.js";
import { fetchOwnerNumber, getMediaBase64 } from "../lib/evolution.js";
import { detectPayment } from "../lib/payment-detect.js";
import { consumeDayAndActivate } from "../lib/access.js";

export const webhookRouter = Router();

// Normaliza el nombre del evento: "MESSAGES_UPSERT" | "messages.upsert" -> "messages.upsert".
const normEvent = (e: unknown) => String(e ?? "").toLowerCase().replace(/_/g, ".");

// Extrae el texto de un mensaje de WhatsApp (varios formatos posibles).
function extractText(message: Record<string, any> | undefined): string {
  if (!message) return "";
  return (
    message.conversation ??
    message.extendedTextMessage?.text ??
    message.imageMessage?.caption ??
    message.videoMessage?.caption ??
    message.buttonsResponseMessage?.selectedDisplayText ??
    message.listResponseMessage?.title ??
    ""
  );
}

// "5492944...@s.whatsapp.net" -> "5492944..."
const jidToPhone = (jid: string | undefined) => (jid ? jid.split("@")[0].replace(/\D/g, "") : "");

webhookRouter.post("/", async (req, res) => {
  // Seguridad opcional: si hay EVOLUTION_WEBHOOK_TOKEN, exigirlo como ?token=.
  const expected = process.env.EVOLUTION_WEBHOOK_TOKEN;
  if (expected && req.query.token !== expected) {
    return res.status(401).json({ error: "token inválido" });
  }
  // Respondemos 200 siempre y rápido; Evolution reintenta si fallamos.
  res.json({ ok: true });

  try {
    const body = req.body ?? {};
    const event = normEvent(body.event);
    const instance: string = body.instance ?? body.instanceName ?? "";
    if (!instance) return;

    if (process.env.NODE_ENV !== "production") {
      console.log(`[webhook] ${event} <- ${instance}`);
    }

    const line = await prisma.waLine.findFirst({ where: { sessionId: instance } });
    if (!line) return; // instancia ajena o ya borrada
    const userId = line.userId;

    if (event === "qrcode.updated") {
      const base64 = body.data?.qrcode?.base64 ?? body.data?.base64;
      if (base64) emitToUser(userId, "wa:qr", { lineId: line.id, qr: base64 });
      return;
    }

    if (event === "connection.update") {
      const state = body.data?.state ?? body.data?.connection ?? "unknown";
      const connected = state === "open";
      // Si quedó conectada, capturamos el número del WhatsApp vinculado (para los wa.me).
      let ownerPhone = jidToPhone(body.data?.wuid ?? body.sender);
      if (connected && !line.phone && !ownerPhone) {
        ownerPhone = await fetchOwnerNumber(instance);
      }
      await prisma.waLine.update({
        where: { id: line.id },
        data: {
          connected,
          status: connected ? "active" : "inactive",
          ...(connected && ownerPhone && !line.phone ? { phone: ownerPhone } : {}),
        },
      });
      // Primera conexión: arranca el contador (consume 1 día / 24h). Si no hay días,
      // queda conectada pero sin tiempo activo -> el redirector no la usará (paywall).
      if (connected && !line.expiresAt) {
        const activated = await consumeDayAndActivate(userId, line.id, line.label);
        if (!activated) emitToUser(userId, "wa:status", { lineId: line.id, state: "no_credits", connected });
      }
      emitToUser(userId, "wa:status", { lineId: line.id, state, connected });
      return;
    }

    if (event === "messages.upsert") {
      // data puede venir como objeto único o como { messages: [...] }.
      const raw = body.data;
      const items: any[] = Array.isArray(raw) ? raw : raw?.messages ?? [raw];

      // Modo de detección de pago del usuario (off | assisted | auto).
      const owner = await prisma.user.findUnique({
        where: { id: userId },
        select: { paymentDetection: true },
      });
      const paymentMode = owner?.paymentDetection ?? "off";

      for (const item of items) {
        if (!item?.key) continue;
        if (item.key.fromMe) continue; // sólo entrantes
        const phone = jidToPhone(item.key.remoteJid);
        if (!phone) continue;
        const text = extractText(item.message);
        const waMessageId = item.key.id as string | undefined;

        // 1) Match por código incrustado (ref: XXXX). 2) Fallback por teléfono.
        const codeMatch = text.match(/ref:\s*([A-Z0-9]{4,})/i);
        let contact = codeMatch
          ? await prisma.contact.findFirst({ where: { userId, code: codeMatch[1].toUpperCase() } })
          : null;
        if (!contact) {
          contact = await prisma.contact.findFirst({
            where: { userId, phone },
            orderBy: { createdAt: "desc" },
          });
        }
        if (!contact) {
          // Mensaje directo (sin link rastreado): igual lo mostramos en el Inbox.
          contact = await prisma.contact.create({
            data: {
              userId,
              externalId: crypto.randomUUID(),
              phone,
              waJid: item.key.remoteJid ?? undefined,
              lineId: line.id,
              source: "wa",
              stage: "NUEVO",
            },
          });
        }

        // Completa teléfono/JID/línea, alias (nombre de WhatsApp) y avanza la etapa.
        const pushName = typeof item.pushName === "string" ? item.pushName.trim().slice(0, 80) : "";
        const patch: Record<string, unknown> = {};
        if (!contact.phone) patch.phone = phone;
        if (!contact.waJid && item.key.remoteJid) patch.waJid = item.key.remoteJid; // soporta @lid
        if (!contact.lineId) patch.lineId = line.id;
        if (pushName && !contact.name) patch.name = pushName; // alias = nombre que tiene en WhatsApp
        if (contact.stage === "NUEVO") patch.stage = "CONTACTADO";
        if (Object.keys(patch).length) {
          contact = await prisma.contact.update({ where: { id: contact.id }, data: patch });
        }

        // Si el mensaje trae imagen o documento (PDF), lo bajamos UNA vez (para mostrarlo
        // en el Inbox y pasarlo a la detección de pago sin volver a bajarlo).
        let mediaType: string | null = null;
        let mediaData: string | null = null;
        const img = item?.message?.imageMessage;
        const audio = item?.message?.audioMessage;
        const doc =
          item?.message?.documentMessage ??
          item?.message?.documentWithCaptionMessage?.message?.documentMessage;
        const mediaHint = img ?? audio ?? doc;
        if (mediaHint && waMessageId) {
          const media = await getMediaBase64(instance, waMessageId);
          if (media?.base64) {
            mediaData = media.base64;
            const fallbackMime = img ? "image/jpeg" : audio ? "audio/ogg" : "application/octet-stream";
            mediaType = media.mimetype ?? mediaHint.mimetype ?? fallbackMime;
          }
        }

        const message = await prisma.message.create({
          data: {
            contactId: contact.id,
            lineId: line.id,
            direction: "in",
            body: text,
            mediaType,
            mediaData,
            waMessageId,
          },
        });

        const mediaUrl = mediaData ? `data:${mediaType};base64,${mediaData}` : null;
        emitToUser(userId, "inbox:message", {
          contactId: contact.id,
          message: { id: message.id, direction: "in", body: text, mediaUrl, createdAt: message.createdAt },
          stage: contact.stage,
        });

        // Detección de pago (texto + comprobante por imagen con IA). Best-effort.
        void detectPayment({
          mode: paymentMode,
          userId,
          contact: {
            id: contact.id,
            externalId: contact.externalId,
            stage: contact.stage,
            name: contact.name,
          },
          instance,
          item,
          text,
          imageBase64: mediaData,
          imageMediaType: mediaType,
        });
      }
      return;
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[webhook] error:", message);
  }
});
