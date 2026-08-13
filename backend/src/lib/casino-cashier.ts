// Puente entre el cajero del Chat App y la API de ganamos (socio). Lo llaman SOLO los approve del
// operador (regla dura §9.2: las fichas se acreditan/debitan únicamente tras aprobación manual, nunca
// por una imagen). Gateado por casinoPartnerEnabled(): si el flag está APAGADO, no hace absolutamente
// nada (el cajero sigue como hoy, solo con el wallet interno). Cada operación queda en `CasinoTx`
// (referencia @unique = idempotencia end-to-end) y, si ganamos falla, avisa al operador (campana).
//
// v1 ADITIVO: la carga/descarga en ganamos se hace ADEMÁS del wallet interno; no reemplaza nada. La
// decisión de "fuente de verdad" (ganamos vs wallet interno) y el manejo fino de fallos se define al
// prender el flag (ver preguntas de go-live). Best-effort: nunca tira → no rompe el approve.
import { prisma } from "./prisma.js";
import { casinoPartnerEnabled, casinoCredit, casinoDebit, casinoRegister, casinoIntent, casinoCvu, type CasinoCreds, type CvuInfo } from "./casino-partner.js";
import { decryptSecret } from "./crypto.js";
import { notify } from "./notifications.js";

// Clave para el alta on-demand en ganamos. Por defecto la de los jugadores autogenerados (un-tap).
// Configurable por env; queda pendiente confirmar los requisitos de password con Eduardo (INVALID_PASSWORD).
const REGISTER_PASSWORD = process.env.CASINO_DEFAULT_PLAYER_PASSWORD ?? "123456";
const ars = (n: number) => "$" + n.toLocaleString("es-AR");

// Clave del jugador en ganamos (la que le mostramos para que entre a jugar). Misma que usa el alta.
export const casinoPlayerPassword = (): string => REGISTER_PASSWORD;

type Op = { id: string; userId: string; playerId: string; amount: number; currency: string };

// MODELO B (auto-carga desde la transferencia): activo cuando hay API del socio Y secreto del callback.
// Con B, la CARGA es 100% automática (intent → callback firmado); el /credit del approve del cajero
// (modelo A) se APAGA para no acreditar dos veces en ganamos. El /debit del retiro NO cambia.
export function casinoModelBEnabled(): boolean {
  return casinoPartnerEnabled() && Boolean(process.env.CHAT_PAY_WEBHOOK_SECRET);
}

// ROLLOUT ESCALONADO por cuenta: env `CASINO_MODEL_B_ACCOUNTS` = lista de userIds separados por coma.
// VACÍO = NADIE (seguro por default). Así se prende una cuenta a la vez (empezando por victor) antes de
// abrir el modelo B a todo el Chat App.
function modelBAccounts(): string[] {
  return (process.env.CASINO_MODEL_B_ACCOUNTS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

// Resuelve las CREDENCIALES del casino de UNA cuenta (multi-tenant): si tiene casinoApiKey propia -> su
// tenant (Fortunatotal, etc.); si no, si está en la lista legacy del .env -> la key global (mrchcod/
// Ganamos). null = la cuenta no tiene casino. La base es compartida (mismo partner-api).
export async function resolveCasinoCreds(userId: string): Promise<CasinoCreds | null> {
  const base = (process.env.CASINO_API_URL ?? "").replace(/\/$/, "");
  if (!base) return null;
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { casinoApiKey: true } });
  if (u?.casinoApiKey) {
    try { return { baseUrl: base, key: decryptSecret(u.casinoApiKey) }; } catch { return null; }
  }
  const globalKey = process.env.CASINO_API_KEY ?? "";
  if (globalKey && modelBAccounts().includes(userId)) return { baseUrl: base, key: globalKey }; // legacy (mrchcod)
  return null;
}

// ¿El modelo B (auto-carga) está activo para ESTA cuenta? Requiere el secreto del callback (global) + que
// la cuenta tenga casino (key propia o legacy). Es lo que gatea el envío del intent (la plata a ganamos).
export async function casinoLiveForAccount(userId: string): Promise<boolean> {
  if (!process.env.CHAT_PAY_WEBHOOK_SECRET) return false; // sin secreto del callback no hay auto-carga segura
  return (await resolveCasinoCreds(userId)) !== null;
}

// CVU de la recaudadora para ESTA cuenta (usa su key). Sin casino en la cuenta -> not_configured.
export async function casinoCvuForAccount(userId: string): Promise<CvuInfo> {
  const creds = await resolveCasinoCreds(userId);
  if (!creds) return { ok: false, errorCode: "not_configured" };
  return casinoCvu(creds);
}

