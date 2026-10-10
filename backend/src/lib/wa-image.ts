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

export type ImagenEnviada =
  | { ok: true; message: { id: string; createdAt: Date; status: string } }
  | { ok: false; status: number; error: string; code?: string };

/**
 * Núcleo: manda una imagen (base64) al contacto por su línea y la guarda en el Inbox. La usan los
 * flujos (imagen guardada) y el operador desde el Inbox (imagen subida en el momento). Nunca lanza.
 * `guardarImagen`: guarda los bytes en el Message para que se vea en el historial del Inbox.
 */
export async function enviarImagenAContacto(
  userId: string,
  contactId: string,
  base64: string,
  mimetype: string,
  opts: { caption?: string; guardarImagen?: boolean } = {},
): Promise<ImagenEnviada> {
  const caption = opts.caption?.trim() || undefined;
  const contact = await prisma.contact.findFirst({ where: { id: contactId, userId } });
  if (!contact?.lineId) return { ok: false, status: 400, error: "El contacto no tiene una línea para responder." };
  const line = await prisma.waLine.findFirst({ where: { id: contact.lineId, userId } });
  if (!line) return { ok: false, status: 400, error: "El contacto no tiene una línea para responder." };
  const destination = contact.waJid ?? contact.phone;
  if (!destination) return { ok: false, status: 400, error: "El contacto aún no tiene teléfono" };

  // Por ahora sólo líneas por QR (WAHA). La Cloud API oficial todavía no tiene helper de imagen en
  // wa-cloud.ts; cuando se agregue, este es el punto donde entra.
  if (line.provider === "cloud") {
    return { ok: false, status: 400, error: "Las líneas de la API oficial todavía no pueden mandar imágenes. Mandalo como texto o audio." };
  }
  if (!line.sessionId || !usaWaha()) return { ok: false, status: 400, error: "La línea no está disponible" };

  // Misma rampa anti-baneo que el resto de los envíos.
  const gate = await checkWarmupGate(line);
  if (!gate.ok) return { ok: false, status: 429, error: gate.reason ?? "Límite de envíos de la línea", code: "WARMUP_LIMIT" };

  let waMessageId: string | undefined;
  try {
    waMessageId = await enviarPorWaha(line.sessionId, destination, base64, mimetype, caption);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    console.error("[wa-image] error:", m);
    return { ok: false, status: 502, error: "No se pudo enviar la imagen" };
  }

  // Igual que wa-send: el eco fromMe de WAHA puede ganarle la carrera a este create.
  let msg;
  try {
    msg = await prisma.message.create({
      data: {
        contactId, lineId: line.id, direction: "out", body: caption ?? "", mediaType: mimetype, waMessageId,
        ...(opts.guardarImagen ? { mediaData: base64 } : {}),
      },
    });
  } catch (e) {
    const dup = waMessageId ? await prisma.message.findUnique({ where: { waMessageId } }) : null;
    if (!dup) throw e;
    msg = opts.guardarImagen && !dup.mediaData
      ? await prisma.message.update({ where: { id: dup.id }, data: { mediaData: base64, mediaType: mimetype } })
      : dup;
  }
  emitToUser(userId, "inbox:message", {
    contactId,
    message: {
      id: msg.id, direction: "out", body: caption ?? "", status: msg.status, mediaType: mimetype, createdAt: msg.createdAt,
      ...(opts.guardarImagen ? { mediaUrl: `data:${mimetype};base64,${base64}` } : {}),
    },
  });
  return { ok: true, message: { id: msg.id, createdAt: msg.createdAt, status: msg.status } };
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
  const asset = await prisma.brandingAsset.findFirst({ where: { id: assetId, userId }, select: { contentType: true, data: true } });
  if (!asset) {
    console.warn(`[wa-image] la imagen ${assetId} no existe o no es de esta cuenta`);
    return false;
  }
  const r = await enviarImagenAContacto(userId, contactId, Buffer.from(asset.data).toString("base64"), asset.contentType, { caption });
  if (!r.ok) console.warn(`[wa-image] no salió (contacto ${contactId}): ${r.error}`);
  return r.ok;
}
