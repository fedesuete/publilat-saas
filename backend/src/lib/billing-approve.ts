// Acreditación de un pago aprobado (cualquier pasarela): días al crédito + ledger + señales de venta.
// Separado de routes/billing.ts para poder testearlo sin Express.
import { prisma } from "./prisma.js";
import { sendAdminMail } from "./mailer.js";
import { settleReferralOnFirstPayment } from "./referrals.js";
import { fireMarketingEvent } from "./marketing-capi.js";
import { markPurchase } from "./purchase.js";

export async function ensureCredit(userId: string) {
  return (
    (await prisma.credit.findUnique({ where: { userId } })) ??
    (await prisma.credit.create({ data: { userId, days: 0 } }))
  );
}

// Acredita los días de un pago aprobado. Idempotente de verdad: la transición
// pending->approved es una escritura CONDICIONAL atómica (updateMany where status=pending);
// si N llamadas concurrentes entran con el mismo pago (webhook reenviado, o el usuario
// dispara /usdt/verify en paralelo), solo UNA transiciona y solo esa acredita.
export async function approvePayment(paymentId: string, providerLabel: string): Promise<void> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.status === "approved") return;
  const credit = await ensureCredit(payment.userId);
  const claimed = await prisma.payment.updateMany({
    where: { id: paymentId, status: { not: "approved" } },
    data: { status: "approved" },
  });
  if (claimed.count !== 1) return; // otra ejecución ya lo aprobó: no acreditar de nuevo
  await prisma.credit.update({
    where: { id: credit.id },
    data: {
      days: { increment: payment.days },
      ledger: { create: { delta: payment.days, reason: `compra ${providerLabel} (${payment.days}d)` } },
    },
  });
  console.log(`[billing] ${providerLabel}: +${payment.days} días a user ${payment.userId}`);

  const value = (payment.amount ?? 0) / 100;
  const currency = payment.currency ?? "ARS";
  const eventId = `${payment.id}:purchase`; // estable por pago: reintentos no duplican el Purchase

  // Pixel "Publi.lat Clientes": TODO pago aprobado es una venta de Publi.lat, venga la cuenta de la
  // landing, del panel, de un referido o de un alta por admin. Sin este evento Meta nunca aprende quién
  // compra (antes solo salía para source=landing → cero Purchase en la práctica).
  void (async () => {
    const u = await prisma.user.findUnique({
      where: { id: payment.userId },
      select: { email: true, phone: true, name: true, fbp: true, fbc: true },
    });
    if (!u) return;
    await fireMarketingEvent({
      eventName: "Purchase",
      externalId: payment.userId,
      email: u.email, phone: u.phone, firstName: u.name, fbp: u.fbp, fbc: u.fbc,
      value, currency, eventId,
    });
  })().catch(() => undefined);

  // Cierre de loop con el CRM de ventas (cuenta de Publi.lat donde caen los leads de los anuncios,
  // env PUBLILAT_MKT_CRM_USER_ID): el contacto con ese teléfono pasa a COMPRO y dispara el Purchase del
  // flujo cliente en SU pixel (con la atribución del anuncio). Best-effort.
  void linkPurchaseToCrm(payment.userId, value, currency, eventId).catch(() => undefined);

  // Referidos: si esta cuenta fue referida por un cliente, su 1ra compra genera la comisión del
  // 10% (pending, USDT manual). Best-effort: nunca frena la acreditación del pago.
  void settleReferralOnFirstPayment(payment).catch(() => undefined);
  // Aviso por email al equipo. Best-effort: no frena la acreditación.
  void (async () => {
    const u = await prisma.user.findUnique({ where: { id: payment.userId }, select: { slug: true, email: true } });
    const monto = value.toLocaleString("es-AR");
    await sendAdminMail(
      `💰 Pago acreditado — ${u?.slug ?? payment.userId} (${providerLabel})`,
      `Cliente: ${u?.slug ?? ""} (${u?.email ?? ""})\nProveedor: ${providerLabel}\nDías: ${payment.days}\nMonto: ${monto} ${currency}`,
    );
  })().catch(() => undefined);
}

async function linkPurchaseToCrm(userId: string, value: number, currency: string, eventId: string): Promise<void> {
  const crmUserId = (process.env.PUBLILAT_MKT_CRM_USER_ID ?? "").trim();
  if (!crmUserId) return;
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { phone: true } });
  const digits = (u?.phone ?? "").replace(/\D/g, "");
  if (digits.length < 8) return;
  // Match por sufijo: el CRM guarda 549..., el cliente puede tipear con o sin código de país.
  const suffix = digits.slice(-Math.min(digits.length, 10));
  const contact = await prisma.contact.findFirst({
    where: { userId: crmUserId, phone: { endsWith: suffix }, stage: { not: "COMPRO" } },
    select: { id: true },
  });
  if (!contact) return;
  await markPurchase(crmUserId, contact.id, value, currency, { eventId });
  console.log(`[billing] CRM: contacto ${contact.id} → COMPRO por pago de user ${userId}`);
}
