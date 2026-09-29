// Pagos que quedaron A MEDIO HACER (y que hasta ahora nadie veía).
//
// Por qué existe (2026-09-29): un cliente avisó que "no lo deja pagar". Mirando los datos, el checkout
// NUNCA falló de nuestro lado (0 errores en 7 días): el pedido se crea bien, el cliente se va al
// checkout de Pagopar y ahí se cae (tarjeta rechazada, cerró la pestaña, se quedó sin datos). El
// problema es lo que pasa DESPUÉS:
//
//   1. El link del checkout vive 48 h, pero el cliente no tenía cómo volver a él. Si cerraba la
//      pestaña, el link se perdía y para reintentar tenía que empezar todo de cero. leadsale30 armó
//      SEIS pedidos hoy antes de que uno le saliera; freydisgap armó siete el 09-04 y no pagó ninguno.
//   2. El panel no le decía nada: volvía a la misma pantalla, sin días y sin explicación.
//   3. Nadie del lado nuestro se enteraba. En 30 días quedaron 22 pagos colgados = 22 ventas que se
//      perdieron en silencio, y el dueño solo se entera cuando el cliente se queja por WhatsApp.
//
// Acá se resuelven las tres: el link se reconstruye (es determinístico desde el hash que ya
// guardamos), se le pregunta a Pagopar qué pasó DE VERDAD, y se avisa antes de perder la venta.
import { prisma } from "./prisma.js";
import { getPagoparOrder, usdtAddress } from "./payments.js";
import { approvePayment } from "./billing-approve.js";

/** Pagopar da 48 h para pagar un pedido (fecha_maxima_pago). Pasado eso el link ya no sirve. */
export const VENTANA_H = Number(process.env.PAGO_PENDIENTE_HORAS ?? "48");
/** A partir de acá un pago empezado y no terminado ya es una venta en riesgo: avisamos. */
export const COLGADO_MIN = Number(process.env.PAGO_COLGADO_MIN ?? "30");
/** Cada cuánto se puede repetir el aviso por el MISMO pago (el job corre seguido). */
const REAVISO_MS = Number(process.env.PAGO_REAVISO_HORAS ?? "12") * 3600_000;

const yaAvisado = new Map<string, number>();

/** El checkout de Pagopar es siempre esta URL + el hash del pedido: no hace falta guardarla. */
export function checkoutUrl(hash: string): string {
  return `https://www.pagopar.com/pagos/${hash}`;
}

export type EstadoPago = "abierto" | "acreditado" | "no_completado";

export interface PagoColgado {
  paymentId: string;
  userId: string;
  email: string;
  provider: string;
  days: number;
  amount: number;
  currency: string;
  minutos: number;
  estado: EstadoPago;
  /** Link para volver al checkout (Pagopar) — solo si sigue abierto. */
  url?: string;
  /** Datos para terminar un pago USDT directo (dirección + monto) — solo si sigue abierto. */
  usdt?: { address: string; amountUsdt: number };
}

interface PagoRow {
  id: string;
  userId: string;
  provider: string;
  externalId: string | null;
  days: number;
  amount: number | null;
  currency: string | null;
  status: string;
  createdAt: Date;
}

/**
 * Qué pasó realmente con un pago que figura "pending". Le pregunta a Pagopar y, de paso, arregla lo
 * que encuentra mal: si el cliente PAGÓ y el aviso nunca nos llegó, se acreditan los días acá
 * (approvePayment es idempotente); si el pedido se canceló, se marca rechazado y deja de figurar
 * como pendiente eterno.
 */
export async function resolverPago(p: PagoRow): Promise<EstadoPago> {
  if (p.status === "approved") return "acreditado";
  if (p.status !== "pending") return "no_completado";

  // USDT directo: no hay a quién preguntarle. El pago se cierra cuando el cliente pega el TXID.
  if (p.provider !== "pagopar" || !p.externalId) return "abierto";

  const orden = await getPagoparOrder(p.externalId);
  if (!orden) return "abierto"; // no pudimos consultar (red): lo dejamos como está
  if (orden.pagado) {
    // Pagó y el webhook no llegó (o llegó y falló). Se acredita ahora: es plata que ya entró.
    await approvePayment(p.id, "Pagopar");
    return "acreditado";
  }
  if (orden.cancelado) {
    await prisma.payment.updateMany({ where: { id: p.id, status: "pending" }, data: { status: "rejected" } });
    return "no_completado";
  }
  return "abierto";
}

