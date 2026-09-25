// MODO EMERGENCIA: quedarse sin saldo de proxy NO puede tirar abajo el WhatsApp de todos los clientes.
//
// Hasta hoy el diseño era "sin proxy sano la línea NO conecta, nunca por la IP del VPS"
// (setLineWaitingProxy). La intención era buena —no juntar todos los números en una sola IP— pero el
// resultado real, dos veces en tres días, fue que al agotarse los GB se cayeron TODAS las líneas con
// proxy a la vez: los clientes sin WhatsApp hasta que alguien mirara el saldo.
//
// Entre "el número sigue trabajando por la IP del servidor" y "el número está muerto", lo segundo es
// peor con diferencia: sin línea no entra ni un mensaje y el cliente igual paga el día. Así que cuando
// el proveedor de proxies se cae (saldo en cero o ningún proxy sano), las líneas siguen trabajando
// SIN proxy y se avisa fuerte. Cuando el pool vuelve, el job de siempre (recoverWaitingProxyLines,
// cada 2 min) les devuelve un proxy solo: por eso se las deja marcadas con proxyWait.
//
// Se puede apagar con PROXY_FALLBACK_DIRECTO=off (vuelve al comportamiento viejo: línea muerta).
import { prisma } from "./prisma.js";
import { getEngine } from "./wa-engine.js";
import { logProxyEvent } from "./proxy-pool.js";

// Por debajo de estos GB damos el proveedor por caído y salimos a la IP directa ANTES de que las
// líneas empiecen a fallar de a una.
export const EMERGENCIA_GB = Number(process.env.PROXY_EMERGENCIA_GB ?? "0.05");

export function fallbackDirectoActivo(): boolean {
  return (process.env.PROXY_FALLBACK_DIRECTO ?? "on").trim().toLowerCase() !== "off";
}

/**
 * ¿Hay que salir a la IP directa? Solo cuando el problema es del PROVEEDOR (saldo agotado o ningún
 * proxy sano), no cuando falla una línea suelta: ahí conviene reintentar con otro proxy del pool.
 * `saldoGb` null = no se pudo leer el saldo; en ese caso manda solo la salud del pool.
 */
export function hayQueIrDirecto(saldoGb: number | null, hayProxySano: boolean): boolean {
  if (!fallbackDirectoActivo()) return false;
  if (saldoGb != null && saldoGb < EMERGENCIA_GB) return true;
  return !hayProxySano;
}

/** ¿Queda algún proxy del pool utilizable (activo, sano y con cupo)? */
export async function hayProxySano(): Promise<boolean> {
  const proxies = await prisma.proxy
    .findMany({ where: { active: true, healthy: true }, select: { maxLines: true, _count: { select: { lines: true } } } })
    .catch(() => []);
  return proxies.some((p) => p._count.lines < p.maxLines);
}

/**
 * Saca el proxy de la sesión VIVA de una línea para que siga trabajando por la IP del servidor.
 * Queda con proxyWait=true: el job de recupero le devuelve un proxy en cuanto el pool vuelva.
 */
export async function pasarLineaADirecto(lineId: string, motivo: string): Promise<boolean> {
  const line = await prisma.waLine
    .findUnique({ where: { id: lineId }, select: { id: true, sessionId: true, provider: true, status: true, banned: true, proxyId: true } })
    .catch(() => null);
  if (!line || line.provider === "cloud" || line.banned || line.status === "paused") return false;
  const inst = line.sessionId ?? `line_${lineId}`;
  try {
    await getEngine().setProxy(inst, null); // PUT config sin proxy + arranque: la sesión sale directo
  } catch (e) {
    console.warn(`[proxy-emergencia] no pude sacar el proxy de ${lineId}:`, e instanceof Error ? e.message : String(e));
    return false;
  }
  await prisma.waLine
    .update({ where: { id: lineId }, data: { proxyId: null, proxySession: null, proxyWait: true } })
    .catch(() => undefined);
  await logProxyEvent(lineId, line.proxyId ?? null, "proxy_unhealthy", `emergencia: sigue SIN proxy (${motivo})`).catch(() => undefined);
  return true;
}

/**
 * Pasa a IP directa todas las líneas EN SERVICIO que hoy usan proxy. Devuelve cuántas movió.
 * Se llama cuando el proveedor está caído; es idempotente (las que ya están sin proxy no se tocan).
 */
export async function modoEmergencia(motivo: string): Promise<number> {
  if (!fallbackDirectoActivo()) return 0;
  const lineas = await prisma.waLine
    .findMany({
      where: { proxyId: { not: null }, provider: { not: "cloud" }, banned: false, status: "active", expiresAt: { gt: new Date() } },
      select: { id: true, phone: true },
    })
    .catch(() => []);
  let movidas = 0;
  for (const l of lineas) if (await pasarLineaADirecto(l.id, motivo)) movidas++;
  if (movidas) console.warn(`[proxy-emergencia] ${movidas} línea(s) pasaron a la IP del servidor (${motivo})`);
  return movidas;
}

/** Texto del aviso al dueño. Separado para poder testearlo. */
export function textoEmergencia(movidas: number, motivo: string): string {
  return (
    `Me quedé sin proxy (${motivo}).\n\n` +
    `Para que NO se caiga el WhatsApp de nadie, ${movidas} línea(s) siguen trabajando por la IP del servidor. ` +
    `Funcionan normal, pero comparten IP entre sí: conviene recargar pronto.\n\n` +
    `Apenas haya proxy de nuevo, vuelven solas a su IP propia (el sistema las reengancha cada 2 minutos).`
  );
}
