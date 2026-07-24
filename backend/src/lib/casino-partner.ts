// Cliente del partner-api de la plataforma del socio (ganamos). Contrato SINCRÓNICO (Central):
// /credit, /debit y /balance responden {ok, status, txId, saldo} en la misma llamada.
//
// Config por env (por ahora global; a futuro por cuenta): CASINO_API_URL + CASINO_API_KEY. SIN
// config → deshabilitado (casinoPartnerEnabled()=false) y el bot cae al flujo actual de avisar al
// cajero. Monto ENTERO en la moneda del tenant (ARS), sin decimales.
//
// Idempotencia: mandamos `referencia` en el body Y como header Idempotency-Key. El deposit() de
// ganamos ya deduplica a nivel DB, así que un timeout de red que igual acreditó NO duplica.
import axios from "axios";

const BASE = (process.env.CASINO_API_URL ?? "").replace(/\/$/, "");
const KEY = process.env.CASINO_API_KEY ?? "";

export function casinoPartnerEnabled(): boolean {
  return Boolean(BASE && KEY);
}

export interface PartnerResult {
  ok: boolean;
  status?: string;      // completed | pending
  txId?: string;
  saldo?: number;
  referencia?: string;
  repetido?: boolean;   // true = misma referencia ya procesada (idempotente)
  errorCode?: string;   // player_not_found | invalid_amount | insufficient_cashier_balance | ...
  errorMessage?: string;
  httpStatus?: number;
  retryable: boolean;   // según la guía de Eduardo: cajero_sin_saldo / 429 / 503 sí; el resto no
}

// Reintentables con la MISMA referencia (por code). El resto (player_not_found, invalid_amount,
// invalid_api_key, ip_not_allowed, duplicate_reference) NO se reintentan → van a alerta del cajero
// o son error de config.
const RETRYABLE_CODES = new Set(["insufficient_cashier_balance", "rate_limited", "platform_unavailable"]);

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
        txId: typeof data.txId === "string" ? data.txId : undefined,
        saldo: typeof data.saldo === "number" ? data.saldo : undefined,
        referencia: typeof data.referencia === "string" ? data.referencia : referencia,
        repetido: data.repetido === true,
        httpStatus: res.status,
        retryable: false,
      };
    }
    const err = (data.error ?? {}) as Record<string, unknown>;
    const code = typeof err.code === "string" ? err.code : `http_${res.status}`;
    // Reintentable por code, o por HTTP 429/503 (rate/plataforma).
    const retryable = RETRYABLE_CODES.has(code) || res.status === 429 || res.status === 503;
    return {
      ok: false,
      errorCode: code,
      errorMessage: typeof err.message === "string" ? err.message : `HTTP ${res.status}`,
      httpStatus: res.status,
      retryable,
    };
  } catch (e) {
    // Error de red/timeout: reintentable (la idempotencia por referencia protege del doble crédito).
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, errorCode: "network_error", errorMessage: message, retryable: true };
  }
}

// CARGA: acredita fichas al jugador. `monto` entero en la moneda del tenant (ARS).
export async function casinoCredit(args: { usuario: string; monto: number; referencia: string }): Promise<PartnerResult> {
  return call("/api/partner/v1/credit", "post", { usuario: args.usuario, monto: args.monto, referencia: args.referencia });
}

// DESCARGA: debita fichas del jugador.
export async function casinoDebit(args: { usuario: string; monto: number; referencia: string }): Promise<PartnerResult> {
  return call("/api/partner/v1/debit", "post", { usuario: args.usuario, monto: args.monto, referencia: args.referencia });
}

// SALDO del jugador.
export async function casinoBalance(usuario: string): Promise<PartnerResult> {
  return call("/api/partner/v1/balance", "get", { usuario });
}
