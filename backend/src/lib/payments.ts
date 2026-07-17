// Pasarelas de pago (Fase 5+) — MercadoPago, Stripe (tarjeta global) y USDT (cripto vía
// NOWPayments). Todo GATEADO por .env: si falta la clave del proveedor, ese método no
// se ofrece y el checkout cae al stub.
import axios from "axios";
import crypto from "node:crypto";
import Stripe from "stripe";

export type Provider = "mercadopago" | "stripe" | "usdt" | "pagopar";

const APP_BASE_URL = process.env.APP_BASE_URL ?? "http://localhost:4000";
const PANEL_BASE_URL = (process.env.PANEL_BASE_URL ?? "http://localhost:5173").split(",")[0].trim();

// ---- Precio por proveedor -------------------------------------------------
// MercadoPago cobra en moneda local; Stripe y USDT en USD (USDT ~ 1 USD);
// Pagopar cobra en guaraníes (PYG, sin decimales, mínimo Gs. 1.000 por pedido).
const MP_CURRENCY = process.env.MP_CURRENCY ?? "ARS";
const MP_PRICE_PER_DAY = Number(process.env.MP_PRICE_PER_DAY ?? 1000);
const USD_PRICE_PER_DAY = Number(process.env.PRICE_PER_DAY_USD ?? 1);
// Descuento por volumen: a partir de 90 días, tarifa más baja por día.
const USD_PRICE_PER_DAY_90 = Number(process.env.PRICE_PER_DAY_USD_90 ?? 1.5);
const PAGOPAR_PRICE_PER_DAY = Number(process.env.PAGOPAR_PRICE_PER_DAY ?? 7500);

// Precio por día en USD según la cantidad. El pack grande nunca cuesta más que el base.
export function usdPerDay(days: number): number {
  if (days >= 90) return Math.min(USD_PRICE_PER_DAY_90, USD_PRICE_PER_DAY);
  return USD_PRICE_PER_DAY;
}

export function priceFor(provider: Provider, days: number): { amount: number; currency: string } {
  if (provider === "mercadopago") return { amount: days * MP_PRICE_PER_DAY, currency: MP_CURRENCY };
  // Pagopar: guaraníes enteros; el pedido mínimo aceptado por la API es Gs. 1.000.
  if (provider === "pagopar") return { amount: Math.max(1000, Math.round(days * PAGOPAR_PRICE_PER_DAY)), currency: "PYG" };
  return { amount: days * usdPerDay(days), currency: "USD" }; // stripe + usdt
}

// ---- Promos (bundles a precio fijo, independientes del precio por día del selector) ----
// "2meses": 60 días a mitad de precio (1 USD/día = 60 USD ≈ 450.000 PYG). Todo por env.
const PROMO_2M_DAYS = Number(process.env.PROMO_2M_DAYS ?? 60);
const PROMO_2M_USD = Number(process.env.PROMO_2M_USD ?? 60);
const PROMO_2M_PYG = Number(process.env.PROMO_2M_PYG ?? 450000);

export type PromoKey = "2meses";
export interface PromoInfo { key: PromoKey; days: number; usd: number; pyg: number; label: string }

export function promoFor(key: string): PromoInfo | null {
  if (key === "2meses") return { key: "2meses", days: PROMO_2M_DAYS, usd: PROMO_2M_USD, pyg: PROMO_2M_PYG, label: "Promo 2 meses" };
  return null;
}

