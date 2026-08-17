// Saldo de tráfico IPRoyal (residencial). Lee los GB restantes de la cuenta vía la API oficial
// (GET https://resi-api.iproyal.com/v1/me → available_traffic en GB) y avisa al dueño (email +
// campanita) cuando baja del umbral, para cargar ANTES de que se agote y se caigan las líneas.
// Todo best-effort y gateado por env: sin IPROYAL_API_TOKEN es no-op (no rompe nada).
import axios from "axios";
import { alertAdminProxy } from "./proxy-pool.js";
import { sendMail } from "./mailer.js";

const API_URL = (process.env.IPROYAL_API_URL ?? "https://resi-api.iproyal.com/v1").replace(/\/$/, "");
const REPORT_EMAIL = process.env.PROXY_REPORT_EMAIL ?? "federicobogado1997@gmail.com";
// Umbral: por debajo de estos GB se dispara el aviso "cargá IPRoyal". Configurable por env.
// 1 GB alcanza de sobra: WhatsApp por proxy consume muy poco, así que avisamos recién cuando está por agotarse.
export const IPROYAL_LOW_GB = Number(process.env.IPROYAL_LOW_GB ?? "1");

function token(): string {
  return (process.env.IPROYAL_API_TOKEN ?? "").trim();
}
export function iproyalBalanceEnabled(): boolean {
  return token().length > 0;
}

export interface IproyalBalance {
  availableGb: number;
  subusers: number;
  userHash: string | null;
}

// Consulta el saldo en vivo. Devuelve null si no hay token o la API falla (best-effort).
export async function fetchIproyalBalance(): Promise<IproyalBalance | null> {
  const t = token();
  if (!t) return null;
  try {
    const r = await axios.get(`${API_URL}/me`, {
      headers: { Authorization: `Bearer ${t}` },
      timeout: 10_000,
      validateStatus: () => true,
    });
    if (r.status !== 200 || !r.data || typeof r.data.available_traffic !== "number") {
      console.warn("[iproyal-balance] respuesta inesperada:", r.status);
      return null;
    }
    return {
      availableGb: Math.round(r.data.available_traffic * 1000) / 1000,
      subusers: Number(r.data.subusers_count ?? 0),
      userHash: typeof r.data.residential_user_hash === "string" ? r.data.residential_user_hash : null,
    };
  } catch (e) {
    console.warn("[iproyal-balance] fetch falló:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

// Anti-spam del aviso: como el chequeo corre cada 1h, no avisamos en cada corrida mientras siga bajo.
// Avisamos al CRUZAR el umbral hacia abajo, y después a lo sumo 1 vez cada 12h. (En memoria: si reinicia
// el server y sigue bajo, vuelve a avisar una vez — aceptable y hasta útil.)
let lastAlertAt = 0;
let wasLow = false;
const REALERT_MS = 12 * 3600_000;

// Chequeo periódico: lee el saldo y avisa si está por debajo del umbral. No-op sin token.
export async function checkIproyalBalance(): Promise<void> {
  if (!iproyalBalanceEnabled()) return;
  const bal = await fetchIproyalBalance();
  if (!bal) return;
  const low = bal.availableGb < IPROYAL_LOW_GB;
  if (!low) {
    wasLow = false;
    return;
  }
  const now = Date.now();
  const crossedDown = !wasLow; // recién ahora bajó del umbral
  wasLow = true;
  if (!crossedDown && now - lastAlertAt < REALERT_MS) return; // ya avisamos hace poco
  lastAlertAt = now;

  const gb = bal.availableGb.toFixed(2);
  const title = "⚠️ Saldo IPRoyal bajo";
  const body = `Quedan ${gb} GB de tráfico en IPRoyal (umbral ${IPROYAL_LOW_GB} GB). Cargá antes de que se agote y se caigan las líneas.`;
  await alertAdminProxy(title, body, "iproyal_low", { availableGb: bal.availableGb, threshold: IPROYAL_LOW_GB }).catch(() => undefined);
  await sendMail(
    REPORT_EMAIL,
    `⚠️ Saldo IPRoyal bajo — ${gb} GB`,
    `Te quedan ${gb} GB de tráfico residencial en IPRoyal (umbral ${IPROYAL_LOW_GB} GB).\n\n` +
      `Cargá GB en https://dashboard.iproyal.com antes de que se agote: sin tráfico las líneas con proxy IPRoyal se caen.\n\n` +
      `(Chequeo automático cada 1h. Saldo en vivo en el panel /admin/proxy-health.)`,
  ).catch(() => undefined);
}
