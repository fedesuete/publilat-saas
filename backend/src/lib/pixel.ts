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
  eventName: "Lead" | "Purchase"
): Promise<ResolvedPixel | undefined> {
  const pixel =
    (await prisma.pixel.findFirst({ where: { userId, eventType: eventName } })) ??
    (await prisma.pixel.findFirst({ where: { userId } }));

  if (!pixel) return undefined;
  // El token está cifrado en reposo; lo desciframos antes de usarlo en la CAPI.
  return { pixelId: pixel.pixelId, capiToken: decryptSecret(pixel.capiToken) };
}
