// Chat App (módulo AISLADO jugador↔cajero). Rutas /api/chat/*. NO comparte tablas con el
// Inbox de WhatsApp ni pasa por getEngine(). El operador es el User de la cuenta (requireAuth);
// el jugador entra passwordless por un link de invitación (JWT client).
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { signChatClientToken, requireChatClient } from "../middleware/requireChatClient.js";
import { hashPassword, verifyPassword } from "../lib/auth.js";
import { sendCapiEvent } from "../lib/meta-capi.js"; // reuso el CAPI existente, NO reimplemento
import { resolveUserPixel } from "../lib/pixel.js";
import { emitChat, playerHasLiveSocket } from "../lib/io.js";
import { pushEnabled, publicVapidKey, enqueuePlayerPush, enqueueAccountBroadcast } from "../lib/chat-push.js";
import { s3Enabled } from "../lib/s3.js";
import { runChatBot } from "../lib/chat-bot.js";

// Router del OPERADOR (se monta bajo requireAuth): gestión de links de invitación.
export const chatRouter = Router();
// Router PÚBLICO (sin auth de operador): branding, registro y login del jugador.
export const chatPublicRouter = Router();

// Código de invitación: 8 chars base64url (crypto), único.
const newCode = () => crypto.randomBytes(6).toString("base64url"); // 6 bytes -> 8 chars

// ¿La cuenta tiene al menos una línea de WhatsApp con un DÍA PAGADO VIGENTE (expiresAt futuro)?
// El Chat App se vende junto con el servicio de líneas. Gateamos por el día pagado y NO por
// status/connected a propósito: el `status` sigue a la conexión (webhook.ts pone active/inactive
// según connected), así que una desconexión momentánea de WhatsApp NO debe apagar el Chat App de
// alguien que pagó. Cuando el día vence, line-expiry deja expiresAt en el pasado -> se corta solo.
async function hasActiveWaLine(userId: string): Promise<boolean> {
  const n = await prisma.waLine.count({ where: { userId, expiresAt: { gt: new Date() } } });
  return n > 0;
}

// Gate para las acciones SALIENTES del Chat App (responder, notificar, popup): requieren una línea
// de WhatsApp activa. Sin ella respondemos 403 con un mensaje claro para que el panel lo muestre.
// El branding, los invites y la lectura NO se gatean (el operador puede seguir viendo/configurando).
async function requireActiveLine(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (await hasActiveWaLine(req.userId!)) return next();
  res.status(403).json({
    error: "Necesitás una línea de WhatsApp activa (con días) para responder, notificar o mostrar popups en el Chat App. Recargá días y activá una línea.",
    code: "line_required",
  });
}

// GET /api/chat/status — el panel consulta si puede operar (hay línea de WhatsApp activa).
chatRouter.get("/status", async (req, res) => {
  res.json({ activeLine: await hasActiveWaLine(req.userId!) });
});

// Clave por defecto de un acceso nuevo (el operador se la pasa al cliente; el cliente entra con eso).
const DEFAULT_CHAT_PASSWORD = "Hola123";
const accessSchema = z.object({
  username: z.string().trim().min(2).max(40),
  password: z.string().min(4).max(60).optional(),
});

