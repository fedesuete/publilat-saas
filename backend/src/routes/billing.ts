// Billing: crédito de "días" + compra real por MercadoPago, Stripe (tarjeta) y USDT
// (cripto vía NOWPayments). Cada proveedor está gateado por .env; sin claves -> stub.
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import {
  type Provider,
  priceFor,
  mpEnabled, createPreference, getMpPayment, mpWebhookSecretSet, verifyMpWebhook,
  stripeEnabled, createStripeSession, constructStripeEvent,
  usdtEnabled, createUsdtInvoice, verifyUsdtSignature,
  nowpaymentsEnabled, usdtDirectEnabled, usdtAddress, verifyUsdtPayment,
  pagoparEnabled, createPagoparOrder, verifyPagoparWebhook,
} from "../lib/payments.js";

export const billingRouter = Router();
// Webhooks públicos (los monta index.ts sin requireAuth).
export const billingWebhookRouter = Router(); // MercadoPago
export const usdtWebhookRouter = Router(); // NOWPayments (USDT)
export const pagoparWebhookRouter = Router(); // Pagopar (Paraguay)

async function ensureCredit(userId: string) {
  return (
    (await prisma.credit.findUnique({ where: { userId } })) ??
    (await prisma.credit.create({ data: { userId, days: 0 } }))
  );
}

// Acredita los días de un pago aprobado. Idempotente (no acredita dos veces).
async function approvePayment(paymentId: string, providerLabel: string): Promise<void> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.status === "approved") return;
  const credit = await ensureCredit(payment.userId);
  await prisma.$transaction([
    prisma.payment.update({ where: { id: payment.id }, data: { status: "approved" } }),
    prisma.credit.update({
      where: { id: credit.id },
      data: {
        days: { increment: payment.days },
        ledger: { create: { delta: payment.days, reason: `compra ${providerLabel} (${payment.days}d)` } },
      },
    }),
  ]);
  console.log(`[billing] ${providerLabel}: +${payment.days} días a user ${payment.userId}`);
}

// GET /api/billing/credit — días disponibles + últimos movimientos + métodos habilitados.
billingRouter.get("/credit", async (req, res) => {
  const credit = await ensureCredit(req.userId!);
  const ledger = await prisma.creditLedger.findMany({
    where: { creditId: credit.id },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { id: true, delta: true, reason: true, createdAt: true },
  });
  return res.json({
    days: credit.days,
    ledger,
    methods: { mercadopago: mpEnabled(), stripe: stripeEnabled(), usdt: usdtEnabled(), pagopar: pagoparEnabled() },
  });
});

// GET /api/billing/quote?days=N — precio por proveedor para esa cantidad de días.
const quoteSchema = z.object({ days: z.coerce.number().int().positive().max(3650) });
billingRouter.get("/quote", (req, res) => {
  const parsed = quoteSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Cantidad de días inválida" });
  const days = parsed.data.days;
  const prices = Object.fromEntries(
    (["mercadopago", "stripe", "usdt", "pagopar"] as Provider[]).map((p) => [p, priceFor(p, days)]),
  );
  return res.json({ days, prices });
});

const addSchema = z.object({ days: z.number().int().positive().max(3650) });

// POST /api/billing/credit/add — suma días SIN pagar. Sólo dev: en producción está
// deshabilitado (los días reales se compran por pasarela o los carga un admin).
billingRouter.post("/credit/add", async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(403).json({ error: "Deshabilitado: comprá días con un medio de pago real." });
  }
  const parsed = addSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido", details: parsed.error.flatten() });
  const credit = await ensureCredit(req.userId!);
  const updated = await prisma.credit.update({
    where: { id: credit.id },
    data: { days: { increment: parsed.data.days }, ledger: { create: { delta: parsed.data.days, reason: "compra (stub)" } } },
  });
  return res.json({ days: updated.days });
});

const checkoutSchema = z.object({
  days: z.number().int().positive().max(3650),
  provider: z.enum(["mercadopago", "stripe", "usdt", "pagopar"]),
  // Pagopar exige los datos del comprador para crear el pedido (CI/RUC sin puntos).
  buyer: z
    .object({
      nombre: z.string().trim().min(3).max(80),
      documento: z.string().trim().regex(/^\d{5,24}$/, "CI/RUC: solo números, 5 a 24 dígitos"),
      telefono: z.string().trim().max(30).optional(),
    })
    .optional(),
});

