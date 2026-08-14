// Cliente del partner-api de ganamos (socio). Contrato REAL confirmado por Eduardo (2026-08-06):
//   base: https://wp.casino-team.dev/api/partner/v1 · auth: Bearer · allowlist por IP (la nuestra,
//   187.77.33.164, ya habilitada) · moneda ARS entero · idempotencia por `referencia`.
// Endpoints: POST /register · POST /credit · POST /debit · GET /balance.
//
// Config por env: CASINO_API_URL (la BASE, con /api/partner/v1) + CASINO_API_KEY. SIN config →
// deshabilitado (casinoPartnerEnabled()=false) y el bot cae al flujo de avisar al cajero a mano.
//
// Idempotencia: mandamos `referencia` en el body (Eduardo deduplica por ese valor: mismo valor = no
// duplica). También va como header Idempotency-Key (inofensivo si él solo mira el body). Un timeout de
// red que igual acreditó NO duplica la carga.
import axios from "axios";

const BASE = (process.env.CASINO_API_URL ?? "").replace(/\/$/, "");
const KEY = process.env.CASINO_API_KEY ?? "";

// Credenciales del casino de UNA cuenta (multi-tenant): base + key. Si no se pasan, se usan las del .env
// (legacy single-tenant). El resolver por cuenta vive en casino-cashier (resolveCasinoCreds).
export interface CasinoCreds { baseUrl: string; key: string }
const effBase = (c?: CasinoCreds): string => (c?.baseUrl ?? BASE).replace(/\/$/, "");
const effKey = (c?: CasinoCreds): string => c?.key ?? KEY;

export function casinoPartnerEnabled(creds?: CasinoCreds): boolean {
  return Boolean(effBase(creds) && effKey(creds));
}

export interface PartnerResult {
  ok: boolean;
  status?: string; // completed | queued | failed
  operacion?: string; // register | credit | debit
  usuario?: string;
  monto?: number;
  saldo?: number;
  referencia?: string;
  playerId?: number; // solo en /register
  existe?: boolean; // solo en /balance
  intentId?: string; // solo en /intent (modelo B, auto-carga)
  errorCode?: string; // PLAYER_NOT_FOUND | INVALID_AMOUNT | INVALID_REFERENCE | username-taken | ...
  errorMessage?: string;
  httpStatus?: number;
  // Reintentable con la MISMA referencia: status:"queued" (worker sin sesión) / HTTP 429 / 503
  // (BALANCE_UNAVAILABLE) / error de red. El resto (PLAYER_NOT_FOUND, INVALID_*, 401 key, 403 IP,
  // failed de ganamos) NO se reintenta → alerta al cajero o es error de config.
  retryable: boolean;
}

async function call(path: string, method: "post" | "get", payload: Record<string, unknown>, creds?: CasinoCreds, timeoutMs = 15000): Promise<PartnerResult> {
  if (!casinoPartnerEnabled(creds)) {
    return { ok: false, errorCode: "not_configured", errorMessage: "CASINO_API_URL/KEY no configurados", retryable: false };
  }
  const referencia = typeof payload.referencia === "string" ? payload.referencia : undefined;
  try {
    const res = await axios.request({
      url: `${effBase(creds)}${path}`,
      method,
      ...(method === "post" ? { data: payload } : { params: payload }),
      headers: {
        Authorization: `Bearer ${effKey(creds)}`,
        "Content-Type": "application/json",
        ...(referencia ? { "Idempotency-Key": referencia } : {}),
      },
      timeout: timeoutMs,
      validateStatus: () => true, // los códigos los mapeamos nosotros
    });
    const data = (res.data ?? {}) as Record<string, unknown>;
    if (data.ok === true) {
      return {
        ok: true,
        status: typeof data.status === "string" ? data.status : "completed",
        operacion: typeof data.operacion === "string" ? data.operacion : undefined,
        usuario: typeof data.usuario === "string" ? data.usuario : undefined,
        monto: typeof data.monto === "number" ? data.monto : undefined,
        saldo: typeof data.saldo === "number" ? data.saldo : undefined,
        referencia: typeof data.referencia === "string" ? data.referencia : referencia,
        playerId: typeof data.playerId === "number" ? data.playerId : undefined,
        existe: typeof data.existe === "boolean" ? data.existe : undefined,
        intentId: typeof data.intentId === "string" ? data.intentId : undefined,
        httpStatus: res.status,
        retryable: false,
      };
    }
    // Error: { ok:false, status:"queued"|"failed", error:"<STRING>" } (o 4xx/5xx con `error` texto).
    const status = typeof data.status === "string" ? data.status : undefined;
    const errStr = typeof data.error === "string" ? data.error : `HTTP ${res.status}`;
    const retryable = status === "queued" || res.status === 429 || res.status === 503;
    return {
      ok: false,
      status,
      errorCode: errStr,
      errorMessage: errStr,
      httpStatus: res.status,
      retryable,
    };
  } catch (e) {
    // Error de red/timeout: reintentable (la idempotencia por referencia protege del doble crédito).
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, errorCode: "network_error", errorMessage: message, retryable: true };
  }
}

