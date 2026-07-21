// Gating por créditos: 1 día = 1 línea activa 24h. Sin días, el loop no funciona.
import { prisma } from "./prisma.js";

export async function getAvailableDays(userId: string): Promise<number> {
  const c = await prisma.credit.findUnique({ where: { userId }, select: { days: true } });
  return c?.days ?? 0;
}

// Consume 1 día y deja la línea activa por 24h (activación inicial o renovación diaria).
// Devuelve true si quedó activa (o ya lo estaba); false si no había crédito.
//
// IDEMPOTENTE por ventana de 24h: primero "reclama" la activación con un update CONDICIONAL
// y atómico sobre la línea (solo si expiresAt es null o ya venció). Si dos eventos de conexión
// llegan casi juntos (Baileys/WAHA repiten el "connected"), solo UNO gana el claim; el otro sale
// sin consumir. Recién después descuenta el día (también atómico sobre el crédito). Antes el
// guard vivía en el caller (webhook: `if !line.expiresAt`) y NO era atómico -> doble consumo.
export async function consumeDayAndActivate(userId: string, lineId: string, label?: string | null): Promise<boolean> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // 1) Claim atómico de la ventana: solo si la línea no está ya activa (expiresAt null o vencido).
  const claimed = await prisma.waLine.updateMany({
    where: { id: lineId, OR: [{ expiresAt: null }, { expiresAt: { lte: now } }] },
    data: { expiresAt, status: "active" },
  });
  if (claimed.count !== 1) return true; // ya estaba activa en esta ventana -> NO re-consumir

  // 2) Descuenta el día (condicional y atómico). Si no hay crédito, revertimos el claim.
  const credit = await prisma.credit.findUnique({ where: { userId }, select: { id: true } });
  const spent = credit
    ? await prisma.credit.updateMany({ where: { id: credit.id, days: { gte: 1 } }, data: { days: { decrement: 1 } } })
    : { count: 0 };
  if (spent.count !== 1) {
    // Sin crédito: la línea NO queda activa (paywall). Revertimos el claim.
    await prisma.waLine.update({ where: { id: lineId }, data: { status: "inactive", expiresAt: null } }).catch(() => undefined);
    return false;
  }
  await prisma.creditLedger.create({ data: { creditId: credit!.id, delta: -1, reason: `línea activa 24h ${label ?? lineId}` } });
  return true;
}