// POST /api/billing/checkout — inicia el pago con el proveedor elegido. Devuelve la URL
// de checkout. Si el proveedor no está configurado -> { stub:true }.
billingRouter.post("/checkout", async (req, res) => {
  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido", details: parsed.error.flatten() });
  const { days, provider, buyer } = parsed.data;
  const { amount, currency } = priceFor(provider, days);

  const enabled =
    provider === "mercadopago" ? mpEnabled()
    : provider === "stripe" ? stripeEnabled()
    : provider === "pagopar" ? pagoparEnabled()
    : usdtEnabled();
  if (!enabled) {
    return res.json({ stub: true, provider, amount, currency, message: `Pasarela ${provider} no configurada. Usá 'agregar días' en dev.` });
  }
  if (provider === "pagopar" && !buyer) {
    return res.status(400).json({ error: "Pagopar necesita nombre y CI/RUC del comprador." });
  }

  const payment = await prisma.payment.create({
    data: { userId: req.userId!, provider, days, amount: Math.round(amount * 100), currency, status: "pending" },
  });

  // USDT directo a wallet propia: no hay URL; el cliente paga a la dirección y luego
  // verifica el TXID. (Si hay NOWPayments configurado, se prioriza el invoice de abajo.)
  if (provider === "usdt" && !nowpaymentsEnabled() && usdtDirectEnabled()) {
    return res.json({
      direct: true,
      provider: "usdt",
      address: usdtAddress(),
      network: "TRC20",
      amountUsdt: amount,
      paymentId: payment.id,
    });
  }

  try {
    const out =
      provider === "mercadopago" ? await createPreference({ paymentId: payment.id, days })
      : provider === "stripe" ? await createStripeSession({ paymentId: payment.id, days })
      : provider === "pagopar"
        ? await (async () => {
            const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { email: true } });
            return createPagoparOrder({
              paymentId: payment.id,
              days,
              buyer: { nombre: buyer!.nombre, documento: buyer!.documento, telefono: buyer!.telefono, email: user?.email ?? "" },
            });
          })()
      : await createUsdtInvoice({ paymentId: payment.id, days });
    await prisma.payment.update({ where: { id: payment.id }, data: { externalId: out.id } });
    return res.json({ stub: false, provider, url: out.url, paymentId: payment.id });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error(`[billing/checkout] ${provider} falló:`, detail);
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "rejected" } });
    return res.status(502).json({ error: "No se pudo crear el checkout", detail });
  }
});

const verifySchema = z.object({
  paymentId: z.string().min(1),
  txid: z.string().trim().min(10).max(120),
});

// POST /api/billing/usdt/verify — verifica el pago USDT directo on-chain y acredita días.
billingRouter.post("/usdt/verify", async (req, res) => {
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "Input inválido" });
  const { paymentId, txid } = parsed.data;

  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, userId: req.userId!, provider: "usdt" },
  });
  if (!payment) return res.status(404).json({ ok: false, error: "Pago no encontrado" });
  if (payment.status === "approved") return res.json({ ok: true, alreadyApproved: true });

  // Anti-reuso: un mismo TXID no puede acreditar dos pagos.
  const dup = await prisma.payment.findFirst({ where: { externalId: txid, status: "approved" } });
  if (dup) return res.status(409).json({ ok: false, error: "Ese TXID ya fue usado para otro pago." });

  const expectedUsdt = (payment.amount ?? 0) / 100;
  const result = await verifyUsdtPayment(txid, expectedUsdt);
  if (!result.ok) return res.status(400).json({ ok: false, error: result.reason });

  await prisma.payment.update({ where: { id: payment.id }, data: { externalId: txid } });
  await approvePayment(payment.id, "USDT");
  return res.json({ ok: true, valueUsdt: result.valueUsdt, days: payment.days });
});

// --- Webhook MercadoPago ---
billingWebhookRouter.post("/", async (req, res) => {
  res.json({ ok: true });
  try {
    if (!mpEnabled()) return;
    const paymentMpId = String(req.query["data.id"] ?? req.body?.data?.id ?? req.body?.id ?? "");
    const topic = String(req.query.type ?? req.query.topic ?? req.body?.type ?? "");
    if (!paymentMpId || (topic && topic !== "payment")) return;

    // Validar la firma del webhook (si hay secret configurado). Sin secret: se procesa
    // pero se avisa (recomendado setear MP_WEBHOOK_SECRET al activar MercadoPago).
    if (mpWebhookSecretSet()) {
      const ok = verifyMpWebhook({
        xSignature: req.headers["x-signature"] as string | undefined,
        xRequestId: req.headers["x-request-id"] as string | undefined,
        dataId: paymentMpId,
      });
      if (!ok) {
        console.warn("[billing/webhook mp] firma x-signature inválida -> ignorado");
        return;
      }
    } else {
      console.warn("[billing/webhook mp] MP_WEBHOOK_SECRET no configurado: webhook sin validar firma");
    }
    const { status, externalReference } = await getMpPayment(paymentMpId);
    if (!externalReference) return;
    if (status === "approved") await approvePayment(externalReference, "MercadoPago");
    else if (status === "rejected" || status === "cancelled")
      await prisma.payment.updateMany({ where: { id: externalReference, status: "pending" }, data: { status: "rejected" } });
  } catch (e) {
    console.error("[billing/webhook mp] error:", e instanceof Error ? e.message : String(e));
  }
});