// POST /api/chat/access — el operador crea (o resetea) un ACCESO con usuario + clave para un
// cliente. Devuelve las credenciales (clave en texto) para pasárselas. Si el usuario ya existe,
// le re-setea la clave (sirve de "resetear acceso"). Clave por defecto: "Hola123".
chatRouter.post("/access", async (req, res) => {
  const parsed = accessSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido", details: parsed.error.flatten() });
  const username = parsed.data.username.trim();
  const password = parsed.data.password ?? DEFAULT_CHAT_PASSWORD;
  const hash = await hashPassword(password);
  const acc = await prisma.user.findUnique({ where: { id: req.userId! }, select: { slug: true, welcomeMsgText: true, welcomeMsgImage: true } });

  const existing = await prisma.chatPlayer.findUnique({
    where: { userId_casinoUsername: { userId: req.userId!, casinoUsername: username } },
    select: { id: true },
  });

  if (existing) {
    await prisma.chatPlayer.update({ where: { id: existing.id }, data: { password: hash } });
  } else {
    const player = await prisma.chatPlayer.create({
      data: { userId: req.userId!, casinoUsername: username, password: hash, estatus: "active" },
      select: { id: true },
    });
    // Abrimos su conversación + mensaje de bienvenida (igual que el registro por invitación).
    const conv = await prisma.chatConversation.create({ data: { userId: req.userId!, playerId: player.id, status: "open" }, select: { id: true } });
    const welcomeBody = acc?.welcomeMsgText?.trim();
    if (welcomeBody || acc?.welcomeMsgImage) {
      await prisma.chatMessage.create({ data: { userId: req.userId!, conversationId: conv.id, senderType: "system", body: welcomeBody ?? null, metadata: acc?.welcomeMsgImage ? { image: acc.welcomeMsgImage } : {} } });
      await prisma.chatConversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date(), lastMessagePreview: welcomeBody ?? "📷 Imagen", unreadPlayer: 1 } });
    }
  }
  return res.json({ accountSlug: acc?.slug ?? "", username, password, reset: !!existing });
});

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
      id: true, playerId: true, status: true, unreadOperator: true, lastMessagePreview: true, lastMessageAt: true, createdAt: true,
      player: { select: { casinoUsername: true, nombre: true } },
    },
  });
  return res.json({
    conversations: convs.map((c) => ({
      id: c.id,
      playerId: c.playerId,
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
chatRouter.post("/messages", requireActiveLine, async (req, res) => {
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

  // Sin socket vivo del jugador -> Web Push (best-effort, no bloquea la respuesta).
  if (!(await playerHasLiveSocket(req.userId!, conv.playerId))) {
    const preview = parsed.data.body.slice(0, 140);
    void enqueuePlayerPush(req.userId!, conv.playerId, { title: "Nuevo mensaje", body: preview, url: "/chat" })
      .catch((e) => console.error("[chat] push falló:", e instanceof Error ? e.message : String(e)));
  }
  return res.status(201).json({ message: msg });
});

const broadcastSchema = z.object({
  title: z.string().min(1).max(80),
  body: z.string().min(1).max(240),
  url: z.string().max(300).optional(),
  image: z.string().url().max(600).optional(),     // imagen grande de la notificación (opcional)
  playerId: z.string().min(1).optional(),          // si viene: aviso individual; si no: a TODOS
  alsoChat: z.boolean().optional(),                // además del push, dejarlo como mensaje en el chat (default true)
});

// Deja el aviso como MENSAJE del chat (senderType "operator") en la(s) conversación(es) destino, con
// la imagen en metadata. Así se ve adentro de la app —donde la imagen SÍ es confiable— aunque el
// Android no muestre la imagen grande en la notificación. Emite chat:message para verlo en vivo.
async function postBroadcastToChat(userId: string, playerId: string | undefined, title: string, body: string, image?: string) {
  const msgBody = `${title}\n${body}`.trim();
  const metadata = image ? { image } : {};

  let convs: { id: string; playerId: string }[];
  if (playerId) {
    const existing = await prisma.chatConversation.findFirst({ where: { userId, playerId }, select: { id: true, playerId: true } });
    convs = existing ? [existing] : [await prisma.chatConversation.create({ data: { userId, playerId }, select: { id: true, playerId: true } })];
  } else {
    convs = await prisma.chatConversation.findMany({ where: { userId }, select: { id: true, playerId: true } });
  }

  for (const conv of convs) {
    const msg = await prisma.chatMessage.create({
      data: { userId, conversationId: conv.id, senderType: "operator", senderId: userId, body: msgBody, metadata },
      select: { id: true, senderType: true, body: true, metadata: true, createdAt: true },
    });
    await prisma.chatConversation.update({
      where: { id: conv.id },
      data: { lastMessageAt: new Date(), lastMessagePreview: (image ? "📷 " : "") + body.slice(0, 110), unreadPlayer: { increment: 1 } },
    });
    const payload = { conversationId: conv.id, message: { id: msg.id, senderType: msg.senderType, body: msg.body, image: (msg.metadata as { image?: string })?.image ?? null, createdAt: msg.createdAt } };
    emitChat(`chat:${userId}:player:${conv.playerId}`, "chat:message", payload);
    emitChat(`chat:${userId}`, "chat:message", payload);
  }
}

// POST /api/chat/push/broadcast — el operador manda una notificación push. Con playerId va a UN
// jugador; sin playerId va a TODOS sus jugadores suscriptos. Devuelve a cuántas se encoló.
chatRouter.post("/push/broadcast", requireActiveLine, async (req, res) => {
  const parsed = broadcastSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido" });
  if (!pushEnabled()) return res.status(503).json({ error: "Web Push no está configurado (faltan VAPID)" });
  const payload = { title: parsed.data.title, body: parsed.data.body, url: parsed.data.url ?? "/chat", image: parsed.data.image };
  let sent: number;
  if (parsed.data.playerId) {
    const player = await prisma.chatPlayer.findFirst({ where: { id: parsed.data.playerId, userId: req.userId! }, select: { id: true } });
    if (!player) return res.status(404).json({ error: "Jugador no encontrado" });
    sent = await enqueuePlayerPush(req.userId!, player.id, payload);
  } else {
    sent = await enqueueAccountBroadcast(req.userId!, payload);
  }
  // Además del push, dejamos el aviso como MENSAJE en el chat (con la imagen) para que se vea
  // adentro de la app aunque el Android no muestre la imagen en la notificación. Best-effort.
  if (parsed.data.alsoChat !== false) {
    try { await postBroadcastToChat(req.userId!, parsed.data.playerId, parsed.data.title, parsed.data.body, parsed.data.image); }
    catch (e) { console.error("[chat] postBroadcastToChat falló:", e instanceof Error ? e.message : String(e)); }
  }

  // Registrar el aviso para las métricas (a quién, cuántos recibieron).
  await prisma.chatBroadcast.create({
    data: { userId: req.userId!, title: parsed.data.title, body: parsed.data.body, image: parsed.data.image ?? null, target: parsed.data.playerId ?? "all", sentCount: sent },
  });
  return res.json({ ok: true, sent });
});

// GET /api/chat/push/stats — métricas de notificaciones: total de jugadores, cuántos tienen el
// push activo, y la lista (quién lo activó y quién no).
chatRouter.get("/push/stats", async (req, res) => {
  const userId = req.userId!;
  const [players, subs] = await Promise.all([
    prisma.chatPlayer.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, select: { id: true, casinoUsername: true, nombre: true, createdAt: true } }),
    prisma.chatPushSub.findMany({ where: { userId }, select: { playerId: true } }),
  ]);
  const pushSet = new Set(subs.map((s) => s.playerId).filter(Boolean) as string[]);
  const list = players.map((p) => ({ id: p.id, username: p.casinoUsername, name: p.nombre, hasPush: pushSet.has(p.id), createdAt: p.createdAt }));
  return res.json({ totalPlayers: players.length, playersWithPush: list.filter((p) => p.hasPush).length, players: list });
});

// GET /api/chat/broadcasts — últimos 10 avisos enviados (con a quién y cuántos recibieron).
chatRouter.get("/broadcasts", async (req, res) => {
  const rows = await prisma.chatBroadcast.findMany({ where: { userId: req.userId! }, orderBy: { createdAt: "desc" }, take: 10 });
  const ids = rows.filter((r) => r.target !== "all").map((r) => r.target);
  const players = ids.length ? await prisma.chatPlayer.findMany({ where: { id: { in: ids } }, select: { id: true, casinoUsername: true } }) : [];
  const nameById = new Map(players.map((p) => [p.id, p.casinoUsername]));
  return res.json({
    broadcasts: rows.map((r) => ({
      id: r.id, title: r.title, body: r.body, image: r.image,
      target: r.target === "all" ? "Todos" : (nameById.get(r.target) ?? "Jugador"),
      sent: r.sentCount, createdAt: r.createdAt,
    })),
  });
});

// ============================ BRANDING WHITE-LABEL (operador) ============================

// Solo estos campos del User son "branding" del Chat App. El PATCH NUNCA toca otra cosa
// (nada de plan, tokenVersion, líneas de WhatsApp, etc.).
const BRANDING_FIELDS = ["brandName", "logoUrl", "primaryColor", "accentColor", "welcomeText", "welcomeMsgText", "welcomeMsgImage"] as const;

// GET /api/chat/branding — branding actual de la cuenta (para poblar el formulario del panel).
chatRouter.get("/branding", async (req, res) => {
  const acc = await prisma.user.findUnique({
    where: { id: req.userId! },
    select: { slug: true, brandName: true, logoUrl: true, primaryColor: true, accentColor: true, welcomeText: true, welcomeMsgText: true, welcomeMsgImage: true },
  });
  if (!acc) return res.status(404).json({ error: "Cuenta no encontrada" });
  return res.json({ accountSlug: acc.slug, branding: acc, s3: s3Enabled() });
});

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color inválido (usá #RRGGBB)");
const brandingSchema = z.object({
  brandName: z.string().max(60).nullish(),
  logoUrl: z.string().url().max(600).nullish(),
  primaryColor: hexColor.nullish(),
  accentColor: hexColor.nullish(),
  welcomeText: z.string().max(300).nullish(),
  welcomeMsgText: z.string().max(1000).nullish(),
  welcomeMsgImage: z.string().url().max(600).nullish(),
});

// PATCH /api/chat/branding — actualiza SOLO los campos de branding del User del token.
chatRouter.patch("/branding", async (req, res) => {
  const parsed = brandingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido", details: parsed.error.flatten() });
  // Whitelist estricta: sólo BRANDING_FIELDS que vinieron en el body (undefined = no tocar).
  const data: Record<string, string | null> = {};
  for (const k of BRANDING_FIELDS) {
    const v = (parsed.data as Record<string, unknown>)[k];
    if (v !== undefined) data[k] = (v as string | null);
  }
  if (Object.keys(data).length === 0) return res.status(400).json({ error: "Nada para actualizar" });
  const acc = await prisma.user.update({
    where: { id: req.userId! },
    data,
    select: { slug: true, brandName: true, logoUrl: true, primaryColor: true, accentColor: true, welcomeText: true, welcomeMsgText: true, welcomeMsgImage: true },
  });
  return res.json({ branding: acc });
});

const logoSchema = z.object({ dataUrl: z.string().regex(/^data:image\/(png|jpeg|jpg|webp|gif);base64,/, "Imagen inválida") });

// POST /api/chat/branding/logo — sube una imagen (logo o bienvenida) y devuelve una URL corta
// y estable servida por el propio backend (/api/chat/branding/asset/:id). NO usa S3: el bucket
// es privado y sin CloudFront la URL directa no carga. Una URL corta también entra en el max(600)
// del PATCH y no infla el body (a diferencia de guardar el data URL entero).
chatRouter.post("/branding/logo", async (req, res) => {
  const parsed = logoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enviá una imagen PNG/JPG/WEBP/GIF" });
  const { dataUrl } = parsed.data;
  const comma = dataUrl.indexOf(",");
  const mime = dataUrl.slice(5, dataUrl.indexOf(";"));
  const buffer = Buffer.from(dataUrl.slice(comma + 1), "base64");
  // Tope 700 KB: en base64 (~1.37x) queda por debajo del límite global de body de 1 MB.
  if (buffer.length > 700 * 1024) return res.status(413).json({ error: "La imagen supera 700 KB. Comprimila o usá una más liviana." });

  const asset = await prisma.brandingAsset.create({
    data: { userId: req.userId!, contentType: mime, data: buffer },
    select: { id: true },
  });
  const base = (process.env.APP_BASE_URL ?? "http://localhost:4000").replace(/\/$/, "");
  return res.json({ url: `${base}/api/chat/branding/asset/${asset.id}` });
});

const POPUP_FIELDS = ["popupActive", "popupImageUrl", "popupTitle", "popupText", "popupLink"] as const;
const popupSelect = { popupActive: true, popupImageUrl: true, popupTitle: true, popupText: true, popupLink: true, popupFrom: true, popupUntil: true, popupUpdatedAt: true };

// GET /api/chat/popup — el popup/promo que ve el jugador al entrar (para el editor del panel).
chatRouter.get("/popup", async (req, res) => {
  const popup = await prisma.user.findUnique({ where: { id: req.userId! }, select: popupSelect });
  return res.json({ popup });
});

const popupSchema = z.object({
  popupActive: z.boolean().optional(),
  popupImageUrl: z.string().url().max(600).nullish(),
  popupTitle: z.string().max(80).nullish(),
  popupText: z.string().max(500).nullish(),
  popupLink: z.string().url().max(600).nullish(),
  popupFrom: z.string().datetime({ offset: true }).nullish(),  // ISO; ventana opcional
  popupUntil: z.string().datetime({ offset: true }).nullish(),
});

// PATCH /api/chat/popup — edita el popup. popupUpdatedAt se toca SIEMPRE: versiona el aviso para
// que el jugador lo vuelva a ver una vez (el cliente deduplica por esa fecha).
chatRouter.patch("/popup", requireActiveLine, async (req, res) => {
  const parsed = popupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido", details: parsed.error.flatten() });
  const data: Record<string, unknown> = { popupUpdatedAt: new Date() };
  for (const k of POPUP_FIELDS) {
    const v = (parsed.data as Record<string, unknown>)[k];
    if (v !== undefined) data[k] = v;
  }
  if (parsed.data.popupFrom !== undefined) data.popupFrom = parsed.data.popupFrom ? new Date(parsed.data.popupFrom) : null;
  if (parsed.data.popupUntil !== undefined) data.popupUntil = parsed.data.popupUntil ? new Date(parsed.data.popupUntil) : null;
  const popup = await prisma.user.update({ where: { id: req.userId! }, data, select: popupSelect });
  return res.json({ popup });
});

// ---- Bot de carga/descarga (config por cuenta) ----
const botSelect = { botEnabled: true, botPaymentInfo: true, botWelcome: true } as const;

// GET /api/chat/bot — config actual del bot (operador).
chatRouter.get("/bot", async (req, res) => {
  const bot = await prisma.user.findUnique({ where: { id: req.userId! }, select: botSelect });
  return res.json({ bot });
});

const botSchema = z.object({
  botEnabled: z.boolean().optional(),
  botPaymentInfo: z.string().max(1500).nullish(),
  botWelcome: z.string().max(500).nullish(),
});
// PATCH /api/chat/bot — prende/apaga el bot y edita los datos de pago / bienvenida.
chatRouter.patch("/bot", async (req, res) => {
  const parsed = botSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido" });
  const data: Record<string, unknown> = {};
  if (parsed.data.botEnabled !== undefined) data.botEnabled = parsed.data.botEnabled;
  if (parsed.data.botPaymentInfo !== undefined) data.botPaymentInfo = parsed.data.botPaymentInfo;
  if (parsed.data.botWelcome !== undefined) data.botWelcome = parsed.data.botWelcome;
  const bot = await prisma.user.update({ where: { id: req.userId! }, data, select: botSelect });
  return res.json({ bot });
});

// ============================ JUGADOR (requireChatClient) ============================

// GET /api/chat/me/conversation — su conversación + historial. Marca leído.
chatPublicRouter.get("/me/conversation", requireChatClient, async (req, res) => {
  const conv = await prisma.chatConversation.findFirst({ where: { userId: req.accountId!, playerId: req.chatPlayerId! }, select: { id: true } });
  if (!conv) return res.json({ conversationId: null, messages: [] });
  const rows = await prisma.chatMessage.findMany({
    where: { conversationId: conv.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, senderType: true, body: true, metadata: true, createdAt: true },
  });
  await prisma.chatConversation.update({ where: { id: conv.id }, data: { unreadPlayer: 0 } });
  const messages = rows.map((m) => ({ id: m.id, senderType: m.senderType, body: m.body, image: (m.metadata as { image?: string })?.image ?? null, createdAt: m.createdAt }));
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

  // Bot de carga/descarga (Fase 1): responde solo si la cuenta lo tiene PRENDIDO. Best-effort y
  // aislado: sin bot es no-op; un error del bot no afecta el envío del jugador.
  void runChatBot(req.accountId!, conv.id, req.chatPlayerId!, parsed.data.body).catch((e) => console.error("[chat-bot]", e instanceof Error ? e.message : String(e)));

  return res.status(201).json({ message: msg });
});

// GET /api/chat/me/popup — el popup/promo activo de la cuenta (o null). `version` = popupUpdatedAt,
// para que la PWA lo muestre una sola vez por versión.
chatPublicRouter.get("/me/popup", requireChatClient, async (req, res) => {
  // Sin línea de WhatsApp activa, la cuenta no muestra popup (mismo gate que las acciones del operador).
  if (!(await hasActiveWaLine(req.accountId!))) return res.json({ popup: null });
  const u = await prisma.user.findUnique({
    where: { id: req.accountId! },
    select: { popupActive: true, popupImageUrl: true, popupTitle: true, popupText: true, popupLink: true, popupFrom: true, popupUntil: true, popupUpdatedAt: true },
  });
  if (!u?.popupActive || (!u.popupImageUrl && !u.popupText)) return res.json({ popup: null });
  // Ventana de programación: fuera del rango [from, until] no se muestra.
  const now = new Date();
  if (u.popupFrom && now < u.popupFrom) return res.json({ popup: null });
  if (u.popupUntil && now > u.popupUntil) return res.json({ popup: null });
  return res.json({
    popup: {
      title: u.popupTitle,
      text: u.popupText,
      image: u.popupImageUrl,
      link: u.popupLink,
      version: u.popupUpdatedAt?.toISOString() ?? "",
    },
  });
});

// ============================ WEB PUSH (jugador) ============================

// GET /api/chat/push/public-key — clave pública VAPID para suscribirse desde la PWA. Pública.
chatPublicRouter.get("/push/public-key", (_req, res) => {
  return res.json({ key: pushEnabled() ? publicVapidKey() : null });
});

const subscribeSchema = z.object({
  endpoint: z.string().url().max(600),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
  userAgent: z.string().max(300).optional(),
});

// POST /api/chat/push/subscribe — registra/actualiza la suscripción del jugador (upsert por endpoint).
chatPublicRouter.post("/push/subscribe", requireChatClient, async (req, res) => {
  const parsed = subscribeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido" });
  if (!pushEnabled()) return res.status(503).json({ error: "Web Push no está configurado" });
  const { endpoint, keys, userAgent } = parsed.data;
  await prisma.chatPushSub.upsert({
    where: { userId_endpoint: { userId: req.accountId!, endpoint } },
    create: { userId: req.accountId!, playerId: req.chatPlayerId!, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent },
    update: { playerId: req.chatPlayerId!, p256dh: keys.p256dh, auth: keys.auth, userAgent },
  });
  return res.status(201).json({ ok: true });
});

// ============================ PÚBLICO (jugador) ============================

// GET /api/chat/branding/asset/:id — sirve una imagen de branding (logo / bienvenida). PÚBLICA:
// la cargan los <img> del panel y de la PWA. Cache largo (el id es aleatorio e inmutable).
chatPublicRouter.get("/branding/asset/:id", async (req, res) => {
  const asset = await prisma.brandingAsset.findUnique({
    where: { id: req.params.id },
    select: { contentType: true, data: true },
  });
  if (!asset) return res.status(404).json({ error: "No encontrado" });
  res.setHeader("Content-Type", asset.contentType);
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  return res.send(Buffer.from(asset.data));
});

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

  // Cerramos el link de forma ATÓMICA (single-use): solo seguimos si NOSOTROS lo cerramos
  // (count===1). Si otra request se lo llevó en paralelo (count===0), revertimos el player
  // recién creado y devolvemos 404 — así dos personas con el mismo link no crean dos jugadores.
  const closed = await prisma.inviteCode.updateMany({ where: { id: invite.id, isActive: true }, data: { isActive: false } });
  if (closed.count !== 1) {
    await prisma.chatPlayer.delete({ where: { id: player.id } }).catch(() => undefined);
    return res.status(404).json({ error: "Este link acaba de usarse. Pedí uno nuevo o iniciá sesión." });
  }

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
  accountSlug: z.string().max(60).optional(), // opcional: la app instalada abre sin el ?a=
  username: z.string().min(2).max(40),
  password: z.string().max(60).optional(),
});

// POST /api/chat/login — ingreso del jugador. Si tiene clave seteada (accesos nuevos) se verifica;
// los viejos passwordless entran sin clave. GATEADO por días: sin línea de WhatsApp vigente, apagado.
//
// La cuenta se resuelve así:
//  - con `accountSlug` (link ?a= o cuenta guardada): por slug, como siempre.
//  - SIN slug (app instalada, que abre sin el ?a=): por el usuario. Buscamos jugadores con ese
//    usuario y clave; si hay UNO solo, esa es la cuenta (así con usuario+clave alcanza y el jugador
//    NO tiene que escribir el nombre de la cuenta). Si hay varios, pedimos la cuenta (account_required).
chatPublicRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido" });
  const username = parsed.data.username.trim();
  const slug = parsed.data.accountSlug?.trim();

  let player: { id: string; casinoUsername: string; password: string | null; userId: string } | null = null;
  let accId: string | null = null;

  if (slug) {
    const acc = await prisma.user.findUnique({ where: { slug }, select: { id: true } });
    if (!acc) return res.status(404).json({ error: "Cuenta no encontrada", code: "account_required" });
    accId = acc.id;
    player = await prisma.chatPlayer.findUnique({
      where: { userId_casinoUsername: { userId: acc.id, casinoUsername: username } },
      select: { id: true, casinoUsername: true, password: true, userId: true },
    });
  } else {
    // Sin slug: resolvemos por usuario (jugadores con clave = accesos nuevos).
    const matches = await prisma.chatPlayer.findMany({
      where: { casinoUsername: username, password: { not: null } },
      select: { id: true, casinoUsername: true, password: true, userId: true },
      take: 5,
    });
    if (matches.length === 1) { player = matches[0]; accId = matches[0].userId; }
    else if (matches.length > 1) {
      return res.status(409).json({ error: "Necesitamos el nombre de la cuenta.", code: "account_required" });
    }
    // 0 matches -> cae al "usuario no encontrado" de abajo.
  }

  if (!player || !accId) return res.status(404).json({ error: "No encontramos ese usuario. Pedile el acceso a quien te invitó." });
  // Clave: si el acceso tiene clave, se verifica; si no (jugador viejo), entra sin clave.
  if (player.password) {
    const ok = parsed.data.password ? await verifyPassword(parsed.data.password, player.password) : false;
    if (!ok) return res.status(401).json({ error: "Usuario o clave incorrectos." });
  }
  // Candado de días: sin día de WhatsApp vigente el chat está apagado.
  if (!(await hasActiveWaLine(accId))) {
    return res.status(403).json({ error: "El chat no está disponible en este momento. Probá más tarde.", code: "line_required" });
  }
  const conv = await prisma.chatConversation.findFirst({ where: { userId: accId, playerId: player.id }, select: { id: true } });
  const acc = await prisma.user.findUnique({ where: { id: accId }, select: { slug: true } });
  const token = signChatClientToken(accId, player.id);
  // Devolvemos el slug: la app lo guarda para recordar la cuenta y mostrar el branding la próxima vez.
  return res.json({ token, player: { id: player.id, casinoUsername: player.casinoUsername }, conversationId: conv?.id ?? null, accountSlug: acc?.slug ?? null });
});

