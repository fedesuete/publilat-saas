// Panel del cliente: su link de referido + las comisiones que ganó. La comisión es 10% de la
// PRIMERA compra de cada referido, en USDT, que el admin paga a mano (pending -> paid).
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { getOrCreateReferralCode, isEligibleReferrer } from "../lib/referrals.js";

export const referralsRouter = Router();

// Enmascara el email del referido (el referidor no necesita ver el email completo).
function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  return `${user.slice(0, 3)}***@${domain ?? ""}`;
}

// GET /api/referrals/me — código propio, elegibilidad, listado de comisiones y resumen.
referralsRouter.get("/me", async (req, res) => {
  const userId = req.userId!;
  const code = await getOrCreateReferralCode(userId);
  const eligible = await isEligibleReferrer(userId);

  const rows = await prisma.referral.findMany({
    where: { referrerId: userId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const ids = rows.map((r) => r.referredUserId);
  const users = ids.length
    ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } })
    : [];
  const byId = new Map(users.map((u) => [u.id, u]));

  const referrals = rows.map((r) => {
    const u = byId.get(r.referredUserId);
    return {
      id: r.id,
      referido: u?.name || (u?.email ? maskEmail(u.email) : "—"),
      days: r.days,
      commissionUsd: r.commissionUsdCents / 100,
      status: r.status,
      createdAt: r.createdAt,
      paidAt: r.paidAt,
    };
  });

  const pendingUsd = rows.filter((r) => r.status === "pending").reduce((s, r) => s + r.commissionUsdCents, 0) / 100;
  const paidUsd = rows.filter((r) => r.status === "paid").reduce((s, r) => s + r.commissionUsdCents, 0) / 100;

  res.json({
    code,
    eligible, // si false: puede compartir el link, pero la comisión no se paga hasta que sea cliente
    summary: { count: rows.length, pendingUsd, paidUsd },
    referrals,
  });
});
