// Saldo de tráfico IPRoyal (residencial). Lee los GB restantes de la cuenta vía la API oficial
// (GET https://resi-api.iproyal.com/v1/me → available_traffic en GB) y avisa al dueño (email +
// campanita) cuando baja del umbral, para cargar ANTES de que se agote y se caigan las líneas.
// Todo best-effort y gateado por env: sin IPROYAL_API_TOKEN es no-op (no rompe nada).
import axios from "axios";
import { alertAdminProxy } from "./proxy-pool.js";
import { sendMail } from "./mailer.js";
import { prisma } from "./prisma.js";
import { BURN_ALERT_GB_DIA, culpables, horasRestantes, ritmoGbDia, textoAviso, type Lectura } from "./iproyal-burn.js";
import { EMERGENCIA_GB, fallbackDirectoActivo, modoEmergencia, textoEmergencia } from "./proxy-emergencia.js";
import { aplicarTope, BLOQUEO_HORAS, textoTope } from "./proxy-presupuesto.js";

const API_URL = (process.env.IPROYAL_API_URL ?? "https://resi-api.iproyal.com/v1").replace(/\/$/, "");
const REPORT_EMAIL = process.env.PROXY_REPORT_EMAIL ?? "federicobogado1997@gmail.com";
// Umbral: por debajo de estos GB se dispara el aviso "cargá IPRoyal". Configurable por env.
// 3 GB: el 22/09 se consumió casi 1 GB en un día (reconexiones + sondeos); con 1 GB el aviso llegaba
// tarde. Con 3 GB hay varios días de margen para cargar.
export const IPROYAL_LOW_GB = Number(process.env.IPROYAL_LOW_GB ?? "3");

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
const REALERT_MS = 6 * 3600_000;

// Lectura anterior del saldo, para calcular el RITMO (GB/día). En memoria: tras un deploy tarda una
// corrida en tener referencia. El aviso de ritmo alto va aparte del de saldo bajo y con su propio freno.
let lecturaPrevia: Lectura | null = null;
let ultimoAvisoRitmo = 0;

// Avisa cuando el proxy consume MUCHO más de lo normal, señalando las líneas que se están cayendo.
// Sin esto el gasto solo se nota cuando el saldo ya se agotó (pasó 23 y 24 de septiembre).
async function avisarRitmo(gbAhora: number): Promise<void> {
  const ahora: Lectura = { gb: gbAhora, at: Date.now() };
  const gbDia = ritmoGbDia(lecturaPrevia, ahora);
  lecturaPrevia = ahora;

  // TOPE DURO: si el gasto se pasó del presupuesto, le sacamos el proxy a la línea que más gasta.
  // Sigue trabajando por la IP del servidor: no se corta el servicio, solo deja de consumir plan.
  // Esto es lo que hace que el plan no se pueda vaciar solo (pedido del dueño, 25/09).
  const cortada = await aplicarTope(gbDia).catch(() => null);
  if (cortada && gbDia != null) {
    const cuerpo = textoTope(cortada.nombre, gbDia, BLOQUEO_HORAS);
    await alertAdminProxy("✂️ Le saqué el proxy a una línea para no gastar de más", cuerpo, "proxy_tope", {
      lineId: cortada.lineId, gbDia,
    }).catch(() => undefined);
    await sendMail(REPORT_EMAIL, `✂️ Tope de proxy: ${cortada.nombre} quedó sin proxy`, cuerpo).catch(() => undefined);
  }

  if (gbDia == null || gbDia < BURN_ALERT_GB_DIA) return;
  if (Date.now() - ultimoAvisoRitmo < REALERT_MS) return;
  ultimoAvisoRitmo = Date.now();

  // Las líneas con proxy que más se cayeron en la última hora: son las que gastan.
  const conProxy = await prisma.waLine
    .findMany({ where: { proxyId: { not: null } }, select: { id: true, phone: true, label: true, user: { select: { email: true } } } })
    .catch(() => []);
  const culpas = culpables(conProxy.map((l) => l.id)).map((c) => {
    const l = conProxy.find((x) => x.id === c.lineId)!;
    return { nombre: `${l.user.email.split("@")[0]} …${l.phone.slice(-4)}`, caidas: c.caidas };
  });

  const cuerpo = textoAviso(gbAhora, gbDia, culpas);
  console.warn(`[iproyal-burn] ritmo ${gbDia.toFixed(2)} GB/día con ${gbAhora.toFixed(2)} GB restantes`);
  await alertAdminProxy("🔥 El proxy está gastando de más", cuerpo, "iproyal_burn", { gbDia, availableGb: gbAhora }).catch(() => undefined);
  await sendMail(REPORT_EMAIL, `🔥 IPRoyal: ${gbDia.toFixed(2)} GB/día`, cuerpo).catch(() => undefined);
}

// Chequeo periódico: lee el saldo y avisa si está por debajo del umbral. No-op sin token.
export async function checkIproyalBalance(): Promise<void> {
  if (!iproyalBalanceEnabled()) return;
  const bal = await fetchIproyalBalance();
  if (!bal) return;
  // Ritmo de consumo (independiente del saldo): avisa apenas el gasto se dispara, no cuando ya se agotó.
  await avisarRitmo(bal.availableGb).catch(() => undefined);
  // SALDO AGOTADO: antes de que las líneas empiecen a caerse de a una, las pasamos a la IP del
  // servidor. Siguen trabajando y vuelven solas a su proxy cuando haya saldo de nuevo.
  if (bal.availableGb < EMERGENCIA_GB && fallbackDirectoActivo()) {
    const movidas = await modoEmergencia(`saldo agotado (${bal.availableGb.toFixed(3)} GB)`).catch(() => 0);
    if (movidas > 0) {
      const cuerpo = textoEmergencia(movidas, "el saldo de IPRoyal se agotó");
      await alertAdminProxy("🚨 Sin saldo: líneas trabajando sin proxy", cuerpo, "proxy_emergencia", { movidas }).catch(() => undefined);
      await sendMail(REPORT_EMAIL, `🚨 IPRoyal sin saldo — ${movidas} líneas sin proxy`, cuerpo).catch(() => undefined);
    }
  }
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
    const gbDiaAhora = lecturaPrevia ? ritmoGbDia({ gb: lecturaPrevia.gb, at: lecturaPrevia.at - 3600_000 }, lecturaPrevia) : null;
  const horas = horasRestantes(bal.availableGb, gbDiaAhora);
  const body =
    `Quedan ${gb} GB de tráfico en IPRoyal (umbral ${IPROYAL_LOW_GB} GB).` +
    (horas ? ` A este ritmo se agota en ~${Math.round(horas)} h.` : "") +
    " Cargá antes de que se agote y se caigan las líneas.";
  await alertAdminProxy(title, body, "iproyal_low", { availableGb: bal.availableGb, threshold: IPROYAL_LOW_GB }).catch(() => undefined);
  await sendMail(
    REPORT_EMAIL,
    `⚠️ Saldo IPRoyal bajo — ${gb} GB`,
    `Te quedan ${gb} GB de tráfico residencial en IPRoyal (umbral ${IPROYAL_LOW_GB} GB).\n\n` +
      `Cargá GB en https://dashboard.iproyal.com antes de que se agote: sin tráfico las líneas con proxy IPRoyal se caen.\n\n` +
      `(Chequeo automático cada 1h. Saldo en vivo en el panel /admin/proxy-health.)`,
  ).catch(() => undefined);
}
