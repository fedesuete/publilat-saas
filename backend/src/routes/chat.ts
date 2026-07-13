// Chat App (módulo AISLADO jugador↔cajero). Rutas /api/chat/*. NO comparte tablas con el
// Inbox de WhatsApp ni pasa por getEngine(). El operador es el User de la cuenta (requireAuth);
// el jugador entra passwordless por un link de invitación (JWT client).
import { Router } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { signChatClientToken, requireChatClient } from "../middleware/requireChatClient.js";
import { sendCapiEvent } from "../lib/meta-capi.js"; // reuso el CAPI existente, NO reimplemento
import { resolveUserPixel } from "../lib/pixel.js";
import { emitChat, playerHasLiveSocket } from "../lib/io.js";

// Router del OPERADOR (se monta bajo requireAuth): gestión de links de invitación.
export const chatRouter = Router();
// Router PÚBLICO (sin auth de operador): branding, registro y login del jugador.
export const chatPublicRouter = Router();

// Código de invitación: 8 chars base64url (crypto), único.
const newCode = () => crypto.randomBytes(6).toString("base64url"); // 6 bytes -> 8 chars

// Dispara el Lead por CAPI al registrarse un jugador que vino de un anuncio (fbclid).
// Reusa sendCapiEvent (lib/meta-capi.ts) — NO toca go.ts ni reimplementa la CAPI. Best-effort.
async function fireChatLead(userId: string, playerId: string, at: { fbclid?: string; fbp?: string; fbc?: string }) {
  try {
    const creds = await resolveUserPixel(userId, "Lead");
    const fbc = at.fbc ?? (at.fbclid ? `fb.1.${Date.now()}.${at.fbclid}` : undefined);
    await sendCapiEvent({
      eventName: "Lead",
      externalId: playerId,       // id estable del jugador (mismo en un futuro Purchase -> match)
      eventId: playerId,
      fbp: at.fbp,
      fbc,
      actionSource: "chat",       // lead de conversación (canal chat), no web
      pixelId: creds?.pixelId,
      capiToken: creds?.capiToken,
    });
  } catch (e) {
    console.error("[chat] Lead CAPI falló:", e instanceof Error ? e.message : String(e));
  }
}

// ============================ OPERADOR (requireAuth) ============================

// GET /api/chat/invites — links del operador (su cuenta).
chatRouter.get("/invites", async (req, res) => {
  const invites = await prisma.inviteCode.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: "desc" },
    select: { id: true, code: true, label: true, isActive: true, createdAt: true },
  });
  return res.json({ invites });
});

const createInviteSchema = z.object({ label: z.string().max(80).optional() });

// POST /api/chat/invites — crea un link single-use. code único (reintenta si choca).
chatRouter.post("/invites", async (req, res) => {
  const parsed = createInviteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido" });
  for (let i = 0; i < 5; i++) {
    try {
      const invite = await prisma.inviteCode.create({
        data: { userId: req.userId!, operatorId: req.userId!, code: newCode(), label: parsed.data.label },
        select: { id: true, code: true, label: true, isActive: true, createdAt: true },
      });
      return res.status(201).json({ invite });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue; // code repetido
      throw e;
    }
  }
  return res.status(500).json({ error: "No se pudo generar el código, reintentá" });
});

// DELETE /api/chat/invites/:id — borra (ownership por userId).
chatRouter.delete("/invites/:id", async (req, res) => {
  const invite = await prisma.inviteCode.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!invite) return res.status(404).json({ error: "No encontrado" });
  await prisma.inviteCode.delete({ where: { id: invite.id } });
  return res.json({ ok: true });
});

// GET /api/chat/conversations — lista de chats del operador (su cuenta).
chatRouter.get("/conversations", async (req, res) => {
  const convs = await prisma.chatConversation.findMany({
    where: { userId: req.userId! },
    orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
    take: 200,
    select: {
      id: true, status: true, unreadOperator: true, lastMessagePreview: true, lastMessageAt: true, createdAt: true,
      player: { select: { casinoUsername: true, nombre: true } },
    },
  });
  return res.json({
    conversations: convs.map((c) => ({
      id: c.id,
      player: c.player.nombre || c.player.casinoUsername,
      username: c.player.casinoUsername,
      status: c.status,
      unread: c.unreadOperator,
      preview: c.lastMessagePreview ?? "",
      lastAt: (c.lastMessageAt ?? c.createdAt).toISOString(),
    })),
  });
});

// GET /api/chat/conversations/:id/messages — historial (operador). Marca leído.
chatRouter.get("/conversations/:id/messages", async (req, res) => {
  const conv = await prisma.chatConversation.findFirst({ where: { id: req.params.id, userId: req.userId! }, select: { id: true } });
  if (!conv) return res.status(404).json({ error: "Conversación no encontrada" });
  const messages = await prisma.chatMessage.findMany({
    where: { conversationId: conv.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, senderType: true, body: true, metadata: true, createdAt: true },
  });
  await prisma.chatConversation.update({ where: { id: conv.id }, data: { unreadOperator: 0 } });
  return res.json({ messages });
});

