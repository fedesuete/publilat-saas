// Envío de la respuesta automática a un lead de formulario de Meta: variantes ROTATIVAS de texto o
// AUDIO. Aditivo: NO toca el inbox ni el flujo de WhatsApp; reusa el mismo camino de envío (motor +
// gate de calentamiento + Message + emit al Inbox) que ya usa el panel.
import { prisma } from "./prisma.js";
import { emitToUser } from "./io.js";
import { getEngine } from "./wa-engine.js";
import { sendCloudAudio } from "./wa-cloud.js";
import { checkWarmupGate } from "./warmup.js";
import { uniquifyAudio } from "./audio-uniquify.js";
import { sendToContact } from "./wa-send.js";

// Una variante de respuesta: texto o audio de la biblioteca del cliente.
export type LeadReplyVariant =
  | { kind: "text"; body: string }
  | { kind: "audio"; clipId: string };

// Lee/valida las variantes guardadas en Integration.leadgenReplies (JSON libre en la DB).
export function parseVariants(raw: unknown): LeadReplyVariant[] {
  if (!Array.isArray(raw)) return [];
  const out: LeadReplyVariant[] = [];
  for (const v of raw) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    if (o.kind === "text" && typeof o.body === "string" && o.body.trim()) out.push({ kind: "text", body: o.body });
    else if (o.kind === "audio" && typeof o.clipId === "string" && o.clipId.trim()) out.push({ kind: "audio", clipId: o.clipId });
  }
  return out;
}

// Elige una variante al azar. Al azar y no round-robin a propósito: no hay estado que sincronizar
// entre procesos y el patrón queda menos previsible (dos leads seguidos pueden recibir distinto).
export function pickVariant(variants: LeadReplyVariant[]): LeadReplyVariant | null {
  if (!variants.length) return null;
  return variants[Math.floor(Math.random() * variants.length)];
}

// Envía un AUDIO de la biblioteca al contacto. Copia ÚNICA por envío (uniquifyAudio): WhatsApp ve un
// archivo distinto cada vez, aunque a oído sea la misma nota. Devuelve true si salió.
async function sendAudioToContact(userId: string, contactId: string, clipId: string): Promise<boolean> {
  const contact = await prisma.contact.findFirst({ where: { id: contactId, userId } });
  if (!contact?.lineId) return false;
  const line = await prisma.waLine.findFirst({ where: { id: contact.lineId, userId } });
  if (!line) return false;
  const destination = contact.waJid ?? contact.phone;
  if (!destination) return false;
  const clip = await prisma.audioClip.findFirst({ where: { id: clipId, userId } });
  if (!clip) { console.warn(`[leadgen] audio ${clipId} no encontrado`); return false; }

  const gate = await checkWarmupGate(line);
  if (!gate.ok) { console.warn(`[leadgen] audio bloqueado por calentamiento (línea ${line.id})`); return false; }

  let base64: string;
  try {
    base64 = (await uniquifyAudio(Buffer.from(clip.data))).toString("base64");
  } catch (e) {
    console.error("[leadgen] no se pudo preparar el audio:", e instanceof Error ? e.message : String(e));
    return false;
  }
  const mime = "audio/ogg";
  let waMessageId: string | undefined;
  try {
    if (line.provider === "cloud") {
      const sent = await sendCloudAudio(line, (contact.phone ?? destination).replace(/\D/g, ""), base64);
      waMessageId = sent?.messages?.[0]?.id ?? undefined;
    } else {
      if (!line.sessionId) return false;
      const sent = await getEngine().sendWhatsAppAudio(line.sessionId, destination, base64);
      waMessageId = sent?.key?.id ?? undefined;
    }
  } catch (e) {
    console.error("[leadgen] error enviando audio:", e instanceof Error ? e.message : String(e));
    return false;
  }
  let msg;
  try {
    msg = await prisma.message.create({
      data: { contactId, lineId: line.id, direction: "out", body: "", mediaType: mime, mediaData: base64, waMessageId },
    });
  } catch (e) {
    const dup = waMessageId ? await prisma.message.findUnique({ where: { waMessageId } }) : null;
    if (!dup) throw e;
    msg = dup;
  }
  emitToUser(userId, "inbox:message", {
    contactId,
    message: { id: msg.id, direction: "out", body: "", mediaUrl: `data:${mime};base64,${base64}`, createdAt: msg.createdAt },
  });
  return true;
}

// Envía la variante elegida (texto ya renderizado, o audio). Punto único que usa el webhook de leadgen.
export async function sendLeadVariant(userId: string, contactId: string, variant: LeadReplyVariant, text?: string): Promise<boolean> {
  if (variant.kind === "audio") return sendAudioToContact(userId, contactId, variant.clipId);
  return sendToContact(userId, contactId, text ?? variant.body);
}