// Da de alta al jugador en ganamos (idempotente: tolera "ya existe"). Lo usa el bot ANTES de mostrarle
// el CVU, así el usuario EXISTE cuando ganamos va a acreditar (si no, la carga queda failed). ok=true si
// quedó listo (creado o ya existía). Usa la clave por defecto (la que ya conoce el jugador de su alta).
export async function ensureCasinoUser(userId: string, casinoUsername: string): Promise<{ ok: boolean; errorCode?: string }> {
  const creds = await resolveCasinoCreds(userId);
  if (!creds) return { ok: false, errorCode: "not_configured" };
  const r = await casinoRegister({ usuario: casinoUsername, password: REGISTER_PASSWORD }, creds);
  if (r.ok) return { ok: true };
  if (/taken|exist|ya existe|duplicad/i.test(`${r.errorCode} ${r.errorMessage}`)) return { ok: true };
  console.error("[casino-cashier] ensureCasinoUser falló:", casinoUsername, r.errorCode);
  return { ok: false, errorCode: r.errorCode };
}

const callbackUrl = (): string =>
  `${(process.env.APP_BASE_URL ?? "https://app.publi.lat").replace(/\/$/, "")}/api/chat/pay/webhook`;

// MODELO B: al leer el comprobante avisamos la INTENCIÓN de carga a ganamos (NO acredita: eso llega por
// el callback cuando ganamos matchea la transferencia REAL por NOMBRE del remitente + monto, o por el
// código de operación si el OCR lo leyó). Idempotente por CasinoTx `dep-<id>`. Best-effort: nunca tira.
export async function sendDepositIntent(
  dep: Op,
  casinoUsername: string,
  receipt: { senderName: string | null; codigoOperacion: string | null },
): Promise<void> {
  if (!process.env.CHAT_PAY_WEBHOOK_SECRET) return; // sin secreto del callback no hay auto-carga segura
  const creds = await resolveCasinoCreds(dep.userId);
  if (!creds) return; // la cuenta no tiene casino (rollout por cuenta)
  try {
    const referencia = `dep-${dep.id}`;
    if (await prisma.casinoTx.findUnique({ where: { referencia }, select: { id: true } })) return; // intent ya mandado
    // El matcheo de ganamos es por NOMBRE del remitente + monto (mínimo), o por codigoOperacion (exacto).
    // Sin ninguno de los dos no hay con qué matchear (ganamos devuelve 400 INVALID_SENDER): lo dejamos
    // failed y avisamos al operador para que lo cargue a mano.
    if (!receipt.senderName && !receipt.codigoOperacion) {
      await prisma.casinoTx.create({
        data: { userId: dep.userId, playerId: dep.playerId, type: "credit", usuario: casinoUsername, amount: dep.amount, currency: dep.currency, referencia, status: "failed", errorCode: "no_sender", attempts: 1 },
      }).catch(() => undefined);
      await notify(dep.userId, "system", "⚠️ Comprobante ilegible",
        `No pudimos leer el remitente ni el código de operación de una carga de ${ars(dep.amount)}. No se puede matchear la transferencia automáticamente; revisalo y cargá a mano si corresponde.`);
      return;
    }
    // ORDEN (confirmado con Eduardo): /register (si es nuevo) → /intent. El /intent NO registra, y si el
    // usuario NO existe cuando ganamos va a acreditar, la carga queda FAILED y la plata no se acredita.
    // Por eso el alta es BLOQUEANTE: si falla (y no es "ya existe"), NO mandamos el intent y avisamos.
    const reg = await casinoRegister({ usuario: casinoUsername, password: REGISTER_PASSWORD }, creds);
    const yaExiste = !reg.ok && /taken|exist|ya existe|duplicad/i.test(`${reg.errorCode} ${reg.errorMessage}`);
    if (!reg.ok && !yaExiste) {
      await prisma.casinoTx.create({
        data: { userId: dep.userId, playerId: dep.playerId, type: "credit", usuario: casinoUsername, amount: dep.amount, currency: dep.currency, referencia, status: "failed", errorCode: `register:${reg.errorCode ?? "error"}`, attempts: 1 },
      }).catch(() => undefined);
      await notify(dep.userId, "system", "⚠️ Alta en ganamos falló",
        `No se pudo crear el usuario ${casinoUsername} en ganamos (${reg.errorCode ?? "error"}). La carga de ${ars(dep.amount)} NO se va a acreditar hasta resolverlo (ej. requisitos de clave).`);
      return; // no mandamos el intent para un usuario que no existe
    }
    const r = await casinoIntent({
      usuario: casinoUsername,
      monto: dep.amount,
      referencia,
      callbackUrl: callbackUrl(),
      // Matcheo por NOMBRE (remitente) + monto, y por codigoOperacion si el OCR lo leyó (exacto). NO
      // mandamos el CBU: el OCR confunde el de ORIGEN con el de DESTINO (recaudadora) y un CBU de destino
      // rompe el match, porque TODAS las cargas comparten esa misma cuenta destino.
      remitente: receipt.senderName,
      codigoOperacion: receipt.codigoOperacion,
    }, creds);
    await prisma.casinoTx.create({
      data: {
        userId: dep.userId, playerId: dep.playerId, type: "credit", usuario: casinoUsername,
        amount: dep.amount, currency: dep.currency, referencia,
        status: r.ok ? "pending" : "failed", txId: r.intentId ?? null,
        errorCode: r.ok ? null : (r.errorCode ?? null), attempts: 1,
      },
    }).catch(() => undefined);
    if (!r.ok) {
      await notify(dep.userId, "system", "⚠️ Carga a ganamos (intent)",
        `No se pudo avisar la intención de carga de ${ars(dep.amount)} (jugador ${casinoUsername}): ${r.errorCode ?? "error"}.`);
    }
  } catch (e) {
    console.error("[casino-cashier] sendDepositIntent error:", e instanceof Error ? e.message : String(e));
  }
}

