// Bloqueo de jugadores del Chat App (05/11, pedido de un cliente: un jugador le mandaba comprobantes
// truchos una y otra vez). Usa ChatPlayer.estatus, que ya existía ("active"):
//   "blocked"    → el jugador no puede entrar ni escribir (login, sesión, mensajes, cargas, retiros).
//   "blocked_ip" → lo mismo + no se pueden crear cuentas NUEVAS en esa cuenta desde su IP (si no, se
//                  registra de nuevo con un toque). Solo para cuentas nuevas: un jugador existente que
//                  comparta la IP (datos móviles comparten IP entre muchos) sigue entrando normal.
import { prisma } from "./prisma.js";

export const BLOCKED_STATUSES = ["blocked", "blocked_ip"] as const;
export const BLOCKED_MSG = "Tu acceso al chat fue suspendido. Si creés que es un error, comunicate con el cajero.";

export function estaBloqueado(estatus: string | null | undefined): boolean {
  return estatus === "blocked" || estatus === "blocked_ip";
}

// Cache corto: requireChatClient consulta en CADA request del jugador. 20 s alcanza para que el
// bloqueo corte rápido sin pegarle a la base todo el tiempo; al bloquear/desbloquear se invalida.
const CACHE_MS = 20_000;
const cache = new Map<string, { bloqueado: boolean; at: number }>();

export async function jugadorBloqueado(playerId: string): Promise<boolean> {
  const hit = cache.get(playerId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.bloqueado;
  const p = await prisma.chatPlayer.findUnique({ where: { id: playerId }, select: { estatus: true } });
  const bloqueado = estaBloqueado(p?.estatus);
  cache.set(playerId, { bloqueado, at: Date.now() });
  if (cache.size > 5000) cache.clear();
  return bloqueado;
}

export function olvidarBloqueo(playerId: string): void {
  cache.delete(playerId);
}

/** ¿Esta IP quedó bloqueada para registros nuevos en la cuenta? */
export async function ipBloqueada(accountId: string, ip: string | null | undefined): Promise<boolean> {
  if (!ip) return false;
  const n = await prisma.chatPlayer.count({ where: { userId: accountId, estatus: "blocked_ip", clientIp: ip } });
  return n > 0;
}
