// Gating por créditos: 1 día = 1 línea activa 24h. Sin días, el loop no funciona.
import { prisma } from "./prisma.js";

export async function getAvailableDays(userId: string): Promise<number> {
  const c = await prisma.credit.findUnique({ where: { userId }, select: { days: true } });
  return c?.days ?? 0;
}

// Consume 1 día y deja la línea activa por 24h (activación inicial o renovación diaria).
// Devuelve true si había crédito; false si no (el llamador decide qué hacer).
export async function consumeDayAndActivate(userId: string, lineId: string, label?: string | null): Promise<boolean> {
  const credit = await prisma.credit.findUnique({ where: { userId } });
  if (!credit || credit.days < 1) return false;
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await prisma.$transaction([
    prisma.credit.update({
      where: { id: credit.id },
      data: {
        days: { decrement: 1 },
        ledger: { create: { delta: -1, reason: `línea activa 24h ${label ?? lineId}` } },
      },
    }),
    prisma.waLine.update({ where: { id: lineId }, data: { expiresAt, status: "active" } }),
  ]);
  return true;
}
