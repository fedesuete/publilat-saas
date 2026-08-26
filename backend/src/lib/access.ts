// Gating por créditos: 1 día = 1 línea activa 24h. Sin días, el loop no funciona.
import { prisma } from "./prisma.js";

export async function getAvailableDays(userId: string): Promise<number> {
  const c = await prisma.credit.findUnique({ where: { userId }, select: { days: true } });
  return c?.days ?? 0;
}

// Consume 1 día y deja la línea activa por 24h (activación inicial o renovación diaria).
// Devuelve true si quedó activa (o ya lo estaba); false si no había crédito.
//
// IDEMPOTENTE por ventana de 24h: primero "reclama" la activación con un update CONDICIONAL
// y atómico sobre la línea (solo si expiresAt es null o ya venció). Si dos eventos de conexión
// llegan casi juntos (Baileys/WAHA repiten el "connected"), solo UNO gana el claim; el otro sale
// sin consumir. Recién después descuenta el día (también atómico sobre el crédito). Antes el
// guard vivía en el caller (webhook: `if !line.expiresAt`) y NO era atómico -> doble consumo.
export async function consumeDayAndActivate(userId: string, lineId: string, label?: string | null): Promise<boolean> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // 1) Claim atómico de la ventana: solo si la línea no está ya activa (expiresAt null o vencido).
  const claimed = await prisma.waLine.updateMany({
    where: { id: lineId, OR: [{ expiresAt: null }, { expiresAt: { lte: now } }] },
    data: { expiresAt, status: "active" },
  });
  if (claimed.count !== 1) return true; // ya estaba activa en esta ventana -> NO re-consumir

  // 2) Descuenta el día (condicional y atómico). Si no hay crédito, revertimos el claim.
  const credit = await prisma.credit.findUnique({ where: { userId }, select: { id: true } });
  const spent = credit
    ? await prisma.credit.updateMany({ where: { id: credit.id, days: { gte: 1 } }, data: { days: { decrement: 1 } } })
    : { count: 0 };
  if (spent.count !== 1) {
    // Sin crédito: la línea NO queda activa (paywall). Revertimos el claim.
    await prisma.waLine.update({ where: { id: lineId }, data: { status: "inactive", expiresAt: null } }).catch(() => undefined);
    return false;
  }
  await prisma.creditLedger.create({ data: { creditId: credit!.id, delta: -1, reason: `1 día de línea activa${label ? ` «${label}»` : ""}` } });
  return true;
}

// ---- Día de Chat App (mismo saldo que WhatsApp, pero SIN necesitar una línea) --------------

// ¿Hay línea de WhatsApp con día vigente? (el Chat App queda cubierto por esa línea).
async function hasActiveWaLine(userId: string): Promise<boolean> {
  return (await prisma.waLine.count({ where: { userId, expiresAt: { gt: new Date() } } })) > 0;
}

// ¿El cliente puede OPERAR el Chat App? Se prende con una línea de WhatsApp con día vigente O con
// un día de Chat App vigente (canal propio, sin WhatsApp). Reemplaza al viejo "hasActiveWaLine".
export async function canOperateChat(userId: string): Promise<boolean> {
  const now = new Date();
  // El día pagado vale hasta que VENCE, aunque el cliente haya apagado la auto-renovación
  // (no se pierde lo pagado). `chatDayEnabled` solo controla si se renueva al vencer.
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { chatDayExpiresAt: true } });
  if (u?.chatDayExpiresAt && u.chatDayExpiresAt > now) return true;
  return hasActiveWaLine(userId);
}

// Consume 1 día del saldo y deja el Chat App activo 24h (activación inicial o renovación diaria).
// Mismo modelo idempotente y atómico que consumeDayAndActivate, pero sobre User.chatDayExpiresAt.
// Si ya hay una línea de WhatsApp con día vigente NO consume (el Chat App ya está cubierto).
// Devuelve true si quedó activo (o ya lo estaba/está cubierto); false si no había crédito.
export async function consumeChatDayAndActivate(userId: string): Promise<boolean> {
  const now = new Date();
  if (await hasActiveWaLine(userId)) return true; // cubierto por WhatsApp -> no gastar otro día
  // ANTI DOBLE COBRO (bug "orden renovación"): una línea ACTIVA que venció hace minutos está en la
  // ventana de su PROPIA auto-renovación (expireLines corre en este tick o el siguiente). Sin esta
  // gracia, este chequeo caía a veces en los segundos exactos entre "la línea venció" y "se renovó"
  // y cobraba el día de Chat App ADEMÁS del día de línea (doble cobro real: ailin/pulpo/victor, con
  // reintegros a mano). Si la línea al final NO renueva (sin saldo o desconectada), expireLines la
  // deja inactive y el próximo tick este count da 0 → el día de chat se cobra normal.
  const lineRenovando = await prisma.waLine.count({
    where: { userId, status: "active", expiresAt: { gt: new Date(now.getTime() - 30 * 60 * 1000) } },
  });
  if (lineRenovando > 0) return true;
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // 1) Claim atómico de la ventana de 24h: solo si está habilitado y no activo (null o vencido).
  const claimed = await prisma.user.updateMany({
    where: { id: userId, chatDayEnabled: true, OR: [{ chatDayExpiresAt: null }, { chatDayExpiresAt: { lte: now } }] },
    data: { chatDayExpiresAt: expiresAt },
  });
  if (claimed.count !== 1) return true; // ya activo en esta ventana, o no está habilitado

  // 2) Descuenta el día (condicional y atómico). Sin crédito, revierte el claim (paywall).
  const credit = await prisma.credit.findUnique({ where: { userId }, select: { id: true } });
  const spent = credit
    ? await prisma.credit.updateMany({ where: { id: credit.id, days: { gte: 1 } }, data: { days: { decrement: 1 } } })
    : { count: 0 };
  if (spent.count !== 1) {
    await prisma.user.update({ where: { id: userId }, data: { chatDayExpiresAt: null } }).catch(() => undefined);
    return false;
  }
  await prisma.creditLedger.create({ data: { creditId: credit!.id, delta: -1, reason: "Chat App activo 24h" } });
  return true;
}