function aColgado(p: PagoRow, email: string, estado: EstadoPago): PagoColgado {
  const monto = (p.amount ?? 0) / 100;
  const out: PagoColgado = {
    paymentId: p.id,
    userId: p.userId,
    email,
    provider: p.provider,
    days: p.days,
    amount: monto,
    currency: p.currency ?? "USD",
    minutos: Math.round((Date.now() - p.createdAt.getTime()) / 60_000),
    estado,
  };
  if (estado === "abierto") {
    if (p.provider === "pagopar" && p.externalId) out.url = checkoutUrl(p.externalId);
    if (p.provider === "usdt" && !p.externalId) {
      const dir = usdtAddress();
      if (dir) out.usdt = { address: dir, amountUsdt: monto };
    }
  }
  return out;
}

/**
 * El pago a medio terminar MÁS RECIENTE de un cliente, para mostrárselo en el panel. Devuelve null
 * si no tiene ninguno dentro de la ventana. Si el estado cambió (pagó / se canceló) lo arregla y lo
 * informa, así el cliente ve qué pasó en vez de una pantalla muda.
 */
export async function pagoPendiente(userId: string): Promise<PagoColgado | null> {
  const desde = new Date(Date.now() - VENTANA_H * 3600e3);
  const p = await prisma.payment.findFirst({
    where: { userId, status: "pending", createdAt: { gte: desde } },
    orderBy: { createdAt: "desc" },
    select: { id: true, userId: true, provider: true, externalId: true, days: true, amount: true, currency: true, status: true, createdAt: true },
  });
  if (!p) return null;
  const estado = await resolverPago(p);
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  return aColgado(p, u?.email ?? userId, estado);
}

/**
 * Todas las ventas a medio hacer, una por cliente (la más reciente). Para el aviso al dueño: es plata
 * que está por perderse y se puede rescatar con un mensaje.
 */
export async function pagosColgados(minMinutos: number = COLGADO_MIN): Promise<PagoColgado[]> {
  const desde = new Date(Date.now() - VENTANA_H * 3600e3);
  const hasta = new Date(Date.now() - minMinutos * 60_000);
  const rows = await prisma.payment.findMany({
    where: { status: "pending", createdAt: { gte: desde, lte: hasta } },
    orderBy: { createdAt: "desc" },
    select: { id: true, userId: true, provider: true, externalId: true, days: true, amount: true, currency: true, status: true, createdAt: true },
  });
  const out: PagoColgado[] = [];
  const vistos = new Set<string>();
  for (const p of rows) {
    if (vistos.has(p.userId)) continue; // un cliente que reintentó 6 veces es UNA venta, no seis
    vistos.add(p.userId);
    const estado = await resolverPago(p);
    if (estado !== "abierto") continue; // ya se acreditó o se canceló: no hay nada que rescatar
    const u = await prisma.user.findUnique({ where: { id: p.userId }, select: { email: true } });
    out.push(aColgado(p, u?.email ?? p.userId, estado));
  }
  return out.sort((a, b) => b.minutos - a.minutos);
}

/** Deja pasar solo los pagos por los que no avisamos hace poco. Marca los que quedan. */
export function paraAvisarPago(pagos: PagoColgado[], now: number = Date.now()): PagoColgado[] {
  const nuevos = pagos.filter((p) => now - (yaAvisado.get(p.paymentId) ?? 0) >= REAVISO_MS);
  for (const p of nuevos) yaAvisado.set(p.paymentId, now);
  return nuevos;
}

/** Para los tests. */
export function reiniciarAvisosPago(): void {
  yaAvisado.clear();
}

const horasYMin = (min: number): string => (min < 90 ? `${min} min` : `${Math.round(min / 60)} h`);

/** Texto del aviso al dueño. Aparte para poder testearlo sin red ni base. */
export function textoPagosColgados(pagos: PagoColgado[]): string {
  const l = [
    pagos.length === 1
      ? "Hay 1 cliente que empezó a pagar y no terminó:"
      : `Hay ${pagos.length} clientes que empezaron a pagar y no terminaron:`,
    "",
  ];
  for (const p of pagos.slice(0, 5)) {
    l.push(`• ${p.email} — ${p.days} días por ${p.amount.toLocaleString("es-AR")} ${p.currency}, hace ${horasYMin(p.minutos)}`);
    if (p.url) l.push(`  El link le sigue sirviendo: ${p.url}`);
    if (p.usdt) l.push("  Eligió USDT y nunca pegó el comprobante.");
  }
  if (pagos.length > 5) l.push(`…y ${pagos.length - 5} más.`);
  l.push("");
  l.push("El pedido no falló de nuestro lado: lo dejaron a medias en la pasarela. Pasale el link y se");
  l.push("acredita solo, o averiguá si le rebotó la tarjeta.");
  return l.join("\n");
}