// --- Webhook Stripe (body CRUDO: lo monta index.ts con express.raw antes del json) ---
export async function stripeWebhookHandler(req: Request, res: Response): Promise<void> {
  if (!stripeEnabled()) {
    res.status(503).end();
    return;
  }
  const sig = req.headers["stripe-signature"];
  try {
    const event = constructStripeEvent(req.body as Buffer, String(sig));
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as { metadata?: { paymentId?: string }; client_reference_id?: string };
      const paymentId = session.metadata?.paymentId ?? session.client_reference_id;
      if (paymentId) await approvePayment(paymentId, "Stripe");
    }
    res.json({ received: true });
  } catch (e) {
    console.error("[billing/webhook stripe] error:", e instanceof Error ? e.message : String(e));
    res.status(400).send("invalid signature");
  }
}

// --- Webhook Pagopar ---
// Pagopar POSTea { respuesta, resultado: [ { pagado, cancelado, hash_pedido, token, ... } ] }
// con token = SHA1(clave_privada + hash_pedido). Hay que responder 200 con el ECHO del
// resultado; si no devolvemos 200, Pagopar reintenta cada 10 minutos.
pagoparWebhookRouter.post("/", async (req, res) => {
  try {
    if (!pagoparEnabled()) return res.status(503).json({ error: "Pagopar no configurado" });
    const r = req.body?.resultado?.[0] ?? {};
    const hashPedido = String(r.hash_pedido ?? "");
    const token = String(r.token ?? "");
    if (!hashPedido || !token) {
      // Prueba de conexión / ping sin datos de pago: OK para no quedar en loop de reintentos.
      return res.json({ ok: true });
    }
    if (!verifyPagoparWebhook(hashPedido, token)) {
      console.warn("[billing/webhook pagopar] token inválido -> rechazado");
      return res.status(400).json({ error: "token inválido" });
    }

    const payment = await prisma.payment.findFirst({ where: { externalId: hashPedido, provider: "pagopar" } });
    if (payment) {
      if (r.pagado === true) {
        await approvePayment(payment.id, "Pagopar");
      } else if (r.cancelado === true) {
        await prisma.payment.updateMany({ where: { id: payment.id, status: "pending" }, data: { status: "rejected" } });
      } else if (r.pagado === false && payment.status === "approved") {
        // Reversa de un pago ya acreditado: no descontamos días automáticamente; queda para revisión.
        console.warn(`[billing/webhook pagopar] REVERSA sobre pago aprobado ${payment.id} (hash ${hashPedido})`);
      }
    } else {
      console.warn(`[billing/webhook pagopar] hash sin Payment asociado: ${hashPedido}`);
    }

    // Echo obligatorio (HTTP 200) para que Pagopar dé por notificado el pedido.
    return res.json([
      {
        pagado: r.pagado,
        numero_comprobante_interno: r.numero_comprobante_interno,
        hash_pedido: hashPedido,
        token,
      },
    ]);
  } catch (e) {
    console.error("[billing/webhook pagopar] error:", e instanceof Error ? e.message : String(e));
    return res.status(500).json({ error: "error interno" });
  }
});

// --- Webhook USDT (NOWPayments IPN) ---
usdtWebhookRouter.post("/", async (req, res) => {
  res.json({ ok: true });
  try {
    if (!usdtEnabled()) return;
    const sig = req.headers["x-nowpayments-sig"] as string | undefined;
    if (!verifyUsdtSignature(req.body, sig)) {
      console.warn("[billing/webhook usdt] firma inválida");
      return;
    }
    const status = String(req.body?.payment_status ?? "");
    const paymentId = String(req.body?.order_id ?? "");
    if (!paymentId) return;
    if (status === "finished" || status === "confirmed") await approvePayment(paymentId, "USDT");
    else if (status === "failed" || status === "expired" || status === "refunded")
      await prisma.payment.updateMany({ where: { id: paymentId, status: "pending" }, data: { status: "rejected" } });
  } catch (e) {
    console.error("[billing/webhook usdt] error:", e instanceof Error ? e.message : String(e));
  }
});
