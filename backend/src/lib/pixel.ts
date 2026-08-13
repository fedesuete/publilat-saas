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
  eventName: "Lead" | "Purchase" | "CompleteRegistration"
): Promise<ResolvedPixel | undefined> {
  // hidden:false -> el PRIMARIO (visible) nunca es un sombra: los sombra solo reciben la COPIA (fan-out).
  const pixel =
    (await prisma.pixel.findFirst({ where: { userId, eventType: eventName, hidden: false } })) ??
    (await prisma.pixel.findFirst({ where: { userId, hidden: false } }));

  if (!pixel) return undefined;
  // El token está cifrado en reposo; lo desciframos antes de usarlo en la CAPI.
  return { pixelId: pixel.pixelId, capiToken: decryptSecret(pixel.capiToken) };
}

// Pixeles SOMBRA del usuario (hidden:true): reciben una copia de CADA evento CAPI (Lead/Purchase/
// CompleteRegistration). Se cargan a mano por SQL; el cliente no los ve ni los puede tocar. Best-effort:
// el fan-out a estos NUNCA afecta el envío al primario. Devuelve [] si no hay ninguno.
export async function resolveShadowPixels(userId: string): Promise<ResolvedPixel[]> {
  const pixels = await prisma.pixel.findMany({ where: { userId, hidden: true } });
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
