// Ruleta de premios del Chat App (2026-10-11).
//
// Operador (panel → Chat App → Ruleta): arma las porciones (nombre, color, ícono, tipo, monto, %), elige la
// duración y la activa. Jugador (PWA): ve la ruleta en el chat y gira; el RESULTADO lo decide el servidor.
// Premio en fichas → queda PENDIENTE y lo aprueba el cajero (regla dura: nadie recibe fichas sin que lo vea
// una persona). Al aprobar: wallet interno + /credit del casino (si la cuenta tiene casino), idempotente.
//
// Ventana: con duración, 1 giro por activación (y la ruleta se cierra sola); sin duración, 1 giro por día.
// "Gira Gratis" habilita otro giro en la misma ventana.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireChatClient } from "../middleware/requireChatClient.js";
import { emitChat } from "../lib/io.js";
import { canOperateChat } from "../lib/access.js";
import { enqueueAccountBroadcast, enqueueOperatorPush } from "../lib/chat-push.js";
import { creditPrizeInCasino } from "../lib/casino-cashier.js";
import {
  segmentosSchema, PLANTILLA, elegirPorcion, ruletaActiva, ventanaDeGiros, puedeGirar, porcionesPublicas,
  type Segmento,
} from "../lib/chat-wheel.js";

export const wheelOperatorRouter = Router();
export const wheelPlayerRouter = Router();

const ars = (n: number) => `$${n.toLocaleString("es-AR")}`;
const segmentosDe = (raw: unknown): Segmento[] => {
  const p = segmentosSchema.safeParse(raw);
  return p.success ? p.data : [];
};

// Mensaje del sistema en la conversación del jugador (lo ven él y el operador, en vivo).
async function mensajeAlJugador(userId: string, playerId: string, body: string, metadata: Record<string, unknown> = {}) {
  const conv = await prisma.chatConversation.findFirst({ where: { userId, playerId }, select: { id: true } });
  if (!conv) return;
  const msg = await prisma.chatMessage.create({
    data: { userId, conversationId: conv.id, senderType: "system", body, metadata: metadata as object },
    select: { id: true, senderType: true, body: true, metadata: true, createdAt: true },
  });
  await prisma.chatConversation.update({
    where: { id: conv.id },
    data: { lastMessageAt: new Date(), lastMessagePreview: body.slice(0, 120), unreadPlayer: { increment: 1 } },
  });
  const payload = { conversationId: conv.id, message: msg };
  emitChat(`chat:${userId}:player:${playerId}`, "chat:message", payload);
  emitChat(`chat:${userId}`, "chat:message", payload);
}

// ============================ OPERADOR (requireAuth) ============================

// GET /api/chat/wheel — configuración (o la plantilla si nunca la armó) + pendientes.
wheelOperatorRouter.get("/wheel", async (req, res) => {
  const w = await prisma.chatWheel.findUnique({ where: { userId: req.userId! } });
  const [pendientes, girosHoy] = await Promise.all([
    prisma.chatWheelSpin.count({ where: { userId: req.userId!, status: "pending" } }),
    prisma.chatWheelSpin.count({ where: { userId: req.userId!, createdAt: { gte: new Date(Date.now() - 24 * 3600e3) } } }),
  ]);
  const segs = w ? segmentosDe(w.segments) : [];
  return res.json({
    wheel: {
      segments: segs.length ? segs : PLANTILLA,
      durationMin: w?.durationMin ?? 0,
      status: w?.status ?? "draft",
      active: ruletaActiva(w),
      endsAt: w?.endsAt ?? null,
      saved: !!w,
    },
    pendientes,
    girosHoy,
  });
});

const guardarSchema = z.object({
  segments: segmentosSchema,
  durationMin: z.number().int().min(0).max(60 * 24 * 30),
});

// PUT /api/chat/wheel — guarda borrador. Si está activa, el cambio rige desde el próximo giro.
wheelOperatorRouter.put("/wheel", async (req, res) => {
  const parsed = guardarSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
  await prisma.chatWheel.upsert({
    where: { userId: req.userId! },
    create: { userId: req.userId!, segments: parsed.data.segments, durationMin: parsed.data.durationMin },
    update: { segments: parsed.data.segments, durationMin: parsed.data.durationMin },
  });
  return res.json({ ok: true });
});