// GET /api/chat/public/:slug — branding + estado de una cuenta por su slug (público, para la
// entrada abierta desde una landing). `active=false` = la cuenta no tiene día de WhatsApp vigente
// -> el chat está apagado (no funciona hasta que recargue días).
chatPublicRouter.get("/public/:slug", async (req, res) => {
  const acc = await prisma.user.findUnique({
    where: { slug: req.params.slug },
    select: { id: true, slug: true, brandName: true, logoUrl: true, primaryColor: true, accentColor: true, welcomeText: true },
  });
  if (!acc) return res.status(404).json({ error: "Cuenta no encontrada" });
  return res.json({
    accountSlug: acc.slug,
    active: await hasActiveWaLine(acc.id),
    branding: {
      brandName: acc.brandName, logoUrl: acc.logoUrl,
      primaryColor: acc.primaryColor, accentColor: acc.accentColor, welcomeText: acc.welcomeText,
    },
  });
});

const startSchema = z.object({
  accountSlug: z.string().min(1).max(60),
  username: z.string().min(2).max(40),
  fbclid: z.string().max(400).optional(),
  fbp: z.string().max(200).optional(),
  fbc: z.string().max(200).optional(),
});

// POST /api/chat/start — entrada ABIERTA por cuenta (sin link de invitación): registra al jugador
// si es nuevo, o retoma su chat si ya existe (mismo criterio que /login). GATEADO por días: si la
// cuenta no tiene una línea de WhatsApp con día vigente, el chat NO funciona (403). Es lo que usa
// la landing pública que el cliente le pasa a sus clientes como refuerzo.
chatPublicRouter.post("/start", async (req, res) => {
  const parsed = startSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido", details: parsed.error.flatten() });
  const { accountSlug, username, fbclid, fbp, fbc } = parsed.data;

  const acc = await prisma.user.findUnique({
    where: { slug: accountSlug },
    select: { id: true, welcomeMsgText: true, welcomeMsgImage: true },
  });
  if (!acc) return res.status(404).json({ error: "Cuenta no encontrada" });
  // Candado de días: sin día de WhatsApp vigente el chat está apagado.
  if (!(await hasActiveWaLine(acc.id))) {
    return res.status(403).json({ error: "El chat no está disponible en este momento. Probá más tarde.", code: "line_required" });
  }

  // Entra si ya existe (retoma), o se registra si es nuevo.
  let player = await prisma.chatPlayer.findUnique({
    where: { userId_casinoUsername: { userId: acc.id, casinoUsername: username.trim() } },
    select: { id: true, casinoUsername: true },
  });
  let conversationId: string | null = null;

  if (player) {
    const conv = await prisma.chatConversation.findFirst({ where: { userId: acc.id, playerId: player.id }, select: { id: true } });
    conversationId = conv?.id ?? null;
  } else {
    player = await prisma.chatPlayer.create({
      data: { userId: acc.id, casinoUsername: username.trim(), estatus: "active" },
      select: { id: true, casinoUsername: true },
    });
    const conv = await prisma.chatConversation.create({
      data: { userId: acc.id, playerId: player.id, status: "open" },
      select: { id: true },
    });
    conversationId = conv.id;
    const welcomeBody = acc.welcomeMsgText?.trim();
    if (welcomeBody || acc.welcomeMsgImage) {
      await prisma.chatMessage.create({
        data: { userId: acc.id, conversationId: conv.id, senderType: "system", body: welcomeBody ?? null, metadata: acc.welcomeMsgImage ? { image: acc.welcomeMsgImage } : {} },
      });
      await prisma.chatConversation.update({
        where: { id: conv.id },
        data: { lastMessageAt: new Date(), lastMessagePreview: welcomeBody ?? "📷 Imagen", unreadPlayer: 1 },
      });
    }
    if (fbclid || fbc) void fireChatLead(acc.id, player.id, { fbclid, fbp, fbc });
  }

  const token = signChatClientToken(acc.id, player.id);
  return res.status(player ? 200 : 201).json({ token, player, conversationId });
});