const opSendSchema = z.object({ conversationId: z.string().min(1), body: z.string().min(1).max(4000) });

// POST /api/chat/messages — el operador responde. CÓDIGO PROPIO del chat: NO pasa por
// getEngine()/sendText de WhatsApp. Emite por el namespace /chat a la sala del jugador; si
// el jugador no tiene socket vivo, queda marcado para Web Push (Fase 5).
chatRouter.post("/messages", async (req, res) => {
  const parsed = opSendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido" });
  const conv = await prisma.chatConversation.findFirst({
    where: { id: parsed.data.conversationId, userId: req.userId! },
    select: { id: true, playerId: true },
  });
  if (!conv) return res.status(404).json({ error: "Conversación no encontrada" });

  const msg = await prisma.chatMessage.create({
    data: { userId: req.userId!, conversationId: conv.id, senderType: "operator", senderId: req.userId!, body: parsed.data.body },
    select: { id: true, senderType: true, body: true, createdAt: true },
  });
  await prisma.chatConversation.update({
    where: { id: conv.id },
    data: { lastMessageAt: new Date(), lastMessagePreview: parsed.data.body.slice(0, 120), unreadPlayer: { increment: 1 } },
  });

  const payload = { conversationId: conv.id, message: msg };
  emitChat(`chat:${req.userId}:player:${conv.playerId}`, "chat:message", payload); // al jugador
  emitChat(`chat:${req.userId}`, "chat:message", payload);                          // al operador (otras pestañas)

  // Sin socket vivo del jugador -> pendiente de Web Push (Fase 5).
  if (!(await playerHasLiveSocket(req.userId!, conv.playerId))) {
    console.log(`[chat] jugador ${conv.playerId} sin socket; mensaje pendiente de Web Push (F5)`);
    // TODO F5: encolar Web Push a las ChatPushSub del jugador.
  }
  return res.status(201).json({ message: msg });
});

// ============================ JUGADOR (requireChatClient) ============================

// GET /api/chat/me/conversation — su conversación + historial. Marca leído.
chatPublicRouter.get("/me/conversation", requireChatClient, async (req, res) => {
  const conv = await prisma.chatConversation.findFirst({ where: { userId: req.accountId!, playerId: req.chatPlayerId! }, select: { id: true } });
  if (!conv) return res.json({ conversationId: null, messages: [] });
  const messages = await prisma.chatMessage.findMany({
    where: { conversationId: conv.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, senderType: true, body: true, metadata: true, createdAt: true },
  });
  await prisma.chatConversation.update({ where: { id: conv.id }, data: { unreadPlayer: 0 } });
  return res.json({ conversationId: conv.id, messages });
});

const playerSendSchema = z.object({ body: z.string().min(1).max(4000) });

// POST /api/chat/me/messages — el jugador manda. Emite al operador por /chat.
chatPublicRouter.post("/me/messages", requireChatClient, async (req, res) => {
  const parsed = playerSendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido" });
  const conv = await prisma.chatConversation.findFirst({ where: { userId: req.accountId!, playerId: req.chatPlayerId! }, select: { id: true } });
  if (!conv) return res.status(404).json({ error: "Conversación no encontrada" });

  const msg = await prisma.chatMessage.create({
    data: { userId: req.accountId!, conversationId: conv.id, senderType: "player", senderId: req.chatPlayerId!, body: parsed.data.body },
    select: { id: true, senderType: true, body: true, createdAt: true },
  });
  await prisma.chatConversation.update({
    where: { id: conv.id },
    data: { lastMessageAt: new Date(), lastMessagePreview: parsed.data.body.slice(0, 120), unreadOperator: { increment: 1 } },
  });

  const payload = { conversationId: conv.id, message: msg };
  emitChat(`chat:${req.accountId}`, "chat:message", payload);                              // al operador
  emitChat(`chat:${req.accountId}:player:${req.chatPlayerId}`, "chat:message", payload);   // al jugador (otros dispositivos)
  return res.status(201).json({ message: msg });
});

// ============================ PÚBLICO (jugador) ============================