// ALTA del jugador en ganamos. Devuelve `playerId`. Si el usuario ya existe, Eduardo responde failed
// (ej. "username-taken") → se puede seguir operando con ese mismo usuario igual.
export async function casinoRegister(args: { usuario: string; password: string }, creds?: CasinoCreds): Promise<PartnerResult> {
  // El ALTA del lado del socio hace login + trae el template del agente + crea el jugador (3 llamadas
  // secuenciales por su proxy residencial) → puede tardar ~13s y spikear. Timeout ALTO (25s) para no
  // cortarnos antes y creer que "no registró" cuando el usuario SÍ se creó (499 en el socio). Idempotente.
  return call("/register", "post", { usuario: args.usuario, password: args.password }, creds, 25000);
}

// CARGA: acredita fichas al jugador. `monto` entero en ARS. Si da PLAYER_NOT_FOUND → registrar primero.
export async function casinoCredit(args: { usuario: string; monto: number; referencia: string }, creds?: CasinoCreds): Promise<PartnerResult> {
  return call("/credit", "post", { usuario: args.usuario, monto: args.monto, referencia: args.referencia }, creds);
}

// DESCARGA: debita fichas del jugador.
export async function casinoDebit(args: { usuario: string; monto: number; referencia: string }, creds?: CasinoCreds): Promise<PartnerResult> {
  return call("/debit", "post", { usuario: args.usuario, monto: args.monto, referencia: args.referencia }, creds);
}

// SALDO del jugador. `existe:false` = el jugador no está dado de alta en ganamos.
export async function casinoBalance(usuario: string, creds?: CasinoCreds): Promise<PartnerResult> {
  return call("/balance", "get", { usuario }, creds);
}

// CVU de la recaudadora (modelo B): a dónde transfiere el jugador. FIJO y compartido — ganamos matchea
// por el CBU/CUIT del REMITENTE + monto. Endpoint `GET /cvu` (mismo Bearer, cache 60s del lado de
// Eduardo). Si la cuenta se saturó (tope mensual) o se desactivó → 503 (NO devuelve un CVU muerto): el
// bot NO manda al jugador a transferir a una cuenta que no recauda. NO cambia solo de cuenta.
export interface CvuInfo {
  ok: boolean;
  cvu?: string;
  alias?: string;
  titular?: string;
  moneda?: string;
  errorCode?: string;
  httpStatus?: number;
}
export async function casinoCvu(creds?: CasinoCreds): Promise<CvuInfo> {
  if (!casinoPartnerEnabled(creds)) return { ok: false, errorCode: "not_configured" };
  try {
    const res = await axios.get(`${effBase(creds)}/cvu`, { headers: { Authorization: `Bearer ${effKey(creds)}` }, timeout: 10000, validateStatus: () => true });
    const d = (res.data ?? {}) as Record<string, unknown>;
    const s = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
    if (res.status === 200 && d.ok === true && s(d.cvu)) {
      return { ok: true, cvu: s(d.cvu), alias: s(d.alias), titular: s(d.titular), moneda: s(d.moneda), httpStatus: 200 };
    }
    // 503 = recaudadora saturada/desactivada (sin CVU vivo). No mostramos un CVU muerto.
    return { ok: false, errorCode: typeof d.error === "string" ? d.error : `http_${res.status}`, httpStatus: res.status };
  } catch (e) {
    return { ok: false, errorCode: e instanceof Error ? e.message : "network_error" };
  }
}

// INTENT (modelo B — auto-carga desde la transferencia): avisamos la INTENCIÓN de carga. NO acredita:
// ganamos matchea la transferencia REAL (por monto + CBU/CUIT del remitente, ventana 48h en ambos
// sentidos) y recién ahí acredita, avisándonos por el callback firmado. El `/intent` NO registra al
// jugador → mandar casinoRegister antes si es nuevo. `referencia` única por operación (409
// REFERENCE_CONFLICT si se reusa con otros datos). Devuelve `intentId`.
export async function casinoIntent(args: {
  usuario: string;
  monto: number;
  referencia: string;
  callbackUrl: string;
  cbu?: string | null;
  cuit?: string | null;
  remitente?: string | null;
  codigoOperacion?: string | null; // código/N° de transferencia (matcheo exacto si el OCR lo lee)
}, creds?: CasinoCreds): Promise<PartnerResult> {
  return call("/intent", "post", {
    usuario: args.usuario,
    monto: args.monto,
    referencia: args.referencia,
    callbackUrl: args.callbackUrl,
    ...(args.cbu ? { cbu: args.cbu } : {}),
    ...(args.cuit ? { cuit: args.cuit } : {}),
    ...(args.remitente ? { remitente: args.remitente } : {}),
    ...(args.codigoOperacion ? { codigoOperacion: args.codigoOperacion } : {}),
  }, creds);
}
