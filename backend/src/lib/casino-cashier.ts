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
import { casinoPartnerEnabled, casinoCredit, casinoDebit, casinoRegister } from "./casino-partner.js";
import { notify } from "./notifications.js";

// Clave para el alta on-demand en ganamos. Por defecto la de los jugadores autogenerados (un-tap).
// Configurable por env; queda pendiente confirmar los requisitos de password con Eduardo (INVALID_PASSWORD).
const REGISTER_PASSWORD = process.env.CASINO_DEFAULT_PLAYER_PASSWORD ?? "123456";
const ars = (n: number) => "$" + n.toLocaleString("es-AR");

type Op = { id: string; userId: string; playerId: string; amount: number; currency: string };

// Acredita en ganamos una carga YA APROBADA por el operador. Idempotente por `dep-<id>`.
export async function creditDepositInCasino(dep: Op, casinoUsername: string): Promise<void> {
  if (!casinoPartnerEnabled()) return;
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

    let r = await casinoCredit({ usuario: casinoUsername, monto: dep.amount, referencia });
    // Jugador aún no dado de alta en ganamos → alta on-demand + reintento (misma referencia = idempotente).
    if (!r.ok && r.errorCode === "PLAYER_NOT_FOUND") {
      await casinoRegister({ usuario: casinoUsername, password: REGISTER_PASSWORD });
      r = await casinoCredit({ usuario: casinoUsername, monto: dep.amount, referencia });
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
  if (!casinoPartnerEnabled()) return;
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

    const r = await casinoDebit({ usuario: casinoUsername, monto: w.amount, referencia });
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