// GET /api/chat/branding/:code — marca de la cuenta para pintar la PWA. Devuelve el branding
// aunque el link ya se haya usado (para mostrar la marca); `codeActive` dice si aún se puede registrar.
chatPublicRouter.get("/branding/:code", async (req, res) => {
  const invite = await prisma.inviteCode.findUnique({ where: { code: req.params.code } });
  if (!invite) return res.status(404).json({ error: "Link inválido" });
  const acc = await prisma.user.findUnique({
    where: { id: invite.userId },
    select: { slug: true, brandName: true, logoUrl: true, primaryColor: true, accentColor: true, welcomeText: true },
  });
  if (!acc) return res.status(404).json({ error: "Cuenta no encontrada" });
  return res.json({
    accountSlug: acc.slug,
    codeActive: invite.isActive,
    branding: {
      brandName: acc.brandName,
      logoUrl: acc.logoUrl,
      primaryColor: acc.primaryColor,
      accentColor: acc.accentColor,
      welcomeText: acc.welcomeText,
    },
  });
});

const registerSchema = z.object({
  code: z.string().min(4).max(40),
  username: z.string().min(2).max(40),
  fbclid: z.string().max(400).optional(),
  fbp: z.string().max(200).optional(),
  fbc: z.string().max(200).optional(),
});

// POST /api/chat/register — registro passwordless por link single-use.
chatPublicRouter.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido", details: parsed.error.flatten() });
  const { code, username, fbclid, fbp, fbc } = parsed.data;

  const invite = await prisma.inviteCode.findUnique({ where: { code } });
  if (!invite || !invite.isActive) {
    // Link inexistente o YA USADO (single-use). El 2º registro con el mismo link cae acá -> 404.
    return res.status(404).json({ error: "Este link ya no está disponible. Pedí uno nuevo o iniciá sesión." });
  }

  // Crear el jugador PRIMERO (así, si el usuario está tomado, el link NO se cierra y puede
  // reintentar con otro nombre). El unique (userId, casinoUsername) + P2002 cubre la carrera.
  let player;
  try {
    player = await prisma.chatPlayer.create({
      data: {
        userId: invite.userId,
        casinoUsername: username.trim(),
        invitedByUserId: invite.operatorId,
        inviteCodeId: invite.id,
      },
      select: { id: true, casinoUsername: true },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return res.status(409).json({ error: "Ese usuario ya está registrado. Elegí otro o iniciá sesión.", code: "USERNAME_TAKEN" });
    }
    throw e;
  }

  // Recién ahora cerramos el link (single-use). updateMany condicional: si otra request lo
  // cerró en la carrera, count=0 (aceptado: el jugador ya quedó creado, es un caso de borde).
  await prisma.inviteCode.updateMany({ where: { id: invite.id, isActive: true }, data: { isActive: false } });

  // Abrir la conversación asignada al operador del link + mensaje de bienvenida de la cuenta.
  const acc = await prisma.user.findUnique({
    where: { id: invite.userId },
    select: { welcomeMsgText: true, welcomeMsgImage: true },
  });
  const conv = await prisma.chatConversation.create({
    data: { userId: invite.userId, playerId: player.id, assignedOperatorId: invite.operatorId, status: "open" },
    select: { id: true },
  });
  const welcomeBody = acc?.welcomeMsgText?.trim();
  if (welcomeBody || acc?.welcomeMsgImage) {
    await prisma.chatMessage.create({
      data: {
        userId: invite.userId,
        conversationId: conv.id,
        senderType: "system",
        body: welcomeBody ?? null,
        metadata: acc?.welcomeMsgImage ? { image: acc.welcomeMsgImage } : {},
      },
    });
    await prisma.chatConversation.update({
      where: { id: conv.id },
      data: { lastMessageAt: new Date(), lastMessagePreview: welcomeBody ?? "📷 Imagen", unreadPlayer: 1 },
    });
  }

  // Lead por CAPI si vino de un anuncio (fbclid). Best-effort, no bloquea el registro.
  if (fbclid || fbc) void fireChatLead(invite.userId, player.id, { fbclid, fbp, fbc });

  const token = signChatClientToken(invite.userId, player.id);
  return res.status(201).json({ token, player, conversationId: conv.id });
});

const loginSchema = z.object({
  accountSlug: z.string().min(1).max(60),
  username: z.string().min(2).max(40),
});

// POST /api/chat/login — reingreso passwordless (resuelve la cuenta por User.slug).
chatPublicRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido" });
  const acc = await prisma.user.findUnique({ where: { slug: parsed.data.accountSlug }, select: { id: true } });
  if (!acc) return res.status(404).json({ error: "Cuenta no encontrada" });
  const player = await prisma.chatPlayer.findUnique({
    where: { userId_casinoUsername: { userId: acc.id, casinoUsername: parsed.data.username.trim() } },
    select: { id: true, casinoUsername: true },
  });
  if (!player) return res.status(404).json({ error: "No encontramos ese usuario. Registrate con tu link de invitación." });
  const conv = await prisma.chatConversation.findFirst({ where: { userId: acc.id, playerId: player.id }, select: { id: true } });
  const token = signChatClientToken(acc.id, player.id);
  return res.json({ token, player, conversationId: conv?.id ?? null });
});
