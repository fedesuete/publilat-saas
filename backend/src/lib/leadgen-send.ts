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

// Resuelve el JID CANÓNICO de WhatsApp de un contacto que solo tiene teléfono (leads de formularios:
// los números argentinos vienen SIN el 9 → "54387..." no es nadie en WhatsApp; el real es "549387...").
// WAHA check-exists devuelve el chatId correcto (le agrega el 9 solo). Lo persistimos en waJid: los
// envíos usan waJid primero, así que UNA resolución arregla todos los envíos futuros a ese contacto.
// Devuelve true si el número EXISTE en WhatsApp (con jid ya guardado); false si no existe o falló.
export async function ensureContactJid(
  contact: { id: string; phone: string | null; waJid: string | null },
  sessionId: string | null,
): Promise<boolean> {
  if (contact.waJid) return true;           // ya resuelto (contactos que escribieron ellos)
  if (!contact.phone || !sessionId) return false;
  const base = process.env.WAHA_BASE_URL, key = process.env.WAHA_API_KEY;
  if ((process.env.WA_ENGINE ?? "").toLowerCase() !== "waha" || !base || !key) return true; // otros motores: sin chequeo, se envía como siempre
  try {
    const r = await fetch(
      `${base}/api/contacts/check-exists?phone=${encodeURIComponent(contact.phone)}&session=${encodeURIComponent(sessionId)}`,
      { headers: { "X-Api-Key": key }, signal: AbortSignal.timeout(9000) },
    );
    if (!r.ok) return true; // API caída: no bloqueamos el envío por esto
    const d = (await r.json()) as { numberExists?: boolean; chatId?: string };
    if (!d.numberExists || !d.chatId) return false; // el número NO tiene WhatsApp
    // Persistimos el jid Y el teléfono CANÓNICO (con el 9). Sin actualizar el phone, la RESPUESTA
    // del cliente entra por el webhook con el número canónico, no matchea al contacto (guardado sin
    // 9) y nace un DUPLICADO "orgánico" — que encima dispara el funnel de bienvenida equivocado
    // (pasó el 2026-08-31: lead de plataforma recibió la secuencia de Publi.lat).
    const canonicalPhone = d.chatId.split("@")[0].replace(/\D/g, "") || null;
    await prisma.contact.update({
      where: { id: contact.id },
      data: { waJid: d.chatId, ...(canonicalPhone ? { phone: canonicalPhone } : {}) },
    }).catch(() => undefined);
    contact.waJid = d.chatId;
    return true;
  } catch {
    return true; // error de red: mejor intentar el envío que perderlo
  }
}

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

// Envía la variante elegida (texto ya renderizado, o audio). Punto único que usan el auto-responder
// de leads, los envíos masivos y la bienvenida QR. ANTES de enviar resuelve el JID canónico del
// contacto (sin esto, los números de formularios sin el "9" argentino se iban al vacío: WhatsApp
// los "aceptaba" pero no era nadie — 46 envíos perdidos el 2026-08-31).
export async function sendLeadVariant(userId: string, contactId: string, variant: LeadReplyVariant, text?: string): Promise<boolean> {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, userId },
    select: { id: true, phone: true, waJid: true, lineId: true },
  });
  if (!contact) return false;
  if (!contact.waJid && contact.lineId) {
    const line = await prisma.waLine.findFirst({ where: { id: contact.lineId, userId }, select: { sessionId: true, provider: true } });
    if (line && line.provider !== "cloud") {
      const exists = await ensureContactJid(contact, line.sessionId);
      if (!exists) {
        console.warn(`[leadgen-send] el contacto ${contactId} NO tiene WhatsApp (número inválido) — no se envía`);
        return false;
      }
    }
  }
  if (variant.kind === "audio") return sendAudioToContact(userId, contactId, variant.clipId);
  return sendToContact(userId, contactId, text ?? variant.body);
}
