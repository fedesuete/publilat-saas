// Envío de IMAGEN a un contacto por su línea de WhatsApp, guardándola en el Inbox como cualquier
// otro saliente. Hasta ahora el sistema sólo sabía mandar texto y audio (wa-send.ts / leadgen-send.ts):
// para el flujo de ventas de Publi.lat hacía falta mandar la lámina de precios junto con los audios.
//
// ADITIVO: NO toca waha.ts ni wa-engine.ts (§9.6). Habla con WAHA por HTTP igual que qr-connect.ts,
// y con la Cloud API por el helper que ya existe. La imagen viaja en base64 (no hace falta que la
// URL sea pública) y sale por el MISMO camino que el resto: gate de calentamiento → envío → Message
// → emit al Inbox.
import { prisma } from "./prisma.js";
import { emitToUser } from "./io.js";
import { checkWarmupGate } from "./warmup.js";

const base = () => (process.env.WAHA_BASE_URL ?? "").replace(/\/$/, "");
const usaWaha = (): boolean =>
  (process.env.WA_ENGINE ?? "").toLowerCase() === "waha" && !!base() && !!process.env.WAHA_API_KEY;

// Manda la imagen por WAHA. Devuelve el id del mensaje si salió.
async function enviarPorWaha(session: string, chatId: string, base64: string, mimetype: string, caption?: string): Promise<string | undefined> {
  const r = await fetch(`${base()}/api/sendImage`, {
    method: "POST",
    headers: { "X-Api-Key": process.env.WAHA_API_KEY ?? "", "Content-Type": "application/json" },
    body: JSON.stringify({
      session,
      chatId,
      file: { mimetype, filename: "imagen.jpg", data: base64 },
      ...(caption ? { caption } : {}),
    }),
    signal: AbortSignal.timeout(60_000), // una imagen grande tarda más que un texto
  });
  if (!r.ok) throw new Error(`WAHA sendImage ${r.status}: ${(await r.text()).slice(0, 160)}`);
  const d = (await r.json().catch(() => ({}))) as { id?: unknown; key?: { id?: unknown } };
  const id = (d.key?.id ?? d.id) as { _serialized?: string } | string | undefined;
  return typeof id === "string" ? id : id?._serialized;
}

/**
 * Manda al contacto una imagen guardada en BrandingAsset (la misma tabla que usa el Chat App para
 * logos, así no hace falta una nueva). `caption` es el texto que va debajo de la imagen.
 * Devuelve true si salió. Best-effort: nunca lanza.
 */
export async function sendImageToContact(
  userId: string,
  contactId: string,
  assetId: string,
  caption?: string,
): Promise<boolean> {
  const contact = await prisma.contact.findFirst({ where: { id: contactId, userId } });
  if (!contact?.lineId) return false;
  const line = await prisma.waLine.findFirst({ where: { id: contact.lineId, userId } });
  if (!line) return false;
  const destination = contact.waJid ?? contact.phone;
  if (!destination) return false;

  // Misma rampa anti-baneo que el resto de los envíos automáticos.
  const gate = await checkWarmupGate(line);
  if (!gate.ok) {
    console.warn(`[wa-image] envío bloqueado por calentamiento (línea ${line.id}, contacto ${contactId})`);
    return false;
  }

  const asset = await prisma.brandingAsset.findFirst({ where: { id: assetId, userId }, select: { contentType: true, data: true } });
  if (!asset) {
    console.warn(`[wa-image] la imagen ${assetId} no existe o no es de esta cuenta`);
    return false;
  }
  const base64 = Buffer.from(asset.data).toString("base64");

  // Por ahora sólo líneas por QR (WAHA). La Cloud API oficial todavía no tiene helper de imagen en
  // wa-cloud.ts; cuando se agregue, este es el punto donde entra.
  if (line.provider === "cloud") {
    console.warn(`[wa-image] la línea ${line.id} es Cloud API: el envío de imagen todavía no está soportado ahí`);
    return false;
  }
  if (!line.sessionId || !usaWaha()) return false;

  let waMessageId: string | undefined;
  try {
    waMessageId = await enviarPorWaha(line.sessionId, destination, base64, asset.contentType, caption);
  } catch (e) {
    console.error("[wa-image] error:", e instanceof Error ? e.message : String(e));
    return false;
  }

  // Igual que wa-send: el eco fromMe de WAHA puede ganarle la carrera a este create.
  let msg;
  try {
    msg = await prisma.message.create({
      data: { contactId, lineId: line.id, direction: "out", body: caption ?? "", mediaType: asset.contentType, waMessageId },
    });
  } catch (e) {
    const dup = waMessageId ? await prisma.message.findUnique({ where: { waMessageId } }) : null;
    if (!dup) throw e;
    msg = dup;
  }
  emitToUser(userId, "inbox:message", {
    contactId,
    message: { id: msg.id, direction: "out", body: caption ?? "", mediaType: asset.contentType, createdAt: msg.createdAt },
  });
  return true;
}