// Acredita en ganamos una carga YA APROBADA por el operador. Idempotente por `dep-<id>`.
export async function creditDepositInCasino(dep: Op, casinoUsername: string): Promise<void> {
  const creds = await resolveCasinoCreds(dep.userId);
  if (!creds) return; // la cuenta no tiene casino
  if (process.env.CHAT_PAY_WEBHOOK_SECRET) return; // Model B: la carga la acredita el callback, no el /credit del approve.
  try {
    const referencia = `dep-${dep.id}`;
    const existing = await prisma.casinoTx.findUnique({ where: { referencia } });
    if (existing?.status === "completed") return; // ya acreditado (idempotente)
    if (existing) {
      await prisma.casinoTx.update({ where: { referencia }, data: { attempts: { increment: 1 }, status: "pending" } });
    } else {
      await prisma.casinoTx.create({
        data: { userId: dep.userId, playerId: dep.playerId, type: "credit", usuario: casinoUsername, amount: dep.amount, currency: dep.currency, referencia, status: "pending", attempts: 1 },
      });
    }

    let r = await casinoCredit({ usuario: casinoUsername, monto: dep.amount, referencia }, creds);
    // Jugador aún no dado de alta en ganamos → alta on-demand + reintento (misma referencia = idempotente).
    if (!r.ok && r.errorCode === "PLAYER_NOT_FOUND") {
      await casinoRegister({ usuario: casinoUsername, password: REGISTER_PASSWORD }, creds);
      r = await casinoCredit({ usuario: casinoUsername, monto: dep.amount, referencia }, creds);
    }

    if (r.ok) {
      // Eduardo no devuelve txId; guardamos el saldo resultante en txId como referencia útil de auditoría.
      await prisma.casinoTx.update({ where: { referencia }, data: { status: "completed", txId: typeof r.saldo === "number" ? `saldo:${r.saldo}` : null, errorCode: null } });
      return;
    }
    await prisma.casinoTx.update({ where: { referencia }, data: { status: r.retryable ? "pending" : "failed", errorCode: r.errorCode ?? null } });
    await notify(dep.userId, "system", "⚠️ Carga a ganamos",
      r.retryable
        ? `La carga de ${ars(dep.amount)} al jugador ${casinoUsername} quedó EN COLA en ganamos (se puede reintentar). Ojo: las fichas todavía NO entraron.`
        : `La carga de ${ars(dep.amount)} al jugador ${casinoUsername} FALLÓ en ganamos (${r.errorCode ?? "error"}). Cargá las fichas a mano en ganamos.`);
  } catch (e) {
    console.error("[casino-cashier] creditDeposit error:", e instanceof Error ? e.message : String(e));
  }
}

// Debita en ganamos un retiro YA APROBADO por el operador. Idempotente por `wd-<id>`.
export async function debitWithdrawalInCasino(w: Op, casinoUsername: string): Promise<void> {
  const creds = await resolveCasinoCreds(w.userId);
  if (!creds) return; // la cuenta no tiene casino
  try {
    const referencia = `wd-${w.id}`;
    const existing = await prisma.casinoTx.findUnique({ where: { referencia } });
    if (existing?.status === "completed") return;
    if (existing) {
      await prisma.casinoTx.update({ where: { referencia }, data: { attempts: { increment: 1 }, status: "pending" } });
    } else {
      await prisma.casinoTx.create({
        data: { userId: w.userId, playerId: w.playerId, type: "debit", usuario: casinoUsername, amount: w.amount, currency: w.currency, referencia, status: "pending", attempts: 1 },
      });
    }

    const r = await casinoDebit({ usuario: casinoUsername, monto: w.amount, referencia }, creds);
    if (r.ok) {
      // Eduardo no devuelve txId; guardamos el saldo resultante en txId como referencia útil de auditoría.
      await prisma.casinoTx.update({ where: { referencia }, data: { status: "completed", txId: typeof r.saldo === "number" ? `saldo:${r.saldo}` : null, errorCode: null } });
      return;
    }
    await prisma.casinoTx.update({ where: { referencia }, data: { status: r.retryable ? "pending" : "failed", errorCode: r.errorCode ?? null } });
    await notify(w.userId, "system", "⚠️ Descarga en ganamos",
      r.retryable
        ? `El débito de ${ars(w.amount)} al jugador ${casinoUsername} quedó EN COLA en ganamos (reintentable).`
        : `El débito de ${ars(w.amount)} al jugador ${casinoUsername} FALLÓ en ganamos (${r.errorCode ?? "error"}). Revisalo a mano.`);
  } catch (e) {
    console.error("[casino-cashier] debitWithdrawal error:", e instanceof Error ? e.message : String(e));
  }
}
