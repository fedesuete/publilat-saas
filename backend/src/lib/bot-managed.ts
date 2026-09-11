// Cuentas/líneas manejadas por el BOT CAJERO de un socio (env BOT_FORWARD = {"<lineId>": url} o
// {"user:<userId>": url}, mismo mapa que usa bot-forward.ts para reenviar los inbound).
// Para esas cuentas la fuente de verdad de la venta es el BOT: avisa la carga YA acreditada por
// POST /api/bot-relay/purchase (monto depositado, moneda real). El OCR del inbox NO debe disparar
// Purchase solo ahí (duplicaba, contaba comprobantes no acreditados y leía mal la moneda).
import { prisma } from "./prisma.js";

export interface BotForwardScope {
  lineIds: string[];
  userIds: string[];
}

export function botForwardScope(): BotForwardScope {
  let map: Record<string, unknown> = {};
  try {
    map = JSON.parse(process.env.BOT_FORWARD || "{}") as Record<string, unknown>;
  } catch {
    return { lineIds: [], userIds: [] };
  }
  const lineIds: string[] = [];
  const userIds: string[] = [];
  for (const k of Object.keys(map ?? {})) {
    if (k.startsWith("user:")) userIds.push(k.slice(5));
    else lineIds.push(k);
  }
  return { lineIds, userIds };
}

export function isBotManaged(input: { userId: string; lineId?: string | null }): boolean {
  const { lineIds, userIds } = botForwardScope();
  if (userIds.includes(input.userId)) return true;
  return !!input.lineId && lineIds.includes(input.lineId);
}

// Contacto de WhatsApp para un aviso del bot (bot-relay /purchase): por teléfono, dentro de las líneas
// Y las cuentas del forward (antes solo líneas → las cuentas mapeadas por `user:` no matcheaban nunca y
// el Purchase se salteaba). Sin forward configurado, match global por teléfono.
export async function findBotRelayContact(phoneDigits: string) {
  const { lineIds, userIds } = botForwardScope();
  const scoped = lineIds.length > 0 || userIds.length > 0;
  return prisma.contact.findFirst({
    where: scoped
      ? { phone: phoneDigits, OR: [{ lineId: { in: lineIds } }, { userId: { in: userIds } }] }
      : { phone: phoneDigits },
    orderBy: { createdAt: "desc" },
  });
}
