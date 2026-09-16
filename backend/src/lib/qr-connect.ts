// "Conectar / Ver QR" que NO rompe nada (WAHA). Mira el estado REAL de la sesión y hace solo lo
// necesario para que aparezca el código:
//   WORKING       → ya está conectada (no la tocamos: tocarla la desvincula).
//   SCAN_QR_CODE  → traemos el QR y listo.
//   STARTING      → NO la reiniciamos: esperamos (hasta ~20 s) a que llegue al QR o a WORKING.
//   FAILED        → credenciales muertas (el teléfono la desvinculó): logout para limpiarlas + start.
//   STOPPED       → start.
//   no existe     → la creamos.
// y en todos los casos de arranque ESPERAMOS el QR antes de responder, así el panel lo muestra en
// la misma respuesta y el cliente no tiene que "apretar de nuevo a ver si ahora sí".
//
// Antes, "Conectar" hacía POST /start a ciegas y, si fallaba, PUT config + start (= reinicio): sobre
// una sesión que estaba arrancando bien la volvía a cero cada vez, y el auto-refresco del QR del
// panel repetía eso cada 18 s → la sesión nunca llegaba al QR (incidente 2026-09-16).
import { getEngine } from "./wa-engine.js";
import { applyLineProxy } from "./proxy-pool.js";
import { markUserConnecting } from "./session-guard.js";

type Raw = "WORKING" | "SCAN_QR_CODE" | "STARTING" | "FAILED" | "STOPPED" | "NO_EXISTE" | "DESCONOCIDO";
export interface ResultadoConexion {
  qr: string | null;
  status: "connected" | "qr" | "starting" | "failed";
  detalle?: string;
}

const base = () => (process.env.WAHA_BASE_URL ?? "").replace(/\/$/, "");
const headers = () => ({ "X-Api-Key": process.env.WAHA_API_KEY ?? "" });
export const usaWaha = (): boolean =>
  (process.env.WA_ENGINE ?? "").toLowerCase() === "waha" && !!base() && !!process.env.WAHA_API_KEY;

export async function estadoCrudo(inst: string): Promise<Raw> {
  try {
    const r = await fetch(`${base()}/api/sessions/${encodeURIComponent(inst)}`, { headers: headers(), signal: AbortSignal.timeout(8000) });
    if (r.status === 404) return "NO_EXISTE";
    if (!r.ok) return "DESCONOCIDO";
    const d = (await r.json()) as { status?: string };
    const s = String(d.status ?? "").toUpperCase();
    return (["WORKING", "SCAN_QR_CODE", "STARTING", "FAILED", "STOPPED"].includes(s) ? s : "DESCONOCIDO") as Raw;
  } catch {
    return "DESCONOCIDO";
  }
}

async function imagenQr(inst: string): Promise<string | null> {
  try {
    const r = await fetch(`${base()}/api/${encodeURIComponent(inst)}/auth/qr?format=image`, { headers: headers(), signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.length ? `data:image/png;base64,${buf.toString("base64")}` : null;
  } catch {
    return null;
  }
}

async function orden(inst: string, accion: "start" | "logout" | "stop"): Promise<void> {
  await fetch(`${base()}/api/sessions/${encodeURIComponent(inst)}/${accion}`, {
    method: "POST",
    headers: headers(),
    signal: AbortSignal.timeout(15000),
  }).catch(() => undefined);
}

// Espera hasta que la sesión llegue a alguno de los estados buscados. Los primeros segundos ignora
// FAILED (puede ser el estado VIEJO que todavía no cambió después de un start).
async function esperar(inst: string, buscados: Raw[], maxMs: number, ignorarFailedMs = 5000): Promise<Raw> {
  const t0 = Date.now();
  let ultimo: Raw = "DESCONOCIDO";
  while (Date.now() - t0 < maxMs) {
    await new Promise((r) => setTimeout(r, 1500));
    ultimo = await estadoCrudo(inst);
    if (ultimo === "FAILED" && Date.now() - t0 < ignorarFailedMs) continue;
    if (buscados.includes(ultimo)) return ultimo;
  }
  return ultimo;
}

// `marcarUsuario: false` = lo llama un job automático (no bloquea a los demás automáticos).
export async function conectarSesion(
  inst: string,
  lineId: string,
  opts?: { maxWaitMs?: number; marcarUsuario?: boolean },
): Promise<ResultadoConexion> {
  if (opts?.marcarUsuario !== false) markUserConnecting(inst); // el usuario está en esto: los automáticos no la tocan por 10 min
  const maxWait = opts?.maxWaitMs ?? 20_000;
  const objetivo: Raw[] = ["SCAN_QR_CODE", "WORKING", "FAILED"];
  let st = await estadoCrudo(inst);

  if (st === "WORKING") return { qr: null, status: "connected" };
  if (st === "NO_EXISTE") {
    await getEngine().createInstance(inst).catch(() => undefined); // crea + arranca (con webhook)
    await applyLineProxy(inst, lineId).catch(() => undefined);
    st = await esperar(inst, objetivo, maxWait);
  } else if (st === "FAILED" || st === "STOPPED" || st === "DESCONOCIDO") {
    // FAILED = credenciales muertas: sin logout, /start vuelve a FAILED una y otra vez.
    if (st === "FAILED") await orden(inst, "logout");
    await applyLineProxy(inst, lineId).catch(() => undefined); // solo acá (antes de arrancar)
    await orden(inst, "start");
    st = await esperar(inst, objetivo, maxWait);
  } else if (st === "STARTING") {
    st = await esperar(inst, objetivo, maxWait); // paciencia, NO reinicio
  }
  // SCAN_QR_CODE cae acá directo.

  if (st === "WORKING") return { qr: null, status: "connected" };
  if (st === "SCAN_QR_CODE") {
    const qr = await imagenQr(inst);
    return qr ? { qr, status: "qr" } : { qr: null, status: "starting" };
  }
  if (st === "FAILED") {
    return { qr: null, status: "failed", detalle: "WhatsApp rechazó la sesión. Probá «Reiniciar conexión» y volvé a escanear." };
  }
  return { qr: null, status: "starting" };
}

// Código de vinculación por número (8 caracteres). Requiere sesión en SCAN_QR_CODE; NO hace start.
export async function pedirCodigoVinculacion(inst: string, numero: string): Promise<string | null> {
  try {
    const r = await fetch(`${base()}/api/${encodeURIComponent(inst)}/auth/request-code`, {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber: numero.replace(/\D/g, "") }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return null;
    const d = (await r.json()) as { code?: string; pairingCode?: string };
    return d.code ?? d.pairingCode ?? null;
  } catch {
    return null;
  }
}
