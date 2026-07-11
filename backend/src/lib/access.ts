// Gating por créditos: 1 día = 1 línea activa 24h. Sin días, el loop no funciona.
import { prisma } from "./prisma.js";

export async function getAvailableDays(userId: string): Promise<number> {
  const c = await prisma.credit.findUnique({ where: { userId }, select: { days: true } });
  return c?.days ?? 0;
}

// Consume 1 día y deja la línea activa por 24h (activación inicial o renovación diaria).
// Devuelve true si había crédito; false si no (el llamador decide qué hacer).
// El decremento es CONDICIONAL y atómico (updateMany where days>=1): dos activaciones
// concurrentes con days=1 ya no pueden dejar el crédito en -1 ni activar 2 líneas por 1 día.
export async function consumeDayAndActivate(userId: string, lineId: string, label?: string | null): Promise<boolean> {
  const credit = await prisma.credit.findUnique({ where: { userId }, select: { id: true } });
  if (!credit) return false;
  const spent = await prisma.credit.updateMany({
    where: { id: credit.id, days: { gte: 1 } },
    data: { days: { decrement: 1 } },
  });
  if (spent.count !== 1) return false; // sin crédito o lo ganó otra activación concurrente
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await prisma.$transaction([
    prisma.creditLedger.create({ data: { creditId: credit.id, delta: -1, reason: `línea activa 24h ${label ?? lineId}` } }),
    prisma.waLine.update({ where: { id: lineId }, data: { expiresAt, status: "active" } }),
  ]);
  return true;
}
