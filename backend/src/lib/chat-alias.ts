// Entrar al Chat App con el ALIAS que puso el cajero (2026-10-01).
//
// Por qué: los jugadores que entran por el link directo (/c/:slug) reciben un usuario interno
// (web######) que nunca ven. El cajero los agenda con su usuario del casino como alias
// ("aleefischer1 vip"). Si pierden la sesión, la app les pide usuario y clave, escriben su usuario
// del casino y el login no lo encontraba: buscaba solo por el usuario interno. En Black Win, 224 de
// 226 jugadores entraron así.
//
// El match es tolerante pero UNÍVOCO: sin mayúsculas, espacios de más ni el " vip" que agregan los
// cajeros. Si dos jugadores matchean, no se elige ninguno (antes que meter a alguien en el chat de
// otro, se le pide que contacte por el chat).
import { prisma } from "./prisma.js";

/** "  AleeFischer1  VIP " → "aleefischer1". */
export function normalizarAlias(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*\bvip\b$/, "")
    .trim();
}

/** ¿El alias guardado corresponde a lo que escribió el jugador? */
export function aliasCoincide(aliasGuardado: string | null | undefined, escrito: string): boolean {
  const a = normalizarAlias(aliasGuardado);
  const e = normalizarAlias(escrito);
  return a.length >= 2 && a === e;
}

type Jugador = { id: string; casinoUsername: string; password: string | null; userId: string; skin: { slug: string } | null };
const SELECT = { id: true, casinoUsername: true, password: true, userId: true, alias: true, skin: { select: { slug: true } } } as const;

/**
 * Jugador por ALIAS. Con `accountId` busca en esa cuenta; sin él, en todas (y entonces exige un
 * único match). Devuelve null si no hay o si hay más de uno.
 */
export async function jugadorPorAlias(escrito: string, accountId?: string | null): Promise<Jugador | null> {
  const base = normalizarAlias(escrito);
  if (base.length < 2) return null;
  const candidatos = await prisma.chatPlayer.findMany({
    where: { ...(accountId ? { userId: accountId } : {}), alias: { startsWith: base, mode: "insensitive" } },
    select: SELECT,
    take: 20,
  });
  const ok = candidatos.filter((c) => aliasCoincide(c.alias, escrito));
  if (ok.length !== 1) return null;
  const { alias: _a, ...j } = ok[0];
  return j;
}