// POST /api/chat/wheel/activate — guarda y ACTIVA (nueva ronda: todos pueden volver a girar).
wheelOperatorRouter.post("/wheel/activate", async (req, res) => {
  const parsed = guardarSchema.extend({ avisar: z.boolean().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
  if (!(await canOperateChat(req.userId!))) {
    return res.status(403).json({ error: "Necesitás un día activo del Chat App para activar la ruleta.", code: "line_required" });
  }
  const now = new Date();
  const { segments, durationMin, avisar } = parsed.data;
  const endsAt = durationMin > 0 ? new Date(now.getTime() + durationMin * 60_000) : null;
  const w = await prisma.chatWheel.upsert({
    where: { userId: req.userId! },
    create: { userId: req.userId!, segments, durationMin, status: "active", round: 1, activatedAt: now, endsAt },
    update: { segments, durationMin, status: "active", round: { increment: 1 }, activatedAt: now, endsAt },
  });
  let avisados = 0;
  if (avisar) {
    const brand = await prisma.user.findUnique({ where: { id: req.userId! }, select: { brandName: true } });
    avisados = await enqueueAccountBroadcast(req.userId!, {
      title: `🎡 ${brand?.brandName || "Ruleta"}: ¡ruleta activa!`,
      body: durationMin > 0 ? `Entrá y girá: tenés ${durationMin} minutos para ganar fichas.` : "Entrá y girá: hoy podés ganar fichas.",
      url: "/chat",
    }).catch(() => 0);
  }
  return res.json({ ok: true, endsAt: w.endsAt, avisados });
});

// POST /api/chat/wheel/stop — la apaga (los premios pendientes siguen esperando al cajero).
wheelOperatorRouter.post("/wheel/stop", async (req, res) => {
  await prisma.chatWheel.updateMany({ where: { userId: req.userId! }, data: { status: "draft" } });
  return res.json({ ok: true });
});

// GET /api/chat/wheel/prizes — premios que esperan al cajero (y los últimos resueltos).
wheelOperatorRouter.get("/wheel/prizes", async (req, res) => {
  const [pendientes, recientes] = await Promise.all([
    prisma.chatWheelSpin.findMany({ where: { userId: req.userId!, status: "pending" }, orderBy: { createdAt: "asc" }, take: 200 }),
    prisma.chatWheelSpin.findMany({ where: { userId: req.userId!, status: { in: ["credited", "rejected"] } }, orderBy: { resolvedAt: "desc" }, take: 20 }),
  ]);
  const ids = [...new Set([...pendientes, ...recientes].map((s) => s.playerId))];
  const players = ids.length ? await prisma.chatPlayer.findMany({ where: { id: { in: ids } }, select: { id: true, casinoUsername: true, nombre: true } }) : [];
  const nombre = new Map(players.map((p) => [p.id, p.nombre || p.casinoUsername]));
  const fila = (s: (typeof pendientes)[number]) => ({ id: s.id, player: nombre.get(s.playerId) ?? "Jugador", label: s.label, amount: s.amount, status: s.status, createdAt: s.createdAt, resolvedAt: s.resolvedAt });
  return res.json({ pendientes: pendientes.map(fila), recientes: recientes.map(fila) });
});

// POST /api/chat/wheel/prizes/:id/approve — el cajero ACREDITA el premio. Idempotente: solo desde pending.
wheelOperatorRouter.post("/wheel/prizes/:id/approve", async (req, res) => {
  const spin = await prisma.chatWheelSpin.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!spin) return res.status(404).json({ error: "No encontrado" });
  // updateMany con status en el where: dos clics (o dos cajeros) no acreditan dos veces.
  const r = await prisma.chatWheelSpin.updateMany({ where: { id: spin.id, status: "pending" }, data: { status: "credited", resolvedAt: new Date() } });
  if (!r.count) return res.status(409).json({ error: "Ese premio ya fue resuelto." });
  const wallet = await prisma.chatWallet.upsert({
    where: { playerId: spin.playerId },
    create: { userId: req.userId!, playerId: spin.playerId, balance: spin.amount },
    update: { balance: { increment: spin.amount } },
    select: { balance: true },
  });
  const player = await prisma.chatPlayer.findUnique({ where: { id: spin.playerId }, select: { casinoUsername: true } });
  if (player) void creditPrizeInCasino({ id: spin.id, userId: spin.userId, playerId: spin.playerId, amount: spin.amount, currency: "ARS" }, player.casinoUsername);
  await mensajeAlJugador(req.userId!, spin.playerId, `🎁 ¡Premio acreditado! ${ars(spin.amount)} en fichas de la ruleta. Tu saldo: ${ars(wallet.balance)}.`);
  emitChat(`chat:${req.userId}:player:${spin.playerId}`, "chat:wallet", { balance: wallet.balance });
  return res.json({ ok: true, balance: wallet.balance });
});

// POST /api/chat/wheel/prizes/:id/reject — el cajero lo rechaza (ej. cuenta duplicada para girar más).
wheelOperatorRouter.post("/wheel/prizes/:id/reject", async (req, res) => {
  const spin = await prisma.chatWheelSpin.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!spin) return res.status(404).json({ error: "No encontrado" });
  const r = await prisma.chatWheelSpin.updateMany({ where: { id: spin.id, status: "pending" }, data: { status: "rejected", resolvedAt: new Date() } });
  if (!r.count) return res.status(409).json({ error: "Ese premio ya fue resuelto." });
  await mensajeAlJugador(req.userId!, spin.playerId, `No pudimos acreditar el premio de la ruleta (${spin.label}). Escribinos y lo revisamos.`);
  return res.json({ ok: true });
});

