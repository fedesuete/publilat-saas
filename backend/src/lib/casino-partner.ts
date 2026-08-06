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

export function casinoPartnerEnabled(): boolean {
  return Boolean(BASE && KEY);
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
  errorCode?: string; // PLAYER_NOT_FOUND | INVALID_AMOUNT | INVALID_REFERENCE | username-taken | ...
  errorMessage?: string;
  httpStatus?: number;
  // Reintentable con la MISMA referencia: status:"queued" (worker sin sesión) / HTTP 429 / 503
  // (BALANCE_UNAVAILABLE) / error de red. El resto (PLAYER_NOT_FOUND, INVALID_*, 401 key, 403 IP,
  // failed de ganamos) NO se reintenta → alerta al cajero o es error de config.
  retryable: boolean;
}

async function call(path: string, method: "post" | "get", payload: Record<string, unknown>): Promise<PartnerResult> {
  if (!casinoPartnerEnabled()) {
    return { ok: false, errorCode: "not_configured", errorMessage: "CASINO_API_URL/KEY no configurados", retryable: false };
  }
  const referencia = typeof payload.referencia === "string" ? payload.referencia : undefined;
  try {
    const res = await axios.request({
      url: `${BASE}${path}`,
      method,
      ...(method === "post" ? { data: payload } : { params: payload }),
      headers: {
        Authorization: `Bearer ${KEY}`,
        "Content-Type": "application/json",
        ...(referencia ? { "Idempotency-Key": referencia } : {}),
      },
      timeout: 15000,
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
export async function casinoRegister(args: { usuario: string; password: string }): Promise<PartnerResult> {
  return call("/register", "post", { usuario: args.usuario, password: args.password });
}

// CARGA: acredita fichas al jugador. `monto` entero en ARS. Si da PLAYER_NOT_FOUND → registrar primero.
export async function casinoCredit(args: { usuario: string; monto: number; referencia: string }): Promise<PartnerResult> {
  return call("/credit", "post", { usuario: args.usuario, monto: args.monto, referencia: args.referencia });
}

// DESCARGA: debita fichas del jugador.
export async function casinoDebit(args: { usuario: string; monto: number; referencia: string }): Promise<PartnerResult> {
  return call("/debit", "post", { usuario: args.usuario, monto: args.monto, referencia: args.referencia });
}

// SALDO del jugador. `existe:false` = el jugador no está dado de alta en ganamos.
export async function casinoBalance(usuario: string): Promise<PartnerResult> {
  return call("/balance", "get", { usuario });
}
