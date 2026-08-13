// Auto-detección de PROXY INESTABLE. Un proxy residencial puede PASAR el probe HTTP (queda "healthy")
// pero cortar el WebSocket a WhatsApp todo el tiempo. Se ve como un ALUVIÓN de connection.update: una
// línea sana genera ~300 eventos en 16 h; una con proxy podrido, miles (caso real: lorenzo = 9072,
// 610 "Connection Terminated" en una noche = 8x cualquier otra). Cuando una línea supera un umbral de
// reconexiones en una ventana, se le ROTA el IP automáticamente + se avisa al admin. Cooldown para no
// rotar en loop. Kill switch: PROXY_AUTOROTATE=off.
import { prisma } from "./prisma.js";
import { rotateProxy, alertAdminProxy, logProxyEvent, IPROYAL_PROVIDER } from "./proxy-pool.js";

const WINDOW_MS = 20 * 60 * 1000; // ventana de 20 min
const THRESHOLD = 60; // >60 reconexiones en 20 min = proxy inestable (una línea sana casi no reconecta)
const COOLDOWN_MS = 2 * 60 * 60 * 1000; // no auto-rotar la misma línea más de 1 vez cada 2 h

const buckets = new Map<string, number[]>(); // lineId -> timestamps de reconexión
const lastRotate = new Map<string, number>(); // lineId -> ts del último auto-rotate

// FASE 4 (monitor) — flaps por línea desde el último sample. Independiente del autorotate: cuenta SIEMPRE
// (aunque PROXY_AUTOROTATE esté off), para medir la estabilidad. El sample de 5 min lo lee y resetea.
const monitorFlaps = new Map<string, number>();
export function takeMonitorFlaps(lineId: string): number {
  const n = monitorFlaps.get(lineId) ?? 0;
  monitorFlaps.set(lineId, 0);
  return n;
}

function enabled(): boolean {
  return (process.env.PROXY_AUTOROTATE ?? "on").trim().toLowerCase() !== "off";
}

// Se llama en CADA connection.update donde la línea NO quedó conectada (drop/reconnecting). Best-effort.
export function recordProxyFlap(line: { id: string; proxyId: string | null }): void {
  if (!line.proxyId) return; // sin proxy gestionado no hay nada que medir ni rotar
  monitorFlaps.set(line.id, (monitorFlaps.get(line.id) ?? 0) + 1); // contador del monitor (siempre)
  if (!enabled()) return; // autorotate apagado: contamos igual, pero no rotamos
  const now = Date.now();
  const arr = (buckets.get(line.id) ?? []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  buckets.set(line.id, arr);
  if (arr.length < THRESHOLD) return;
  if (now - (lastRotate.get(line.id) ?? 0) < COOLDOWN_MS) return; // ya se rotó hace poco: esperamos
  lastRotate.set(line.id, now);
  buckets.set(line.id, []);
  void autoRotate(line.id, arr.length);
}

async function autoRotate(lineId: string, flaps: number): Promise<void> {
  try {
    // IPRoyal (sticky 7d): NUNCA rotamos por flap. La IP AR sólo debe cambiar ante un ban real; ante una
    // caída transitoria la línea se reconecta con la MISMA IP (recoverProxyLine ya lo hace, sin rotar).
    // Rotar acá rompería el sticky = justo el flapping que queremos matar. Sólo lo registramos (Fase 4).
    const l = await prisma.waLine.findUnique({ where: { id: lineId }, select: { proxyId: true, proxy: { select: { provider: true } } } });
    if (l?.proxy?.provider === IPROYAL_PROVIDER) {
      await logProxyEvent(lineId, l.proxyId, "unstable", `${flaps} reconexiones/20min — IPRoyal sticky: NO se rota (se reconecta con la misma IP)`);
      return;
    }
    await logProxyEvent(lineId, null, "unstable", `${flaps} reconexiones en 20 min: el proxy corta el WebSocket -> auto-rotando IP`);
    const r = await rotateProxy(lineId);
    await alertAdminProxy(
      r.ok ? "🔄 Proxy inestable auto-rotado" : "⚠️ Proxy inestable (no se pudo rotar solo)",
      `La línea ${lineId} tuvo ${flaps}+ reconexiones en 20 min: su proxy pasaba el chequeo HTTP pero cortaba el WebSocket a WhatsApp. ` +
        (r.ok
          ? "Se le rotó el IP automáticamente."
          : `NO se pudo rotar (${r.reason ?? "?"}). Cambiá el proxy a mano o pasá la línea a un proxy ESTÁTICO.`),
      "unstable",
      { lineId, flaps },
    );
    console.warn(`[proxy-flap] línea ${lineId}: ${flaps} reconexiones/20min -> auto-rotate ${r.ok ? "OK (" + r.proxyId + ")" : "FALLÓ (" + r.reason + ")"}`);
  } catch (e) {
    console.error("[proxy-flap] auto-rotate error", lineId, e instanceof Error ? e.message : String(e));
  }
}
