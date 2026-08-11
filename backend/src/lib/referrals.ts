// Sistema de referidos: un cliente existente comparte su link (/register?ref=CODE). Cuando el
// referido aprueba su PRIMERA compra, el referidor gana el 10% del valor en USD, pagado en USDT
// A MANO por el admin (status pending -> paid). Reglas (confirmadas con el dueño 2026-08-11):
//   - 10% de la PRIMERA compra del referido, una sola vez (Referral.referredUserId es UNIQUE).
//   - Solo clientes EXISTENTES (con ≥1 compra aprobada) pueden cobrar como referidores.
//   - El monto se calcula sobre el valor en USD (días × usdPerDay), NO sobre la moneda que pagó
//     el referido, así no depende del tipo de cambio (ARS/PYG/USD) — se paga siempre en USDT.
import crypto from "crypto";
import { prisma } from "./prisma.js";
import { usdPerDay } from "./payments.js";

// Alfabeto sin caracteres ambiguos (0/O/1/I) para que el código se dicte/copie sin error.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const COMMISSION_RATE = 0.1; // 10%

function genReferralCode(): string {
  const bytes = crypto.randomBytes(6);
  let s = "";
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return s;
}

// Devuelve el código de referido del usuario, generándolo de forma perezosa la 1ra vez.
export async function getOrCreateReferralCode(userId: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { referralCode: true } });
  if (u?.referralCode) return u.referralCode;
  for (let i = 0; i < 8; i++) {
    const code = genReferralCode();
    try {
      await prisma.user.update({ where: { id: userId }, data: { referralCode: code } });
      return code;
    } catch (e) {
      if ((e as { code?: string })?.code === "P2002") continue; // colisión rara: reintenta
      throw e;
    }
  }
  throw new Error("no se pudo generar referralCode");
}

// Resuelve el User.id del referidor a partir de un código (case-insensitive).
export async function resolveReferrerByCode(code: string): Promise<string | null> {
  const clean = (code ?? "").toUpperCase().trim();
  if (!clean) return null;
  const u = await prisma.user.findUnique({ where: { referralCode: clean }, select: { id: true } });
  return u?.id ?? null;
}

// Un referidor solo cobra si YA es cliente (tiene al menos una compra aprobada).
export async function isEligibleReferrer(userId: string): Promise<boolean> {
  const paid = await prisma.payment.count({ where: { userId, status: "approved" } });
  return paid > 0;
}

// Se llama desde approvePayment cuando un pago pasa a "approved". Si la cuenta que pagó fue
// referida por un cliente elegible y es su PRIMERA compra, crea la comisión (pending).
// Idempotente: el UNIQUE de referredUserId garantiza una sola comisión por referido; los pagos
// siguientes chocan (P2002) y se saltean. Best-effort: nunca frena la acreditación del pago.
export async function settleReferralOnFirstPayment(payment: {
  id: string;
  userId: string;
  days: number;
  amount: number | null;
  currency: string;
}): Promise<void> {
  try {
    const referred = await prisma.user.findUnique({
      where: { id: payment.userId },
      select: { referredById: true },
    });
    const referrerId = referred?.referredById;
    if (!referrerId || referrerId === payment.userId) return; // sin referidor (o auto-referido)
    if (!(await isEligibleReferrer(referrerId))) return; // el referidor todavía no es cliente

    const usdValue = payment.days * usdPerDay(payment.days); // valor en USD (estable, sin FX)
    const commissionUsdCents = Math.round(usdValue * COMMISSION_RATE * 100);

    await prisma.referral.create({
      data: {
        referrerId,
        referredUserId: payment.userId, // UNIQUE: solo la 1ra compra crea el registro
        paymentId: payment.id,
        days: payment.days,
        amount: payment.amount ?? null,
        currency: payment.currency,
        commissionUsdCents,
        status: "pending",
      },
    });
    console.log(
      `[referral] +${(commissionUsdCents / 100).toFixed(2)} USD pendiente para referrer ${referrerId}`,
    );
  } catch (e) {
    if ((e as { code?: string })?.code === "P2002") return; // ya había comisión (no es 1ra compra)
    console.error("[referral] settle error:", e);
  }
}
