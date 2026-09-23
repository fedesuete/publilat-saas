// Candado de sesión de WhatsApp: evita que los mecanismos AUTOMÁTICOS (salud de línea, recupero
// rápido, recupero por proxy, vigía de registro) pisen una sesión que (a) el usuario está conectando
// o escaneando ahora mismo, (b) ya fue reiniciada hace poco, o (c) ya se reinició demasiadas veces
// en la última hora.
//
// Por qué existe (incidente 2026-09-16, naturalcosmetica / lorenzo): cuatro mecanismos distintos
// reiniciaban, deslogueaban y recreaban la MISMA sesión sin coordinarse — casi 2.000 órdenes en 40
// minutos. La sesión nunca terminaba de arrancar, el QR no aparecía y, cuando el cliente lograba
// escanear, otro reinicio le tiraba la sesión. WhatsApp además RESTRINGE los números que flapean
// así: el cliente quemó 3 números en un día pagando días de crédito por una línea que no andaba.
//
// Estado en memoria: el worker de BullMQ y la API corren en el MISMO proceso, así que un Map
// alcanza. Se pierde en cada deploy (arranca "limpio"), lo cual es aceptable.
import { getEngine } from "./wa-engine.js";

const USER_WINDOW_MS = 10 * 60_000;      // "el usuario está en eso": nada automático toca la sesión
const COOLDOWN_MS = 3 * 60_000;          // mínimo entre reinicios automáticos de la MISMA sesión
const MAX_AUTO_PER_HOUR = 3;             // más que esto no es una recuperación, es un bucle
const STARTING_PATIENCE_MS = 8 * 60_000; // cuánto toleramos STARTING antes de considerarla trabada

const userTouch = new Map<string, number>();
const autoRestarts = new Map<string, number[]>();
const startingSince = new Map<string, number>();

// TORMENTA de caídas (23/09: una línea nueva se cayó y reconectó 69 veces en 20 min hasta que el
// cliente la borró): a partir de este número de caídas en 1 h (line-weights las cuenta), la sesión se
// DETIENE y ningún automatismo la vuelve a levantar. Sale del freno cuando el usuario toca Conectar,
// o sola a las 6 h por si nadie la atiende.
export const STORM_FLAPS_PER_HOUR = Number(process.env.LINE_STORM_FLAPS ?? "10");
const STORM_TTL_MS = 6 * 3600_000;
const stormStoppedAt = new Map<string, number>();

export function esTormenta(caidasEnUnaHora: number): boolean {
  return caidasEnUnaHora >= STORM_FLAPS_PER_HOUR;
}
export function markStormStopped(inst: string): void {
  stormStoppedAt.set(inst, Date.now());
}
export function clearStorm(inst: string): void {
  stormStoppedAt.delete(inst);
}
export function stormStopped(inst: string): boolean {
  const t = stormStoppedAt.get(inst);
  if (!t) return false;
  if (Date.now() - t > STORM_TTL_MS) { stormStoppedAt.delete(inst); return false; }
  return true;
}

// El usuario tocó "Conectar / Ver QR", "Reiniciar conexión" o creó la línea: manos fuera 10 min.
export function markUserConnecting(inst: string): void {
  userTouch.set(inst, Date.now());
  clearStorm(inst); // el usuario la está atendiendo: se levanta el freno de tormenta
}
export function userIsConnecting(inst: string): boolean {
  const t = userTouch.get(inst);
  return !!t && Date.now() - t < USER_WINDOW_MS;
}

export type Veredicto = "ok" | "usuario" | "escaneando" | "cooldown" | "presupuesto" | "tormenta";

// ¿Se puede tocar (reiniciar / recrear / re-aplicar proxy) esta sesión automáticamente AHORA?
// `rawStatus` es el estado crudo de WAHA si el llamador ya lo tiene (SCAN_QR_CODE = está esperando
// al usuario: reiniciarla es tirarle el QR en la cara).
export function autoRestartAllowed(inst: string, rawStatus?: string | null): Veredicto {
  if (userIsConnecting(inst)) return "usuario";
  if (stormStopped(inst)) return "tormenta";
  if (rawStatus === "SCAN_QR_CODE") return "escaneando";
  const now = Date.now();
  const hist = (autoRestarts.get(inst) ?? []).filter((t) => now - t < 3_600_000);
  autoRestarts.set(inst, hist);
  if (hist.length && now - hist[hist.length - 1] < COOLDOWN_MS) return "cooldown";
  if (hist.length >= MAX_AUTO_PER_HOUR) return "presupuesto";
  return "ok";
}
export function recordAutoRestart(inst: string): void {
  const h = autoRestarts.get(inst) ?? [];
  h.push(Date.now());
  autoRestarts.set(inst, h);
}

// Sesión "trabada" en STARTING: SOLO si la venimos viendo en STARTING desde hace más de la paciencia.
// Antes se reiniciaba con verla UNA vez en STARTING (o sea, mientras estaba arrancando bien).
export function stuckInStarting(inst: string, rawStatus: string | null | undefined): boolean {
  if (rawStatus !== "STARTING") {
    startingSince.delete(inst);
    return false;
  }
  const since = startingSince.get(inst);
  if (!since) {
    startingSince.set(inst, Date.now());
    return false;
  }
  return Date.now() - since > STARTING_PATIENCE_MS;
}

// Reinicio automático con todas las reglas aplicadas. Devuelve el veredicto (queda logueado).
export async function safeAutoRestart(inst: string, reason: string, rawStatus?: string | null): Promise<Veredicto> {
  const v = autoRestartAllowed(inst, rawStatus);
  if (v !== "ok") {
    console.log(`[session-guard] NO reinicio ${inst} (${reason}): ${v}`);
    return v;
  }
  recordAutoRestart(inst);
  console.log(`[session-guard] reinicio automático ${inst} (${reason})`);
  await getEngine().restartInstance(inst).catch(() => undefined);
  return "ok";
}
