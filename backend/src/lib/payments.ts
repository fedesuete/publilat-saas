// Pasarelas de pago (Fase 5+) — MercadoPago, Stripe (tarjeta global) y USDT (cripto vía
// NOWPayments). Todo GATEADO por .env: si falta la clave del proveedor, ese método no
// se ofrece y el checkout cae al stub.
import axios from "axios";
import crypto from "node:crypto";
import Stripe from "stripe";

export type Provider = "mercadopago" | "stripe" | "usdt";

const APP_BASE_URL = process.env.APP_BASE_URL ?? "http://localhost:4000";
const PANEL_BASE_URL = (process.env.PANEL_BASE_URL ?? "http://localhost:5173").split(",")[0].trim();

// ---- Precio por proveedor -------------------------------------------------
// MercadoPago cobra en moneda local; Stripe y USDT en USD (USDT ~ 1 USD).
const MP_CURRENCY = process.env.MP_CURRENCY ?? "ARS";
const MP_PRICE_PER_DAY = Number(process.env.MP_PRICE_PER_DAY ?? 1000);
const USD_PRICE_PER_DAY = Number(process.env.PRICE_PER_DAY_USD ?? 1);

export function priceFor(provider: Provider, days: number): { amount: number; currency: string } {
  if (provider === "mercadopago") return { amount: days * MP_PRICE_PER_DAY, currency: MP_CURRENCY };
  return { amount: days * USD_PRICE_PER_DAY, currency: "USD" }; // stripe + usdt
}

// ---- MercadoPago ----------------------------------------------------------
const MP_TOKEN = process.env.MP_ACCESS_TOKEN ?? "";
export const mpEnabled = () => Boolean(MP_TOKEN);

export async function createPreference(args: { paymentId: string; days: number }): Promise<{ id: string; url: string }> {
  const { amount, currency } = priceFor("mercadopago", args.days);
  const { data } = await axios.post(
    "https://api.mercadopago.com/checkout/preferences",
    {
      items: [{ title: `Publi.lat — ${args.days} día(s)`, quantity: 1, unit_price: amount, currency_id: currency }],
      external_reference: args.paymentId,
      notification_url: `${APP_BASE_URL}/api/billing/webhook`,
      back_urls: {
        success: `${PANEL_BASE_URL}/billing?status=success`,
        failure: `${PANEL_BASE_URL}/billing?status=failure`,
        pending: `${PANEL_BASE_URL}/billing?status=pending`,
      },
      auto_return: "approved",
    },
    { headers: { Authorization: `Bearer ${MP_TOKEN}` }, timeout: 12000 }
  );
  return { id: data.id, url: data.init_point ?? data.sandbox_init_point };
}

export async function getMpPayment(paymentId: string): Promise<{ status: string; externalReference: string | null }> {
  const { data } = await axios.get(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${MP_TOKEN}` },
    timeout: 12000,
  });
  return { status: data.status, externalReference: data.external_reference ?? null };
}

// ---- Stripe (tarjeta, global) --------------------------------------------
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY ?? "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";
export const stripeEnabled = () => Boolean(STRIPE_KEY);

let stripeClient: Stripe | null = null;
function stripe(): Stripe {
  if (!stripeClient) stripeClient = new Stripe(STRIPE_KEY);
  return stripeClient;
}

export async function createStripeSession(args: { paymentId: string; days: number }): Promise<{ id: string; url: string }> {
  const { amount, currency } = priceFor("stripe", args.days);
  const session = await stripe().checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: currency.toLowerCase(),
          unit_amount: Math.round(amount * 100), // Stripe cobra en centavos
          product_data: { name: `Publi.lat — ${args.days} día(s) de línea activa` },
        },
      },
    ],
    client_reference_id: args.paymentId,
    metadata: { paymentId: args.paymentId },
    success_url: `${PANEL_BASE_URL}/billing?status=success`,
    cancel_url: `${PANEL_BASE_URL}/billing?status=failure`,
  });
  return { id: session.id, url: session.url ?? "" };
}

// Verifica la firma del webhook de Stripe con el body crudo. Lanza si no valida.
export function constructStripeEvent(rawBody: Buffer, signature: string): Stripe.Event {
  return stripe().webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET);
}

// ---- USDT (cripto vía NOWPayments) ---------------------------------------
const NOW_API_KEY = process.env.NOWPAYMENTS_API_KEY ?? "";
const NOW_IPN_SECRET = process.env.NOWPAYMENTS_IPN_SECRET ?? "";
export const usdtEnabled = () => Boolean(NOW_API_KEY);

export async function createUsdtInvoice(args: { paymentId: string; days: number }): Promise<{ id: string; url: string }> {
  const { amount } = priceFor("usdt", args.days);
  const { data } = await axios.post(
    "https://api.nowpayments.io/v1/invoice",
    {
      price_amount: amount,
      price_currency: "usd",
      pay_currency: process.env.NOWPAYMENTS_PAY_CURRENCY ?? "usdttrc20",
      order_id: args.paymentId,
      order_description: `Publi.lat — ${args.days} día(s)`,
      ipn_callback_url: `${APP_BASE_URL}/api/billing/webhook/usdt`,
      success_url: `${PANEL_BASE_URL}/billing?status=success`,
      cancel_url: `${PANEL_BASE_URL}/billing?status=failure`,
    },
    { headers: { "x-api-key": NOW_API_KEY, "Content-Type": "application/json" }, timeout: 12000 }
  );
  return { id: String(data.id ?? ""), url: data.invoice_url };
}

// Verifica la firma IPN de NOWPayments (HMAC-SHA512 sobre el JSON con claves ordenadas).
export function verifyUsdtSignature(body: unknown, signature: string | undefined): boolean {
  if (!NOW_IPN_SECRET || !signature) return false;
  const sorted = JSON.stringify(sortKeys(body));
  const hmac = crypto.createHmac("sha512", NOW_IPN_SECRET).update(sorted).digest("hex");
  return hmac === signature;
}

function sortKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(sortKeys);
  if (obj && typeof obj === "object") {
    return Object.keys(obj as Record<string, unknown>)
      .sort()
      .reduce((acc, k) => {
        acc[k] = sortKeys((obj as Record<string, unknown>)[k]);
        return acc;
      }, {} as Record<string, unknown>);
  }
  return obj;
}