// Precio de una promo para un proveedor. Pagopar en PYG; stripe/usdt en USD.
export function promoPriceFor(provider: Provider, promo: PromoInfo): { amount: number; currency: string } | null {
  if (provider === "pagopar") return { amount: Math.max(1000, Math.round(promo.pyg)), currency: "PYG" };
  if (provider === "stripe" || provider === "usdt") return { amount: promo.usd, currency: "USD" };
  return null; // mercadopago no soportado para promos
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

// Validación de la firma del webhook de MercadoPago (header x-signature: "ts=...,v1=...").
// Manifest: id:<data.id>;request-id:<x-request-id>;ts:<ts>; firmado con MP_WEBHOOK_SECRET.
const MP_WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET ?? "";
export const mpWebhookSecretSet = () => Boolean(MP_WEBHOOK_SECRET);
export function verifyMpWebhook(p: { xSignature?: string; xRequestId?: string; dataId?: string }): boolean {
  if (!MP_WEBHOOK_SECRET) return false;
  if (!p.xSignature || !p.dataId) return false;
  const parts: Record<string, string> = {};
  for (const kv of p.xSignature.split(",")) {
    const [k, v] = kv.split("=");
    if (k && v) parts[k.trim()] = v.trim();
  }
  const ts = parts["ts"];
  const v1 = parts["v1"];
  if (!ts || !v1) return false;
  const manifest = `id:${p.dataId.toLowerCase()};request-id:${p.xRequestId ?? ""};ts:${ts};`;
  const hmac = crypto.createHmac("sha256", MP_WEBHOOK_SECRET).update(manifest).digest("hex");
  const a = Buffer.from(hmac);
  const b = Buffer.from(v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
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

// ---- USDT directo a wallet propia (red Tron / TRC20) ---------------------
// El cliente paga a TU dirección y verificamos la transacción on-chain (TronGrid).
// Sin procesador ni comisiones. Si no hay dirección, cae a NOWPayments (abajo).
const USDT_ADDRESS = process.env.USDT_TRC20_ADDRESS ?? "";
const TRONGRID_API_KEY = process.env.TRONGRID_API_KEY ?? "";
const USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"; // contrato USDT en TRC20
export const usdtAddress = () => USDT_ADDRESS;
export const usdtDirectEnabled = () => Boolean(USDT_ADDRESS);

// Verifica una transacción USDT-TRC20 on-chain: que exista, sea hacia nuestra dirección
// y por un monto >= al esperado. Devuelve ok + el valor recibido.
export async function verifyUsdtPayment(
  txid: string,
  expectedUsdt: number,
): Promise<{ ok: boolean; reason?: string; valueUsdt?: number }> {
  if (!USDT_ADDRESS) return { ok: false, reason: "USDT directo no configurado." };
  try {
    const headers: Record<string, string> = {};
    if (TRONGRID_API_KEY) headers["TRON-PRO-API-KEY"] = TRONGRID_API_KEY;
    const { data } = await axios.get(
      `https://api.trongrid.io/v1/accounts/${USDT_ADDRESS}/transactions/trc20`,
      { headers, params: { only_to: true, limit: 50, contract_address: USDT_CONTRACT }, timeout: 12000 },
    );
    const list: any[] = Array.isArray(data?.data) ? data.data : [];
    const tx = list.find((t) => String(t.transaction_id).toLowerCase() === txid.toLowerCase());
    if (!tx) {
      return { ok: false, reason: "Transacción no encontrada todavía. Esperá 1-2 min después de confirmar y reintentá." };
    }
    if (String(tx.to) !== USDT_ADDRESS) return { ok: false, reason: "La transacción no es hacia tu dirección." };
    const decimals = Number(tx.token_info?.decimals ?? 6);
    const valueUsdt = Number(tx.value) / Math.pow(10, decimals);
    if (valueUsdt < expectedUsdt - 0.01) {
      return {
        ok: false,
        reason: `El monto recibido (${valueUsdt} USDT) es menor al esperado (${expectedUsdt} USDT).`,
        valueUsdt,
      };
    }
    return { ok: true, valueUsdt };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: `No se pudo verificar en la red: ${message}` };
  }
}

// ---- USDT (cripto vía NOWPayments) — fallback si no hay wallet directa --------
const NOW_API_KEY = process.env.NOWPAYMENTS_API_KEY ?? "";
const NOW_IPN_SECRET = process.env.NOWPAYMENTS_IPN_SECRET ?? "";
export const nowpaymentsEnabled = () => Boolean(NOW_API_KEY);
// "usdt" disponible si hay wallet directa O NOWPayments.
export const usdtEnabled = () => usdtDirectEnabled() || nowpaymentsEnabled();

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
  // Comparación en tiempo constante (consistente con MP/Pagopar); es un endpoint de dinero.
  const a = Buffer.from(hmac);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
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

// ---- Pagopar (Paraguay: tarjetas locales e internacionales, billeteras, QR, PIX) ----
// API: https://soporte.pagopar.com/portal/es/kb/articles/api-integracion-medios-pagos
// Flujo: iniciar-transaccion -> hash_pedido -> redirect a pagopar.com/pagos/<hash> ->
// webhook con token = SHA1(clave_privada + hash_pedido) -> hay que responder 200
// ECHO del resultado (si no, Pagopar reintenta cada 10 minutos).
const PAGOPAR_PUBLIC_KEY = process.env.PAGOPAR_PUBLIC_KEY ?? "";
const PAGOPAR_PRIVATE_KEY = process.env.PAGOPAR_PRIVATE_KEY ?? "";
export const pagoparEnabled = () => Boolean(PAGOPAR_PUBLIC_KEY && PAGOPAR_PRIVATE_KEY);

// SHA1(clave_privada + partes). El monto va como PHP strval(floatval(x)): "7500", "7500.5".
export function pagoparToken(...parts: string[]): string {
  return crypto.createHash("sha1").update(PAGOPAR_PRIVATE_KEY + parts.join("")).digest("hex");
}
export const pagoparAmountString = (amount: number) => String(Number(amount));

// "YYYY-MM-DD HH:mm:ss" en hora de Paraguay (la API rechaza fechas pasadas).
function pagoparDate(date: Date): string {
  const s = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Asuncion",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).format(date);
  return s.replace("T", " ");
}

export interface PagoparBuyer {
  nombre: string;
  documento: string; // CI o RUC sin puntos (5-24 caracteres numéricos)
  email: string;
  telefono?: string;
}

// Crea el pedido en Pagopar y devuelve el hash (id externo) + URL de checkout.
export async function createPagoparOrder(args: {
  paymentId: string;
  days: number;
  buyer: PagoparBuyer;
  amountOverride?: number; // monto en PYG (promo); si no viene, se calcula por priceFor
  descripcionOverride?: string;
}): Promise<{ id: string; url: string }> {
  const amount =
    args.amountOverride != null
      ? Math.max(1000, Math.round(args.amountOverride))
      : priceFor("pagopar", args.days).amount;
  const descripcion = args.descripcionOverride ?? `Publi.lat — ${args.days} día(s) de línea activa`;
  const payload = {
    token: pagoparToken(args.paymentId, pagoparAmountString(amount)),
    public_key: PAGOPAR_PUBLIC_KEY,
    monto_total: amount,
    tipo_pedido: "VENTA-COMERCIO",
    id_pedido_comercio: args.paymentId, // único y case-sensitive; usamos el id del Payment
    forma_pago: 9, // tarjetas (el comprador puede elegir otro medio en el checkout)
    fecha_maxima_pago: pagoparDate(new Date(Date.now() + 48 * 3600_000)),
    descripcion_resumen: descripcion,
    comprador: {
      nombre: args.buyer.nombre,
      documento: args.buyer.documento,
      tipo_documento: "CI",
      email: args.buyer.email,
      telefono: args.buyer.telefono ?? "",
      ruc: "",
      direccion: "",
      ciudad: "1",
      coordenadas: "",
      razon_social: args.buyer.nombre,
      direccion_referencia: null,
    },
    compras_items: [
      {
        id_producto: 1,
        nombre: descripcion,
        descripcion,
        cantidad: 1,
        precio_total: amount,
        categoria: "909",
        ciudad: "1",
        public_key: PAGOPAR_PUBLIC_KEY,
        url_imagen: "",
        vendedor_telefono: "",
        vendedor_direccion: "",
        vendedor_direccion_referencia: "",
        vendedor_direccion_coordenadas: "",
      },
    ],
  };
  const { data } = await axios.post(
    "https://api.pagopar.com/api/comercios/2.0/iniciar-transaccion",
    payload,
    { headers: { "Content-Type": "application/json" }, timeout: 15000 },
  );
  if (!data?.respuesta) {
    throw new Error(typeof data?.resultado === "string" ? data.resultado : "Pagopar rechazó el pedido");
  }
  const hash: string | undefined = data?.resultado?.[0]?.data;
  if (!hash) throw new Error("Pagopar no devolvió el hash del pedido");
  return { id: hash, url: `https://www.pagopar.com/pagos/${hash}` };
}

// Consulta el estado REAL de un pedido, server-to-server (endpoint pedidos/1.1/traer).
// Además de robustecer el webhook, es el "Paso 3" del circuito de certificación que
// Pagopar exige completar en staging para habilitar el pase a producción.
export interface PagoparOrderStatus {
  pagado: boolean;
  cancelado: boolean;
  monto?: string;
  formaPago?: string;
  numeroPedido?: string;
}
export async function getPagoparOrder(hashPedido: string): Promise<PagoparOrderStatus | null> {
  try {
    const { data } = await axios.post(
      "https://api.pagopar.com/api/pedidos/1.1/traer",
      { hash_pedido: hashPedido, token: pagoparToken("CONSULTA"), token_publico: PAGOPAR_PUBLIC_KEY },
      { headers: { "Content-Type": "application/json" }, timeout: 15000 },
    );
    const r = data?.resultado?.[0];
    if (!data?.respuesta || !r) return null;
    return {
      pagado: r.pagado === true,
      cancelado: r.cancelado === true,
      monto: r.monto,
      formaPago: r.forma_pago,
      numeroPedido: r.numero_pedido,
    };
  } catch (e) {
    console.warn("[pagopar] consulta de pedido falló:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

// Valida el token del webhook: SHA1(clave_privada + hash_pedido) === token recibido.
export function verifyPagoparWebhook(hashPedido: string, token: string): boolean {
  if (!PAGOPAR_PRIVATE_KEY || !hashPedido || !token) return false;
  const expected = pagoparToken(hashPedido);
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
