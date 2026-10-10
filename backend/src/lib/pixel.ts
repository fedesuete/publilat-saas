// Resuelve las credenciales de Meta de un usuario para un evento dado.
// Prefiere un Pixel con eventType == eventName; si no, cualquiera del usuario.
// Si el usuario no tiene Pixel, devuelve undefined y sendCapiEvent cae al .env.
import { prisma } from "./prisma.js";
import { decryptSecret } from "./crypto.js";

export interface ResolvedPixel {
  pixelId: string;
  capiToken: string;
}

export async function resolveUserPixel(
  userId: string,
  eventName: "Lead" | "Purchase" | "CompleteRegistration" | "Schedule"
): Promise<ResolvedPixel | undefined> {
  // El PRIMARIO nunca es un sombra interno (hidden) ni el espejo del cliente (mirror): esos solo
  // reciben la COPIA (fan-out). Tampoco un pixel de SEGMENTO (con label): esos son solo para los
  // contactos marcados con ese tipo. Si la cuenta SOLO tiene pixeles con label, se usa el más viejo
  // (mejor eso que dejar los eventos sin pixel). Orden fijo por fecha: antes era "el primero que
  // devuelva la base", que con varios pixeles es al azar.
  const base = { userId, hidden: false, mirror: false } as const;
  const orden = { createdAt: "asc" } as const;
  const pixel =
    (await prisma.pixel.findFirst({ where: { ...base, label: null, eventType: eventName }, orderBy: orden })) ??
    (await prisma.pixel.findFirst({ where: { ...base, label: null }, orderBy: orden })) ??
    (await prisma.pixel.findFirst({ where: base, orderBy: orden }));

  if (!pixel) return undefined;
  // El token está cifrado en reposo; lo desciframos antes de usarlo en la CAPI.
  return { pixelId: pixel.pixelId, capiToken: decryptSecret(pixel.capiToken) };
}

// Pixel para un evento de UN CONTACTO: si el operador lo marcó con un tipo de cliente (ContactSegment),
// va al pixel de ese tipo; si no, al principal (lo de siempre). Lo usan Lead/Purchase del CRM.
export async function resolveContactPixel(
  userId: string,
  contactId: string | null | undefined,
  eventName: "Lead" | "Purchase" | "CompleteRegistration" | "Schedule",
): Promise<ResolvedPixel | undefined> {
  if (contactId) {
    const seg = await prisma.contactSegment.findUnique({ where: { contactId }, select: { pixelRowId: true } }).catch(() => null);
    if (seg) {
      const p = await prisma.pixel.findFirst({ where: { id: seg.pixelRowId, userId, hidden: false, mirror: false } });
      if (p) {
        try {
          return { pixelId: p.pixelId, capiToken: decryptSecret(p.capiToken) };
        } catch {
          /* token roto: cae al principal antes que perder el evento */
        }
      }
    }
  }
  return resolveUserPixel(userId, eventName);
}

// Pixeles SOMBRA del usuario (hidden:true): reciben una copia de CADA evento CAPI (Lead/Purchase/
// CompleteRegistration). Se cargan a mano por SQL; el cliente no los ve ni los puede tocar. Best-effort:
// el fan-out a estos NUNCA afecta el envío al primario. Devuelve [] si no hay ninguno.
export async function resolveShadowPixels(userId: string): Promise<ResolvedPixel[]> {
  // Copia para las sombras INTERNAS (hidden, nuestras) y para el ESPEJO del cliente (mirror), que
  // se entrena en paralelo como respaldo por si Meta le bloquea el pixel principal.
  const pixels = await prisma.pixel.findMany({ where: { userId, OR: [{ hidden: true }, { mirror: true }] } });
  return pixels
    .map((p) => {
      try {
        return { pixelId: p.pixelId, capiToken: decryptSecret(p.capiToken) };
      } catch {
        return null; // token indescifrable: se saltea, no rompe el resto
      }
    })
    .filter((p): p is ResolvedPixel => p !== null);
}

// IDs de los pixeles ESPEJO del cliente, para inyectarlos también en el NAVEGADOR de la landing
// (así el espejo aprende del PageView/Lead del browser, no solo de la CAPI). Sin tokens: acá solo
// viaja el id público del pixel.
export async function resolveMirrorPixelIds(userId: string): Promise<string[]> {
  const pixels = await prisma.pixel.findMany({ where: { userId, mirror: true }, select: { pixelId: true } });
  return [...new Set(pixels.map((p) => p.pixelId.replace(/\D/g, "")).filter(Boolean))];
}