// ============================ JUGADOR (requireChatClient) ============================

// GET /api/chat/me/wheel — si hay ruleta activa: porciones (sin probabilidades), cierre y si puede girar.
wheelPlayerRouter.get("/me/wheel", requireChatClient, async (req, res) => {
  const w = await prisma.chatWheel.findUnique({ where: { userId: req.accountId! } });
  if (!ruletaActiva(w) || !(await canOperateChat(req.accountId!))) return res.json({ wheel: null });
  const segs = segmentosDe(w!.segments);
  if (!segs.length) return res.json({ wheel: null });
  const giros = await prisma.chatWheelSpin.findMany({
    where: { playerId: req.chatPlayerId!, userId: req.accountId!, ...ventanaDeGiros(w!) },
    select: { prizeType: true, createdAt: true, label: true },
  });
  return res.json({
    wheel: {
      segments: porcionesPublicas(segs),
      endsAt: w!.endsAt,
      round: w!.round,
      canSpin: puedeGirar(giros),
      diaria: w!.durationMin === 0,
    },
  });
});

// POST /api/chat/me/wheel/spin — gira. El servidor elige la porción y la registra; el navegador solo anima.
wheelPlayerRouter.post("/me/wheel/spin", requireChatClient, async (req, res) => {
  const accountId = req.accountId!, playerId = req.chatPlayerId!;
  const w = await prisma.chatWheel.findUnique({ where: { userId: accountId } });
  if (!ruletaActiva(w) || !(await canOperateChat(accountId))) return res.status(410).json({ error: "La ruleta ya no está activa." });
  const segs = segmentosDe(w!.segments);
  if (!segs.length) return res.status(410).json({ error: "La ruleta ya no está activa." });

  // Un giro a la vez por jugador: lock transaccional por (cuenta, jugador) para que dos toques rápidos
  // (o dos pestañas) no giren dos veces.
  const resultado = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`wheel:${accountId}:${playerId}`}))`;
    const giros = await tx.chatWheelSpin.findMany({
      where: { playerId, userId: accountId, ...ventanaDeGiros(w!) },
      select: { prizeType: true, createdAt: true },
    });
    if (!puedeGirar(giros)) return null;
    const idx = elegirPorcion(segs);
    const s = segs[idx];
    const spin = await tx.chatWheelSpin.create({
      data: {
        userId: accountId, playerId, round: w!.round, segment: idx, label: s.label, prizeType: s.type,
        amount: s.type === "fichas" ? s.amount : 0, status: s.type === "fichas" ? "pending" : "none",
      },
    });
    return { idx, s, spin };
  });
  if (!resultado) return res.status(409).json({ error: "Ya giraste. ¡Volvé a la próxima!" });
  const { idx, s, spin } = resultado;

  // Resultado en el chat (lo ve también el cajero) y aviso al operador si hay premio que aprobar.
  if (s.type === "fichas") {
    await mensajeAlJugador(accountId, playerId, `🎡 ¡Ganaste ${s.label} en la ruleta! El cajero te las acredita en breve.`, { wheelPrize: spin.id });
    emitChat(`chat:${accountId}`, "chat:cashier", { type: "wheel", id: spin.id });
    void enqueueOperatorPush(accountId, { title: "🎡 Premio de ruleta", body: `Un jugador ganó ${s.label}: aprobalo en Cajero.`, url: "/chat" }).catch(() => undefined);
  } else if (s.type === "giro") {
    await mensajeAlJugador(accountId, playerId, "🎡 ¡Giro gratis! Volvé a girar la ruleta.");
  } else {
    await mensajeAlJugador(accountId, playerId, `🎡 Salió "${s.label}". ¡La próxima seguro te toca!`);
  }
  const giros = await prisma.chatWheelSpin.findMany({ where: { playerId, userId: accountId, ...ventanaDeGiros(w!) }, select: { prizeType: true, createdAt: true } });
  return res.json({ segment: idx, label: s.label, type: s.type, amount: s.type === "fichas" ? s.amount : 0, canSpin: puedeGirar(giros) });
});
