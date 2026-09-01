// Chat App (módulo AISLADO jugador↔cajero). Rutas /api/chat/*. NO comparte tablas con el
// Inbox de WhatsApp ni pasa por getEngine(). El operador es el User de la cuenta (requireAuth);
// el jugador entra passwordless por un link de invitación (JWT client).
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { signChatClientToken, requireChatClient, CHAT_CLIENT_COOKIE, extractChatClientToken } from "../middleware/requireChatClient.js";
import { hashPassword, verifyPassword, verifyToken } from "../lib/auth.js";
import { sendCapiEvent } from "../lib/meta-capi.js"; // reuso el CAPI existente, NO reimplemento
import { resolveUserPixel } from "../lib/pixel.js";
import { analyzeReceipt, aiEnabled } from "../lib/ai-receipt.js"; // lectura de comprobante con IA
import { emitChat, playerIsForeground } from "../lib/io.js";
import { postPlayerMilestone } from "../lib/chat-milestones.js";
import { pushBonusFor, pushOnMilestoneBody, appInstalledMilestoneBody } from "../lib/push-bonus.js";
import { pushEnabled, publicVapidKey, enqueuePlayerPush, enqueueAccountBroadcast, enqueueOperatorPush } from "../lib/chat-push.js";
import { s3Enabled } from "../lib/s3.js";
import { runChatBot } from "../lib/chat-bot.js";
import { forwardChatToBot } from "../lib/chat-bridge.js";
import { canOperateChat, consumeChatDayAndActivate, getAvailableDays } from "../lib/access.js";
import { creditDepositInCasino, debitWithdrawalInCasino, sendDepositIntent, casinoLiveForAccount, casinoCvuForAccount, ensureCasinoUser, casinoPlayerPassword } from "../lib/casino-cashier.js"; // puente casino (key por cuenta)
import { verifyPartnerSignature, isCallbackTimestampFresh } from "../lib/casino-callback.js"; // firma del callback (modelo B)
import { notify } from "../lib/notifications.js"; // aviso al operador (campana) ante montos ambiguos

// Router del OPERADOR (se monta bajo requireAuth): gestión de links de invitación.
export const chatRouter = Router();
// Router PÚBLICO (sin auth de operador): branding, registro y login del jugador.
export const chatPublicRouter = Router();

// Código de invitación: 8 chars base64url (crypto), único.
const newCode = () => crypto.randomBytes(6).toString("base64url"); // 6 bytes -> 8 chars

// Fase A (registro de un tap): el server genera un usuario único (apodo + dígitos) y una clave
// numérica corta. `crypto.randomInt` da aleatoriedad real; el @@unique(userId,casinoUsername)
// cubre choques (reintentamos con otros dígitos). Ej: "fede" -> "fede86686" + clave "412907".
const nickSlug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "").slice(0, 12);
const randDigits = (n: number) => { let s = ""; for (let i = 0; i < n; i++) s += crypto.randomInt(0, 10); return s; };
// Clave fija simple para los usuarios autogenerados (fácil de recordar, se muestra en "cuenta creada").
const PLAYER_PASSWORD = "123456";
// Clave para jugadores NUEVOS del Chat App de una cuenta: configurable por cuenta
// (User.chatPlayerPassword — ej. matias usa la política de su casino, "Hola1234");
// sin configurar, la histórica "123456". Los jugadores existentes conservan su hash.
async function playerPasswordFor(accountId: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: accountId }, select: { chatPlayerPassword: true } });
  return u?.chatPlayerPassword?.trim() || PLAYER_PASSWORD;
}

// Atribución de Meta al ALTA (el Chat App ES la landing de los anuncios): fbp/fbc/fbclid del clic
// + IP y user-agent reales del visitante. Se guarda en el ChatPlayer y la reusa el Purchase del
// puente (external_id + fbp/fbc + IP/UA = mejor Event Match Quality). La IP viene del proxy.
function chatAttribution(
  req: { headers: Record<string, unknown>; socket: { remoteAddress?: string | null } },
  at: { fbclid?: string; fbp?: string; fbc?: string },
) {
  const fwd = typeof req.headers["x-forwarded-for"] === "string" ? (req.headers["x-forwarded-for"] as string) : "";
  return {
    fbp: at.fbp ?? null,
    fbc: at.fbc ?? (at.fbclid ? `fb.1.${Date.now()}.${at.fbclid}` : null),
    fbclid: at.fbclid ?? null,
    clientIp: fwd.split(",")[0].trim() || req.socket.remoteAddress || null,
    userAgent: typeof req.headers["user-agent"] === "string" ? (req.headers["user-agent"] as string).slice(0, 400) : null,
  };
}

// Cookie httpOnly de larga duración con el token del jugador, ADEMÁS del Bearer en localStorage. Es lo
// que evita perder la sesión (y duplicar la cuenta de ganamos) cuando el navegador borra el localStorage
// (Safari ITP a los 7 días, incógnito, limpiar datos). SameSite=lax: chat.publi.lat y app.publi.lat son
// el MISMO site (publi.lat), así que la cookie viaja en las llamadas de la PWA (con withCredentials).
function setChatCookie(res: Response, token: string): void {
  res.cookie(CHAT_CLIENT_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 90 * 24 * 60 * 60 * 1000, // 90 días (igual que el JWT), se renueva en cada /session
    path: "/",
  });
}

// ---- SKINS de marca: 2ª piel visual de la MISMA cuenta (mismo inbox/bot/cajero, otro look) ----
// Un slug de entrada del jugador puede ser la cuenta (User.slug) o una skin (ChatSkin.slug). El
// resolver es la ÚNICA puerta: /public, /start, /direct y /login pasan por acá, así el link de la
// skin se comporta idéntico al principal. El jugador creado por una skin queda marcado (skinId) y
// su marca lo sigue (branding, manifest, sesión recuperada, login).
type EntrySkin = {
  id: string; slug: string; brandName: string | null; logoUrl: string | null;
  primaryColor: string | null; accentColor: string | null; chatTheme: string;
  welcomeText: string | null; welcomeMsgText: string | null; chatDirectWelcome: string | null;
  chatPlatformUrl: string | null; chatNotifTitle: string | null; chatNotifText: string | null;
};
async function resolveEntrySlug(slug: string): Promise<{ accountId: string; skin: EntrySkin | null } | null> {
  const acc = await prisma.user.findUnique({ where: { slug }, select: { id: true } });
  if (acc) return { accountId: acc.id, skin: null };
  const skin = await prisma.chatSkin.findUnique({ where: { slug } });
  if (skin) return { accountId: skin.userId, skin };
  return null;
}

// ¿La cuenta tiene al menos una línea de WhatsApp con un DÍA PAGADO VIGENTE (expiresAt futuro)?
// El Chat App se vende junto con el servicio de líneas. Gateamos por el día pagado y NO por
// status/connected a propósito: el `status` sigue a la conexión (webhook.ts pone active/inactive
// según connected), así que una desconexión momentánea de WhatsApp NO debe apagar el Chat App de
// alguien que pagó. Cuando el día vence, line-expiry deja expiresAt en el pasado -> se corta solo.
// canOperateChat (lib/access) además prende el chat con un "día de Chat App" propio (sin WhatsApp).

// Gate para las acciones SALIENTES del Chat App (responder, notificar, popup): requieren una línea
// de WhatsApp activa. Sin ella respondemos 403 con un mensaje claro para que el panel lo muestre.
// El branding, los invites y la lectura NO se gatean (el operador puede seguir viendo/configurando).
async function requireActiveLine(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (await canOperateChat(req.userId!)) return next();
  res.status(403).json({
    error: "Necesitás una línea de WhatsApp activa (con días) para responder, notificar o mostrar popups en el Chat App. Recargá días y activá una línea.",
    code: "line_required",
  });
}

// GET /api/chat/status — el panel consulta si puede operar (línea WhatsApp activa O día de Chat App).
chatRouter.get("/status", async (req, res) => {
  res.json({ activeLine: await canOperateChat(req.userId!) });
});

// GET /api/chat/day — estado del "día de Chat App" (canal propio sin WhatsApp) para el panel.
chatRouter.get("/day", async (req, res) => {
  const [u, availableDays] = await Promise.all([
    prisma.user.findUnique({ where: { id: req.userId! }, select: { chatDayEnabled: true, chatDayExpiresAt: true } }),
    getAvailableDays(req.userId!),
  ]);
  const waActive = (await prisma.waLine.count({ where: { userId: req.userId!, expiresAt: { gt: new Date() } } })) > 0;
  res.json({
    enabled: !!u?.chatDayEnabled,
    expiresAt: u?.chatDayExpiresAt ?? null,
    active: !!(u?.chatDayExpiresAt && u.chatDayExpiresAt > new Date()),
    availableDays,
    waActive, // si hay WhatsApp con día vigente, el chat ya está cubierto (no gasta día propio)
  });
});

const chatDaySchema = z.object({ enabled: z.boolean() });

// POST /api/chat/day — prende/apaga el "día de Chat App". Al prender consume 1 día del saldo y
// activa 24h (si no hay saldo devuelve error). Al apagar, deja de renovar (el día en curso corre).
chatRouter.post("/day", async (req, res) => {
  const parsed = chatDaySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido" });
  await prisma.user.update({ where: { id: req.userId! }, data: { chatDayEnabled: parsed.data.enabled } });
  if (parsed.data.enabled) {
    const ok = await consumeChatDayAndActivate(req.userId!);
    if (!ok) {
      await prisma.user.update({ where: { id: req.userId! }, data: { chatDayEnabled: false } });
      return res.status(402).json({ error: "No te quedan días. Recargá días para usar el Chat App.", code: "no_credit" });
    }
  }
  const u = await prisma.user.findUnique({ where: { id: req.userId! }, select: { chatDayEnabled: true, chatDayExpiresAt: true } });
  res.json({ enabled: !!u?.chatDayEnabled, expiresAt: u?.chatDayExpiresAt ?? null, active: !!(u?.chatDayExpiresAt && u.chatDayExpiresAt > new Date()) });
});

// Clave por defecto de un acceso nuevo (el operador se la pasa al cliente; el cliente entra con eso).
const DEFAULT_CHAT_PASSWORD = "Hola123";
const accessSchema = z.object({
  username: z.string().trim().min(2).max(40),
  password: z.string().min(4).max(60).optional(),
});

// GET /api/chat/players — lista los jugadores/accesos de la cuenta, para verlos y gestionarlos
// desde el panel. Los que entran por la landing (auto-registro) NO aparecen en ningún lado hasta que
// chatean; acá se ven todos (con su usuario, nombre, estado y fecha).
chatRouter.get("/players", async (req, res) => {
  const players = await prisma.chatPlayer.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: { id: true, casinoUsername: true, nombre: true, estatus: true, createdAt: true },
  });
  return res.json({
    players: players.map((p) => ({ id: p.id, username: p.casinoUsername, name: p.nombre, estatus: p.estatus, createdAt: p.createdAt })),
  });
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

// Loguea un evento CAPI del Chat App en MetaEvent → se VE en el panel/Métricas (el Chat App usa
// ChatPlayer, no Contact, así que contactId queda null). status: sent / no_pixel / failed. Best-effort.
async function logChatMetaEvent(userId: string, eventName: string, pixelId: string | undefined, ok: boolean): Promise<void> {
  await prisma.metaEvent
    .create({ data: { userId, contactId: null, eventName, pixelId: pixelId ?? "", payload: {}, status: ok ? "sent" : pixelId ? "failed" : "no_pixel" } })
    .catch(() => undefined);
}

// Dispara el Lead por CAPI al registrarse un jugador que vino de un anuncio (fbclid).
// Reusa sendCapiEvent (lib/meta-capi.ts) — NO toca go.ts ni reimplementa la CAPI. Best-effort.
async function fireChatLead(userId: string, playerId: string, at: { fbclid?: string; fbp?: string; fbc?: string }) {
  const creds = await resolveUserPixel(userId, "Lead");
  if (!creds) { await logChatMetaEvent(userId, "Lead", undefined, false); return; } // sin pixel: log no_pixel, sin gastar CAPI
  try {
    const fbc = at.fbc ?? (at.fbclid ? `fb.1.${Date.now()}.${at.fbclid}` : undefined);
    await sendCapiEvent({
      eventName: "Lead",
      userId, // copia a los pixeles sombra del usuario (fan-out best-effort)
      externalId: playerId,       // id estable del jugador (mismo en un futuro Purchase -> match)
      eventId: playerId,
      fbp: at.fbp,
      fbc,
      actionSource: "chat",       // lead de conversación (canal chat), no web
      pixelId: creds.pixelId,
      capiToken: creds.capiToken,
    });
    await logChatMetaEvent(userId, "Lead", creds.pixelId, true);
  } catch (e) {
    await logChatMetaEvent(userId, "Lead", creds.pixelId, false);
    console.error("[chat] Lead CAPI falló:", e instanceof Error ? e.message : String(e));
  }
}

// Fase C — CompleteRegistration por CAPI al crearse la cuenta (registro de un tap). external_id =
// el USUARIO generado, MISMO id que usará el Purchase de la carga (Fase E) → Meta matchea registro
// con compra. `eventId` dedup con el pixel del navegador (que dispara la PWA con el mismo id).
// Recibe los creds ya resueltos (para no volver a pegarle a la DB). Best-effort.
async function fireChatRegistration(
  userId: string,
  creds: { pixelId: string; capiToken: string } | undefined,
  username: string,
  eventId: string,
  at: { fbclid?: string; fbp?: string; fbc?: string },
) {
  if (!creds) { await logChatMetaEvent(userId, "CompleteRegistration", undefined, false); return; } // sin pixel: log no_pixel
  try {
    const fbc = at.fbc ?? (at.fbclid ? `fb.1.${Date.now()}.${at.fbclid}` : undefined);
    await sendCapiEvent({
      eventName: "CompleteRegistration",
      userId, // copia a los pixeles sombra del usuario (fan-out best-effort)
      externalId: username,
      eventId,
      fbp: at.fbp,
      fbc,
      actionSource: "chat",
      pixelId: creds.pixelId,
      capiToken: creds.capiToken,
    });
    await logChatMetaEvent(userId, "CompleteRegistration", creds.pixelId, true);
  } catch (e) {
    await logChatMetaEvent(userId, "CompleteRegistration", creds.pixelId, false);
    console.error("[chat] CompleteRegistration CAPI falló:", e instanceof Error ? e.message : String(e));
  }
}

// Primer mensaje del chat al registrarse por un-tap: intro (welcomeText) + usuario + clave + botón a
// la plataforma. El `link` en metadata lo renderiza la PWA como botón. Configurable: welcomeMsgText +
// chatPlatformUrl. Crea el mensaje y actualiza la conversación (unread para el jugador).
async function postWelcomeCreds(userId: string, conversationId: string, intro: string | null, username: string, password: string | null, platformUrl: string | null) {
  const lines = [intro?.trim() || "¡Bienvenido/a! 🎉 Tu cuenta está lista.", "", `👤 Usuario: ${username}`];
  if (password) lines.push(`🔑 Clave: ${password}`);
  lines.push("", "📌 Guardá tu usuario y clave: son los que te dejan volver a entrar si cerrás la app.");
  const body = lines.join("\n");
  const copy = { label: "📋 Copiar usuario", value: username };
  const metadata: { copy: { label: string; value: string }; link?: { label: string; url: string } } =
    platformUrl ? { copy, link: { label: "🎮 Entrar a la plataforma", url: platformUrl } } : { copy };
  const msg = await prisma.chatMessage.create({ data: { userId, conversationId, senderType: "system", body, metadata }, select: { id: true, senderType: true, body: true, metadata: true, createdAt: true } });
  // unreadOperator: 1 -> el operador ve el cliente nuevo flagueado en la lista.
  await prisma.chatConversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date(), lastMessagePreview: body.slice(0, 120), unreadPlayer: 1, unreadOperator: { increment: 1 } } });
  // Aviso EN VIVO al operador: aparece la conversación nueva sin refrescar.
  const payload = { conversationId, message: { id: msg.id, senderType: msg.senderType, body: msg.body, image: null, buttons: null, link: (msg.metadata as { link?: { label: string; url: string } })?.link ?? null, copy, createdAt: msg.createdAt } };
  emitChat(`chat:${userId}`, "chat:message", payload);
}

// Bienvenida para cuentas MANUALES (chatManualAccount): el server NO muestra usuario/clave generados;
// el CAJERO crea la cuenta a mano en el chat. Postea la bienvenida y avisa al operador en vivo.
async function postManualWelcome(userId: string, conversationId: string, intro: string | null, image: string | null) {
  const body = intro?.trim() || "¡Bienvenido/a! 🙌 Escribinos por acá y te creamos tu cuenta para empezar a jugar.";
  const metadata = image ? { image } : {};
  const msg = await prisma.chatMessage.create({ data: { userId, conversationId, senderType: "system", body, metadata }, select: { id: true, senderType: true, body: true, metadata: true, createdAt: true } });
  await prisma.chatConversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date(), lastMessagePreview: body.slice(0, 120), unreadPlayer: 1, unreadOperator: { increment: 1 } } });
  const payload = { conversationId, message: { id: msg.id, senderType: msg.senderType, body: msg.body, image: image ?? null, buttons: null, link: null, copy: null, createdAt: msg.createdAt } };
  emitChat(`chat:${userId}`, "chat:message", payload);
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
      player: { select: { casinoUsername: true, nombre: true, alias: true, skin: { select: { brandName: true, slug: true } } } },
    },
  });
  return res.json({
    conversations: convs.map((c) => ({
      id: c.id,
      playerId: c.playerId,
      // Display: primero el alias del operador (agenda), después el nombre del jugador, después el user.
      player: c.player.alias || c.player.nombre || c.player.casinoUsername,
      alias: c.player.alias ?? null,
      // Skin de marca por la que entró (null = principal): el operador ve qué marca espera el jugador.
      marca: c.player.skin ? (c.player.skin.brandName ?? c.player.skin.slug) : null,
      username: c.player.casinoUsername,
      status: c.status,
      unread: c.unreadOperator,
      preview: c.lastMessagePreview ?? "",
      lastAt: (c.lastMessageAt ?? c.createdAt).toISOString(),
    })),
  });
});

// ============================ SKINS DE MARCA (operador) ============================
// CRUD de las "pieles" extra del Chat App: mismo inbox/bot/cajero, otro link + marca visual.
const SKIN_SLUG_RE = /^[a-z0-9][a-z0-9-]{2,39}$/;
const skinHex = z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish();
const skinSchema = z.object({
  slug: z.string().regex(SKIN_SLUG_RE, "Slug inválido (minúsculas, números y guiones, 3-40)").optional(),
  brandName: z.string().max(60).nullish(),
  logoUrl: z.string().url().max(600).nullish(),
  primaryColor: skinHex,
  accentColor: skinHex,
  chatTheme: z.enum(["whatsapp", "midnight", "redblack"]).optional(),
  welcomeText: z.string().max(300).nullish(),
  welcomeMsgText: z.string().max(1000).nullish(),
  chatDirectWelcome: z.string().max(1000).nullish(),
  chatPlatformUrl: z.string().max(300).nullish(),
  chatNotifTitle: z.string().max(60).nullish(),
  chatNotifText: z.string().max(200).nullish(),
});

// ¿El slug está libre? (no puede pisar el slug de NINGUNA cuenta ni de otra skin — son un namespace único).
async function skinSlugTaken(slug: string, exceptSkinId?: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { slug }, select: { id: true } });
  if (user) return true;
  const other = await prisma.chatSkin.findUnique({ where: { slug }, select: { id: true } });
  return Boolean(other && other.id !== exceptSkinId);
}

// GET /api/chat/skins — las skins de la cuenta (con el link de entrada listo para compartir).
chatRouter.get("/skins", async (req, res) => {
  const skins = await prisma.chatSkin.findMany({ where: { userId: req.userId! }, orderBy: { createdAt: "asc" } });
  const base = (process.env.CHAT_PWA_URL ?? "https://chat.publi.lat").replace(/\/$/, "");
  return res.json({ skins: skins.map((s) => ({ ...s, links: { directo: `${base}/c/${s.slug}`, registro: `${base}/r/${s.slug}` } })) });
});

// POST /api/chat/skins — crea una skin nueva (slug obligatorio y único global).
chatRouter.post("/skins", async (req, res) => {
  const parsed = skinSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido", details: parsed.error.flatten() });
  const slug = parsed.data.slug;
  if (!slug) return res.status(400).json({ error: "Falta el slug (el link de entrada de esta marca)." });
  if (await skinSlugTaken(slug)) return res.status(409).json({ error: "Ese slug ya está en uso. Probá con otro." });
  const { slug: _s, ...fields } = parsed.data;
  const skin = await prisma.chatSkin.create({ data: { userId: req.userId!, slug, ...fields } });
  return res.status(201).json({ skin });
});

// PATCH /api/chat/skins/:id — edita una skin (ownership por userId).
chatRouter.patch("/skins/:id", async (req, res) => {
  const parsed = skinSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido", details: parsed.error.flatten() });
  const skin = await prisma.chatSkin.findFirst({ where: { id: req.params.id, userId: req.userId! }, select: { id: true } });
  if (!skin) return res.status(404).json({ error: "Skin no encontrada" });
  if (parsed.data.slug && (await skinSlugTaken(parsed.data.slug, skin.id))) {
    return res.status(409).json({ error: "Ese slug ya está en uso. Probá con otro." });
  }
  const updated = await prisma.chatSkin.update({ where: { id: skin.id }, data: parsed.data });
  return res.json({ skin: updated });
});

// DELETE /api/chat/skins/:id — borra la skin; sus jugadores vuelven a la marca principal (skinId -> null).
chatRouter.delete("/skins/:id", async (req, res) => {
  const skin = await prisma.chatSkin.findFirst({ where: { id: req.params.id, userId: req.userId! }, select: { id: true } });
  if (!skin) return res.status(404).json({ error: "Skin no encontrada" });
  await prisma.chatSkin.delete({ where: { id: skin.id } });
  return res.json({ ok: true });
});

const playerAliasSchema = z.object({ alias: z.string().max(60).nullish() });

// PATCH /api/chat/players/:id/alias — el operador le pone un nombre propio al jugador ("agenda"),
// igual que el alias del Inbox de WhatsApp. SOLO visual: escribe ChatPlayer.alias, un campo aparte de
// `nombre` (que lo escribe el propio jugador) y de `casinoUsername` (que no se toca nunca). Vacío = borrar.
chatRouter.patch("/players/:id/alias", async (req, res) => {
  const parsed = playerAliasSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Alias inválido (máx. 60 caracteres)" });
  const player = await prisma.chatPlayer.findFirst({ where: { id: req.params.id, userId: req.userId! }, select: { id: true } });
  if (!player) return res.status(404).json({ error: "Jugador no encontrado" });
  const alias = parsed.data.alias?.trim() || null;
  await prisma.chatPlayer.update({ where: { id: player.id }, data: { alias } });
  return res.json({ ok: true, alias });
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

// POST /api/chat/conversations/:id/read — marca leída (unreadOperator=0) SIN traer el historial. La usa el
// panel cuando llega un mensaje a la conversación que el operador tiene ABIERTA, para que el contador no
// reviva (el jugador escribió, pero el operador lo está leyendo en vivo).
chatRouter.post("/conversations/:id/read", async (req, res) => {
  const upd = await prisma.chatConversation.updateMany({
    where: { id: req.params.id, userId: req.userId! },
    data: { unreadOperator: 0 },
  });
  if (upd.count === 0) return res.status(404).json({ error: "Conversación no encontrada" });
  return res.json({ ok: true });
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
  if (!(await playerIsForeground(req.userId!, conv.playerId))) {
    const preview = parsed.data.body.slice(0, 140);
    void enqueuePlayerPush(req.userId!, conv.playerId, { title: "Nuevo mensaje", body: preview, url: "/chat" })
      .catch((e) => console.error("[chat] push falló:", e instanceof Error ? e.message : String(e)));
  }
  return res.status(201).json({ message: msg });
});

// POST /api/chat/messages/image — el operador manda una FOTO al jugador (ej. el comprobante de un
// retiro). Ruta SEPARADA de /messages (texto) para no tocar ese flujo. Mismo mecanismo que las
// imágenes del jugador (/me/messages): dataURL guardado en metadata.image, límite 700 KB, emitido con
// `image` aplanado (lo lee el PWA) + `metadata` (lo lee el panel). senderType "operator".
const opImageSchema = z.object({
  conversationId: z.string().min(1),
  image: z.string().regex(/^data:image\/(png|jpeg|jpg|webp|gif);base64,/, "Imagen inválida"),
  body: z.string().max(4000).optional(),
});
chatRouter.post("/messages/image", requireActiveLine, async (req, res) => {
  const parsed = opImageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido" });
  const image = parsed.data.image;
  const bytes = Buffer.from(image.slice(image.indexOf(",") + 1), "base64");
  if (bytes.length > 2 * 1024 * 1024) return res.status(413).json({ error: "La imagen supera 2 MB. Sacá una foto más liviana." });
  const conv = await prisma.chatConversation.findFirst({
    where: { id: parsed.data.conversationId, userId: req.userId! },
    select: { id: true, playerId: true },
  });
  if (!conv) return res.status(404).json({ error: "Conversación no encontrada" });
  const body = parsed.data.body?.trim() || null;
  // Guardar la imagen como BrandingAsset (URL corta) en vez del data URL gigante: el data URL vive
  // dentro de metadata y, acumulado, infla el historial y TRABA la carga del chat. Igual que el
  // comprobante del jugador. Fallback: si falla el asset, dejamos el data URL (no se pierde la imagen).
  let imageRef = image;
  try {
    const contentType = image.slice(5, image.indexOf(";")); // "image/png" | "image/jpeg" | ...
    const asset = await prisma.brandingAsset.create({ data: { userId: req.userId!, contentType, data: bytes }, select: { id: true } });
    const base = (process.env.APP_BASE_URL ?? "http://localhost:4000").replace(/\/$/, "");
    imageRef = `${base}/api/chat/branding/asset/${asset.id}`;
  } catch (e) {
    console.error("[chat] guardar imagen del operador:", e instanceof Error ? e.message : String(e));
  }
  const msg = await prisma.chatMessage.create({
    data: { userId: req.userId!, conversationId: conv.id, senderType: "operator", senderId: req.userId!, body, metadata: { image: imageRef } },
    select: { id: true, senderType: true, body: true, metadata: true, createdAt: true },
  });
  await prisma.chatConversation.update({
    where: { id: conv.id },
    data: { lastMessageAt: new Date(), lastMessagePreview: "📷 " + (body ?? "Imagen").slice(0, 118), unreadPlayer: { increment: 1 } },
  });
  const outMsg = { id: msg.id, senderType: msg.senderType, body: msg.body, image: (msg.metadata as { image?: string })?.image ?? null, metadata: msg.metadata, createdAt: msg.createdAt };
  const payload = { conversationId: conv.id, message: outMsg };
  emitChat(`chat:${req.userId}:player:${conv.playerId}`, "chat:message", payload); // al jugador
  emitChat(`chat:${req.userId}`, "chat:message", payload);                          // al operador (otras pestañas)
  if (!(await playerIsForeground(req.userId!, conv.playerId))) {
    void enqueuePlayerPush(req.userId!, conv.playerId, { title: "Nuevo mensaje", body: "📷 Imagen", url: "/chat" })
      .catch((e) => console.error("[chat] push falló:", e instanceof Error ? e.message : String(e)));
  }
  return res.status(201).json({ message: outMsg });
});

// Textos por defecto de la secuencia de instalación (el operador puede editarlos en el panel).
const DEFAULT_INSTALL = {
  msg1: "¡Hola! 🎉 Ya tenemos tu carga. Para acreditártela necesitás instalar nuestra app.",
  msg2: "Instalá nuestra app para entrar más rápido y no perderte nada. Es un toque 👇",
  msg3: "Si no podés, decinos y te indicamos con dos fotitos cómo es, por favor 🙏",
  // Gate de retiro/bono: el operador lo manda cuando el jugador quiere retirar o pide el bono grande.
  bono: "🎁 Para retirar o recibir tu bono del 50% necesitás la app. Instalala acá 👇",
};
const installSendSchema = z.object({
  conversationId: z.string().min(1),
  which: z.enum(["sequence", "msg1", "msg2", "msg3", "bono", "tut_ios", "tut_android"]),
});

// Fotos de instalación EFECTIVAS de una cuenta: las propias si las cargó; si no, las del ADMIN (default
// global). Las instrucciones de iPhone/Android son GENÉRICAS → el admin las sube UNA sola vez en su panel
// (Marca) y TODAS las cuentas las heredan, sin recargarlas por cuenta. Cada cuenta puede igual subir las
// suyas para pisar el default. Resuelve iOS y Android por separado.
async function resolveInstallImages(userId: string): Promise<{ ios: string[]; android: string | null }> {
  const tutSelect = { chatTutIosImg: true, chatTutIosImg2: true, chatTutIosImg3: true, chatTutIosImg4: true, chatTutAndroidImg: true } as const;
  const pickIos = (u: { chatTutIosImg: string | null; chatTutIosImg2: string | null; chatTutIosImg3: string | null; chatTutIosImg4: string | null } | null) =>
    [u?.chatTutIosImg, u?.chatTutIosImg2, u?.chatTutIosImg3, u?.chatTutIosImg4].filter((x): x is string => Boolean(x && x.trim()));
  const own = await prisma.user.findUnique({ where: { id: userId }, select: tutSelect });
  const ownIos = pickIos(own);
  const ownAndroid = own?.chatTutAndroidImg?.trim() || null;
  if (ownIos.length > 0 && ownAndroid) return { ios: ownIos, android: ownAndroid };
  // Falta iOS o Android propio → heredamos del admin (el default global). El admin más viejo, determinístico.
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" }, select: tutSelect });
  return {
    ios: ownIos.length > 0 ? ownIos : pickIos(admin),
    android: ownAndroid ?? (admin?.chatTutAndroidImg?.trim() || null),
  };
}

// POST /api/chat/messages/install — el operador manda mensajes GUARDADOS de la secuencia de
// instalación (o una foto de tutorial). El msg2 lleva metadata.install -> botón "INSTALAR APP" en la PWA.
chatRouter.post("/messages/install", requireActiveLine, async (req, res) => {
  const parsed = installSendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido" });
  const conv = await prisma.chatConversation.findFirst({ where: { id: parsed.data.conversationId, userId: req.userId! }, select: { id: true, playerId: true } });
  if (!conv) return res.status(404).json({ error: "Conversación no encontrada" });
  const acc = await prisma.user.findUnique({ where: { id: req.userId! }, select: { chatInstallMsg1: true, chatInstallMsg2: true, chatInstallMsg3: true, chatTutIosImg: true, chatTutIosImg2: true, chatTutIosImg3: true, chatTutIosImg4: true, chatTutAndroidImg: true } });
  const m1 = acc?.chatInstallMsg1?.trim() || DEFAULT_INSTALL.msg1;
  const m2 = acc?.chatInstallMsg2?.trim() || DEFAULT_INSTALL.msg2;
  const m3 = acc?.chatInstallMsg3?.trim() || DEFAULT_INSTALL.msg3;

  const items: { body: string | null; metadata: Prisma.InputJsonObject }[] = [];
  switch (parsed.data.which) {
    case "sequence":
      items.push({ body: m1, metadata: {} }, { body: m2, metadata: { install: true } }, { body: m3, metadata: {} });
      break;
    case "msg1": items.push({ body: m1, metadata: {} }); break;
    case "msg2": items.push({ body: m2, metadata: { install: true } }); break;
    case "msg3": items.push({ body: m3, metadata: {} }); break;
    case "bono": items.push({ body: DEFAULT_INSTALL.bono, metadata: { install: true } }); break;
    case "tut_ios": {
      // Manda TODAS las fotos de iPhone (paso 1→4) en orden. Usa las de la cuenta o, si no cargó, las del
      // admin (default global) → funciona desde CUALQUIER panel sin recargarlas por cuenta.
      const { ios } = await resolveInstallImages(req.userId!);
      if (ios.length === 0) return res.status(400).json({ error: "Todavía no hay fotos de instalación de iPhone. Cargalas en tu panel (Marca) — o el admin las sube una vez y valen para todas las cuentas." });
      ios.forEach((img, i) => items.push({ body: i === 0 ? "📱 Cómo instalar en iPhone:" : `Paso ${i + 1}`, metadata: { image: img } }));
      break;
    }
    case "tut_android": {
      // Android instala de UN TOQUE con el botón "📲 Instalar la app" (prompt nativo de Chrome). Mandamos
      // instrucciones de TEXTO en vez de la vieja foto del método manual (3 puntos → "Agregar a pantalla
      // principal"), que ya no aplica con el botón de instalación directa.
      items.push({ body: "🤖 *Instalar en Android:*\n\n1) Tocá el botón morado 📲 *Instalar la app* (arriba de todo)\n2) En el cartel que abre Chrome, tocá *Instalar*\n3) ¡Listo! Te queda el ícono en la pantalla de inicio 🎉", metadata: {} });
      break;
    }
  }

  const out = [];
  for (const it of items) {
    const msg = await prisma.chatMessage.create({
      data: { userId: req.userId!, conversationId: conv.id, senderType: "operator", senderId: req.userId!, body: it.body, metadata: it.metadata },
      select: { id: true, senderType: true, body: true, metadata: true, createdAt: true },
    });
    const preview = (it.metadata.image ? "📷 " : "") + (it.body ?? "").slice(0, 110);
    await prisma.chatConversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date(), lastMessagePreview: preview, unreadPlayer: { increment: 1 } } });
    const outMsg = { id: msg.id, senderType: msg.senderType, body: msg.body, image: (msg.metadata as { image?: string })?.image ?? null, install: (msg.metadata as { install?: boolean })?.install ?? false, createdAt: msg.createdAt };
    const payload = { conversationId: conv.id, message: outMsg };
    emitChat(`chat:${req.userId}:player:${conv.playerId}`, "chat:message", payload);
    emitChat(`chat:${req.userId}`, "chat:message", payload);
    out.push(outMsg);
  }
  if (!(await playerIsForeground(req.userId!, conv.playerId))) {
    void enqueuePlayerPush(req.userId!, conv.playerId, { title: "Nuevo mensaje", body: (items[0]?.body ?? "Instalá la app").slice(0, 140), url: "/chat" }).catch(() => undefined);
  }
  return res.status(201).json({ messages: out });
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
const BRANDING_FIELDS = ["brandName", "logoUrl", "primaryColor", "accentColor", "chatTheme", "welcomeText", "welcomeMsgText", "welcomeMsgImage", "chatWaLink", "chatPlatformUrl", "chatPayCbu", "chatPayAlias", "chatPayTitular", "chatInstallMsg1", "chatInstallMsg2", "chatInstallMsg3", "chatTutIosImg", "chatTutIosImg2", "chatTutIosImg3", "chatTutIosImg4", "chatTutAndroidImg", "chatDirectWelcome", "chatInstallPromptEnabled", "chatNotifTitle", "chatNotifText"] as const;
// Select del branding del OPERADOR (incluye los campos de instalación; NO se exponen al jugador).
const BRANDING_SELECT = { slug: true, brandName: true, logoUrl: true, primaryColor: true, accentColor: true, chatTheme: true, welcomeText: true, welcomeMsgText: true, welcomeMsgImage: true, chatWaLink: true, chatPlatformUrl: true, chatPayCbu: true, chatPayAlias: true, chatPayTitular: true, chatInstallMsg1: true, chatInstallMsg2: true, chatInstallMsg3: true, chatTutIosImg: true, chatTutIosImg2: true, chatTutIosImg3: true, chatTutIosImg4: true, chatTutAndroidImg: true, chatDirectWelcome: true, chatInstallPromptEnabled: true, chatNotifTitle: true, chatNotifText: true, chatManualAccount: true } as const;

// GET /api/chat/branding — branding actual de la cuenta (para poblar el formulario del panel).
chatRouter.get("/branding", async (req, res) => {
  const acc = await prisma.user.findUnique({
    where: { id: req.userId! },
    select: BRANDING_SELECT,
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
  chatTheme: z.enum(["whatsapp", "midnight", "redblack"]).optional(),
  welcomeText: z.string().max(300).nullish(),
  welcomeMsgText: z.string().max(1000).nullish(),
  welcomeMsgImage: z.string().url().max(600).nullish(),
  chatWaLink: z.string().max(300).nullish(), // link o número de WhatsApp para el CTA del registro
  chatPlatformUrl: z.string().max(300).nullish(), // link a la plataforma de juego
  chatPayCbu: z.string().max(60).nullish(),
  chatPayAlias: z.string().max(60).nullish(),
  chatPayTitular: z.string().max(80).nullish(),
  chatInstallMsg1: z.string().max(1000).nullish(),
  chatInstallMsg2: z.string().max(1000).nullish(),
  chatInstallMsg3: z.string().max(1000).nullish(),
  chatTutIosImg: z.string().url().max(600).nullish(),
  chatTutIosImg2: z.string().url().max(600).nullish(),
  chatTutIosImg3: z.string().url().max(600).nullish(),
  chatTutIosImg4: z.string().url().max(600).nullish(),
  chatTutAndroidImg: z.string().url().max(600).nullish(),
  chatDirectWelcome: z.string().max(1000).nullish(),
  chatInstallPromptEnabled: z.boolean().optional(),
  chatNotifTitle: z.string().max(60).nullish(), // título del modal de notificaciones (branded)
  chatNotifText: z.string().max(200).nullish(), // bajada del modal de notificaciones (branded)
});

// PATCH /api/chat/branding — actualiza SOLO los campos de branding del User del token.
chatRouter.patch("/branding", async (req, res) => {
  const parsed = brandingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido", details: parsed.error.flatten() });
  // Whitelist estricta: sólo BRANDING_FIELDS que vinieron en el body (undefined = no tocar).
  const data: Record<string, string | null | boolean> = {};
  for (const k of BRANDING_FIELDS) {
    const v = (parsed.data as Record<string, unknown>)[k];
    if (v !== undefined) data[k] = (v as string | null | boolean);
  }
  if (Object.keys(data).length === 0) return res.status(400).json({ error: "Nada para actualizar" });
  const acc = await prisma.user.update({
    where: { id: req.userId! },
    data,
    select: BRANDING_SELECT,
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
  if (buffer.length > 2 * 1024 * 1024) return res.status(413).json({ error: "La imagen supera 2 MB. Comprimila o usá una más liviana." });

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

// GET /api/chat/bot — config actual del bot (operador) + el slug para armar el link de la landing.
chatRouter.get("/bot", async (req, res) => {
  const u = await prisma.user.findUnique({ where: { id: req.userId! }, select: { ...botSelect, slug: true } });
  return res.json({ bot: u ? { botEnabled: u.botEnabled, botPaymentInfo: u.botPaymentInfo, botWelcome: u.botWelcome } : null, slug: u?.slug ?? null });
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
  const messages = rows.map((m) => ({ id: m.id, senderType: m.senderType, body: m.body, image: (m.metadata as { image?: string })?.image ?? null, buttons: (m.metadata as { buttons?: string[] })?.buttons ?? null, link: (m.metadata as { link?: { label: string; url: string } })?.link ?? null, copy: (m.metadata as { copy?: { label: string; value: string } })?.copy ?? null, pay: (m.metadata as { pay?: { cbu: string | null; alias: string | null; titular: string | null } })?.pay ?? null, install: (m.metadata as { install?: boolean })?.install ?? false, createdAt: m.createdAt }));
  return res.json({ conversationId: conv.id, messages });
});

// POST /api/chat/me/deposit/help — el jugador toca CARGAR: dejamos en la conversación un mensaje
// (persistente, estilo mensajería) con los datos de pago. NO acredita nada. Dedup: si el último
// mensaje ya son las instrucciones, lo devolvemos sin repostear.
chatPublicRouter.post("/me/deposit/help", requireChatClient, async (req, res) => {
  const conv = await prisma.chatConversation.findFirst({ where: { userId: req.accountId!, playerId: req.chatPlayerId! }, select: { id: true } });
  if (!conv) return res.status(404).json({ error: "Conversación no encontrada" });
  const acc = await prisma.user.findUnique({ where: { id: req.accountId! }, select: { chatPayCbu: true, chatPayAlias: true, chatPayTitular: true, botPaymentInfo: true } });
  let pay = { cbu: acc?.chatPayCbu ?? null, alias: acc?.chatPayAlias ?? null, titular: acc?.chatPayTitular ?? null };
  let botInfo = acc?.botPaymentInfo ?? null;
  // MODELO B (auto-carga ganamos) — ANTES del dedup, así siempre trae el CVU fresco: damos de alta al
  // usuario en ganamos y mostramos el CVU de la recaudadora (endpoint /cvu, no los datos manuales). El
  // crédito lo dispara el comprobante que sube el jugador (→ intent → callback). Si el alta o el CVU
  // fallan, avisamos y NO lo mandamos a transferir a ciegas (cuenta muerta o sin usuario en ganamos).
  if (await casinoLiveForAccount(req.accountId!)) {
    const player = await prisma.chatPlayer.findUnique({ where: { id: req.chatPlayerId! }, select: { casinoUsername: true } });
    // Pre-alta en BACKGROUND: NO bloquea el CVU (se muestra al instante, no espera el alta ~4s ni un
    // cuelgue >30s del socio). El usuario casi siempre YA existe y sendDepositIntent lo re-registra al
    // subir el comprobante. Si el alta falla, avisa al operador (no corta al jugador). Bloqueamos SOLO si
    // el CVU falla (ahí no hay a dónde transferir).
    if (player?.casinoUsername) {
      const usr = player.casinoUsername;
      void ensureCasinoUser(req.accountId!, usr).then((u) => {
        if (!u.ok) void notify(req.accountId!, "system", "⚠️ Alta de casino lenta/falló", `El alta de ${usr} tardó o falló (${u.errorCode}). El CVU se mostró igual (el usuario suele ya existir); si esta carga no acredita sola, revisalo a mano.`).catch(() => undefined);
      }).catch(() => undefined);
    }
    const cvu = await casinoCvuForAccount(req.accountId!);
    if (!cvu.ok) {
      const errBody = "En este momento no podemos procesar cargas 😔. Probá de nuevo en unos minutos.";
      const em = await prisma.chatMessage.create({ data: { userId: req.accountId!, conversationId: conv.id, senderType: "system", body: errBody, metadata: { bot: true, alert: true } }, select: { id: true, senderType: true, body: true, createdAt: true } });
      await prisma.chatConversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date(), lastMessagePreview: errBody.slice(0, 120), unreadOperator: { increment: 1 } } });
      const eo = { id: em.id, senderType: em.senderType, body: em.body, image: null, buttons: null, link: null, pay: null, createdAt: em.createdAt };
      emitChat(`chat:${req.accountId}:player:${req.chatPlayerId}`, "chat:message", { conversationId: conv.id, message: eo });
      emitChat(`chat:${req.accountId}`, "chat:message", { conversationId: conv.id, message: eo });
      return res.json({ message: eo });
    }
    pay = { cbu: cvu.cvu ?? null, alias: cvu.alias ?? null, titular: cvu.titular ?? null };
    botInfo = null;
  }
  // Dedup: solo si el último mensaje ya tiene EXACTAMENTE estos datos de pago (mismo CVU/CBU + alias) no
  // reposteamos. Un "te pasamos los datos" viejo (sin CVU) NO bloquea mostrar el CVU nuevo.
  const last = await prisma.chatMessage.findFirst({ where: { conversationId: conv.id }, orderBy: { createdAt: "desc" }, select: { id: true, senderType: true, body: true, metadata: true, createdAt: true } });
  const lastPay = (last?.metadata as { pay?: { cbu: string | null; alias: string | null; titular: string | null } })?.pay;
  if (last && lastPay && lastPay.cbu === pay.cbu && lastPay.alias === pay.alias) {
    return res.json({ message: { id: last.id, senderType: last.senderType, body: last.body, image: null, buttons: null, link: null, pay: lastPay, createdAt: last.createdAt } });
  }
  const hasData = pay.cbu || pay.alias || pay.titular || botInfo;
  const body = hasData ? "Para cargar transferí a estos datos y subí el comprobante por favor 🙏" : "Para cargar, escribinos y te pasamos los datos 🙏";
  const metadata = { pay };
  const msg = await prisma.chatMessage.create({ data: { userId: req.accountId!, conversationId: conv.id, senderType: "system", body, metadata }, select: { id: true, senderType: true, body: true, createdAt: true } });
  await prisma.chatConversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date(), lastMessagePreview: body.slice(0, 120) } });
  const outMsg = { id: msg.id, senderType: msg.senderType, body: msg.body, image: null, buttons: null, link: null, pay, createdAt: msg.createdAt };
  const payload = { conversationId: conv.id, message: outMsg };
  emitChat(`chat:${req.accountId}:player:${req.chatPlayerId}`, "chat:message", payload);
  emitChat(`chat:${req.accountId}`, "chat:message", payload);
  return res.json({ message: outMsg });
});

const playerSendSchema = z.object({
  body: z.string().max(4000).optional(),
  image: z.string().regex(/^data:image\/(png|jpeg|jpg|webp|gif);base64,/, "Imagen inválida").optional(), // clip: comprobante/foto
}).refine((d) => (d.body && d.body.trim().length > 0) || d.image, { message: "Mensaje vacío" });

// POST /api/chat/me/messages — el jugador manda (texto y/o imagen del clip). Emite al operador por /chat.
chatPublicRouter.post("/me/messages", requireChatClient, async (req, res) => {
  const parsed = playerSendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido" });
  const conv = await prisma.chatConversation.findFirst({ where: { userId: req.accountId!, playerId: req.chatPlayerId! }, select: { id: true, botStep: true, botAmount: true } });
  if (!conv) return res.status(404).json({ error: "Conversación no encontrada" });

  const body = parsed.data.body?.trim() || null;
  const image = parsed.data.image;
  let comprobanteData: Buffer | null = null, comprobanteType: string | null = null;
  if (image) {
    comprobanteType = image.slice(5, image.indexOf(";"));
    comprobanteData = Buffer.from(image.slice(image.indexOf(",") + 1), "base64");
    if (comprobanteData.length > 2 * 1024 * 1024) return res.status(413).json({ error: "La imagen supera 2 MB. Sacá una foto más liviana." });
  }
  // La imagen se guarda como BrandingAsset (URL corta), NO como data URL dentro del mensaje: un data URL
  // (~950KB por foto) infla el row Y la respuesta de GET /messages → una conversación con varias fotos pesa
  // varios MB y el chat "no carga". La URL corta la sirve /branding/asset bajo demanda (mismo mecanismo que
  // los comprobantes del form). Best-effort: si el asset falla, no guardamos imagen rota.
  let imageUrl: string | null = null;
  if (image && comprobanteData && comprobanteType) {
    try {
      const asset = await prisma.brandingAsset.create({ data: { userId: req.accountId!, contentType: comprobanteType, data: comprobanteData }, select: { id: true } });
      const base = (process.env.APP_BASE_URL ?? "http://localhost:4000").replace(/\/$/, "");
      imageUrl = `${base}/api/chat/branding/asset/${asset.id}`;
    } catch (e) { console.error("[chat] guardar imagen del jugador:", e instanceof Error ? e.message : String(e)); }
  }
  const metadata = imageUrl ? { image: imageUrl } : {};
  const msg = await prisma.chatMessage.create({
    data: { userId: req.accountId!, conversationId: conv.id, senderType: "player", senderId: req.chatPlayerId!, body, metadata },
    select: { id: true, senderType: true, body: true, metadata: true, createdAt: true },
  });
  await prisma.chatConversation.update({
    where: { id: conv.id },
    data: { lastMessageAt: new Date(), lastMessagePreview: (image ? "📷 " : "") + (body ?? "Imagen").slice(0, 118), unreadOperator: { increment: 1 } },
  });

  // Payload con `image` aplanado (PWA) Y `metadata` (panel del cajero lee metadata.image) → la imagen que
  // manda el jugador aparece EN VIVO en el chat del cajero, no sólo al recargar.
  const outMsg = { id: msg.id, senderType: msg.senderType, body: msg.body, image: (msg.metadata as { image?: string })?.image ?? null, metadata: msg.metadata, createdAt: msg.createdAt };
  const payload = { conversationId: conv.id, message: outMsg };
  emitChat(`chat:${req.accountId}`, "chat:message", payload);                              // al operador
  emitChat(`chat:${req.accountId}:player:${req.chatPlayerId}`, "chat:message", payload);   // al jugador (otros dispositivos)
  // Push al OPERADOR (celu, panel cerrado): un jugador le escribió. Best-effort, no bloquea.
  void enqueueOperatorPush(req.accountId!, { title: "💬 Nuevo mensaje", body: (body ?? "📷 Imagen").slice(0, 140), url: "/chat" }).catch(() => undefined);

  // Puente al bot cajero EXTERNO (combatwin/mijoker): si la cuenta lo tiene prendido (o en sombra),
  // le forwardeamos el mensaje del jugador (texto o comprobante) con el payload sintético del puente.
  // Con el puente FULL el cajero nativo se bypassa (no corren dos bots); en SOMBRA todo sigue como hoy.
  const bridgeAcc = await prisma.user.findUnique({ where: { id: req.accountId! }, select: { chatBotBridge: true, chatBotBridgeShadow: true, chatPlayerPassword: true } });
  const bridgeOn = !!bridgeAcc?.chatBotBridge;
  if (bridgeOn || bridgeAcc?.chatBotBridgeShadow) {
    // El usuario que la app YA le mostró al jugador viaja al bot: lo vincula/crea con ESE username
    // en la plataforma (un solo juego de credenciales, el bot lo reconoce como jugador existente).
    const pl = await prisma.chatPlayer.findUnique({ where: { id: req.chatPlayerId! }, select: { casinoUsername: true, nombre: true } });
    forwardChatToBot(req.accountId!, req.chatPlayerId!, {
      text: body,
      msgId: msg.id,
      chatUsername: pl?.casinoUsername ?? undefined,
      chatPassword: bridgeAcc?.chatPlayerPassword?.trim() || PLAYER_PASSWORD, // la clave que la app le mostró: el alta usa la misma
      pushName: pl?.nombre ?? undefined,
      mediaBase64: comprobanteData ? comprobanteData.toString("base64") : undefined,
      mediaMimetype: comprobanteType ?? undefined,
    });
  }

  // Si mandó una IMAGEN y la cuenta usa el cajero (bot prendido o casino en vivo): la leemos con IA y, si es
  // un comprobante, registramos la carga (pending) → aparece en la pestaña Cajero + dispara Purchase/intent.
  // NO acredita fichas (§9.2). Si lo tomó como comprobante, cerramos el paso del bot y no re-preguntamos.
  // Con el puente FULL el comprobante lo procesa el bot externo (OCR + carga en el casino real).
  if (comprobanteData && !bridgeOn) {
    const acc = await prisma.user.findUnique({ where: { id: req.accountId! }, select: { botEnabled: true } });
    const cashierOn = acc?.botEnabled || (await casinoLiveForAccount(req.accountId!));
    if (cashierOn && (await handlePlayerComprobante(req.accountId!, req.chatPlayerId!, comprobanteType ?? "image/jpeg", comprobanteData, conv.botAmount ?? null))) {
      if (conv.botStep === "carga_pago" || conv.botStep === "carga_monto") {
        await prisma.chatConversation.update({ where: { id: conv.id }, data: { botStep: null, botAmount: null } });
      }
      return res.status(201).json({ message: outMsg });
    }
  }

  // Bot de carga/descarga (Fase 1): responde solo si la cuenta lo tiene PRENDIDO. Best-effort y
  // aislado: sin bot es no-op; un error del bot no afecta el envío del jugador.
  // Con el puente al bot externo FULL, el bot nativo NO corre (atiende el externo).
  if (!bridgeOn) void runChatBot(req.accountId!, conv.id, req.chatPlayerId!, body ?? "").catch((e) => console.error("[chat-bot]", e instanceof Error ? e.message : String(e)));

  return res.status(201).json({ message: outMsg });
});

// GET /api/chat/me/popup — el popup/promo activo de la cuenta (o null). `version` = popupUpdatedAt,
// para que la PWA lo muestre una sola vez por versión.
chatPublicRouter.get("/me/popup", requireChatClient, async (req, res) => {
  // Sin línea de WhatsApp activa, la cuenta no muestra popup (mismo gate que las acciones del operador).
  if (!(await canOperateChat(req.accountId!))) return res.json({ popup: null });
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
  // Hito visible para el operador (una sola vez por jugador, dedupeado en el helper).
  // Redacción neutra (el chip lo ven jugador Y operador) + bono del piloto si la cuenta lo tiene.
  void (async () => {
    const acc = await prisma.user.findUnique({ where: { id: req.accountId! }, select: { slug: true } }).catch(() => null);
    await postPlayerMilestone(req.accountId!, req.chatPlayerId!, "push_on", pushOnMilestoneBody(pushBonusFor(acc?.slug ?? "")));
  })();
  return res.status(201).json({ ok: true });
});

// POST /api/chat/app-installed — la PWA avisa que el jugador INSTALÓ la app (appinstalled en
// Android; primer arranque standalone en iOS, que no dispara appinstalled). Hito visible para el
// operador en el hilo; dedupeado por jugador en el helper, así que repetir el POST es inocuo.
chatPublicRouter.post("/app-installed", requireChatClient, async (req, res) => {
  void postPlayerMilestone(req.accountId!, req.chatPlayerId!, "app_installed", appInstalledMilestoneBody());
  return res.json({ ok: true });
});

// POST /api/chat/operator/push/subscribe — suscripción push del OPERADOR (panel). playerId=null lo distingue
// del jugador. Le suena en el celu aunque tenga el panel CERRADO cuando un jugador le escribe/carga.
chatRouter.post("/operator/push/subscribe", async (req, res) => {
  const parsed = subscribeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido" });
  if (!pushEnabled()) return res.status(503).json({ error: "Web Push no está configurado" });
  const { endpoint, keys, userAgent } = parsed.data;
  await prisma.chatPushSub.upsert({
    where: { userId_endpoint: { userId: req.userId!, endpoint } },
    create: { userId: req.userId!, playerId: null, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent },
    update: { playerId: null, p256dh: keys.p256dh, auth: keys.auth, userAgent },
  });
  return res.status(201).json({ ok: true });
});

// ============================ PÚBLICO (jugador) ============================

// GET /api/chat/manifest — manifest PWA DINÁMICO por sesión. El chat-pwa lo proxea same-origin en
// /session-manifest?t=<token>&s=<slug>. El start_url incluye la sesión, así la app instalada en
// iPhone (storage aislado de Safari) abre YA logueada (iOS usa el start_url del manifest para lanzar).
chatPublicRouter.get("/manifest", async (req, res) => {
  const t = typeof req.query.t === "string" ? req.query.t : "";
  const s = typeof req.query.s === "string" ? req.query.s : "";
  let name = "Chat";
  if (s) {
    // El slug puede ser una SKIN: la app instalada toma el nombre de ESA marca.
    const acc = await prisma.user.findFirst({ where: { slug: s }, select: { brandName: true } }).catch(() => null);
    if (acc?.brandName) name = acc.brandName;
    else {
      const skin = await prisma.chatSkin.findUnique({ where: { slug: s }, select: { brandName: true, user: { select: { brandName: true } } } }).catch(() => null);
      if (skin) name = skin.brandName ?? skin.user.brandName ?? name;
    }
  }
  const qs = new URLSearchParams();
  if (t) qs.set("t", t);
  if (s) qs.set("s", s);
  const startUrl = qs.toString() ? `/chat?${qs.toString()}` : "/chat";
  res.type("application/manifest+json");
  res.set("Cache-Control", "no-store");
  return res.json({
    name, short_name: name, display: "standalone",
    start_url: startUrl, scope: "/",
    theme_color: "#0b141a", background_color: "#0b141a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  });
});

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
  // La PWA (chat.publi.lat) carga el logo desde app.publi.lat = CROSS-ORIGIN. Sin esto, el default de
  // helmet (Cross-Origin-Resource-Policy: same-origin) BLOQUEA la imagen y el logo no aparece. Es un
  // asset público (logo/branding), así que se permite embeder desde cualquier origen.
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  return res.send(Buffer.from(asset.data));
});

// GET /api/chat/branding/:code — marca de la cuenta para pintar la PWA. Devuelve el branding
// aunque el link ya se haya usado (para mostrar la marca); `codeActive` dice si aún se puede registrar.
chatPublicRouter.get("/branding/:code", async (req, res) => {
  const invite = await prisma.inviteCode.findUnique({ where: { code: req.params.code } });
  if (!invite) return res.status(404).json({ error: "Link inválido" });
  const acc = await prisma.user.findUnique({
    where: { id: invite.userId },
    select: { slug: true, brandName: true, logoUrl: true, primaryColor: true, accentColor: true, chatTheme: true, welcomeText: true, chatWaLink: true, chatPlatformUrl: true, chatNotifTitle: true, chatNotifText: true },
  });
  if (!acc) return res.status(404).json({ error: "Cuenta no encontrada" });
  return res.json({
    accountSlug: acc.slug,
    codeActive: invite.isActive,
    branding: {
      brandName: acc.brandName,
      logoUrl: acc.logoUrl,
      chatTheme: acc.chatTheme,
      primaryColor: acc.primaryColor,
      accentColor: acc.accentColor,
      welcomeText: acc.welcomeText,
      chatWaLink: acc.chatWaLink, chatPlatformUrl: acc.chatPlatformUrl,
      chatNotifTitle: acc.chatNotifTitle, chatNotifText: acc.chatNotifText,
    },
  });
});

const registerSchema = z.object({
  code: z.string().min(4).max(40),
  username: z.string().min(2).max(40).optional(),  // modo clásico: usuario elegido (passwordless)
  nickname: z.string().max(40).optional(),         // modo un-tap: nombre visible (semilla del usuario)
  autogenerate: z.boolean().optional(),            // true = el server genera usuario + clave
  fbclid: z.string().max(400).optional(),
  fbp: z.string().max(200).optional(),
  fbc: z.string().max(200).optional(),
});

// POST /api/chat/register — registro por link single-use. Dos modos:
//  - clásico: `username` elegido, passwordless (login sin clave). Como siempre.
//  - un-tap (autogenerate:true): el server genera usuario (apodo + dígitos) y una clave numérica,
//    los guarda y los DEVUELVE para mostrarlos ("¡Cuenta creada!"). Reintenta si el usuario choca.
chatPublicRouter.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido", details: parsed.error.flatten() });
  const { code, autogenerate, fbclid, fbp, fbc } = parsed.data;

  const invite = await prisma.inviteCode.findUnique({ where: { code } });
  if (!invite || !invite.isActive) {
    // Link inexistente o YA USADO (single-use). El 2º registro con el mismo link cae acá -> 404.
    return res.status(404).json({ error: "Este link ya no está disponible. Pedí uno nuevo o iniciá sesión." });
  }

  // Crear el jugador PRIMERO (así, si el usuario está tomado, el link NO se cierra y puede
  // reintentar). El unique (userId, casinoUsername) + P2002 cubre la carrera.
  let player: { id: string; casinoUsername: string } | undefined;
  let plainPassword: string | null = null;

  if (autogenerate) {
    const base = nickSlug(parsed.data.nickname ?? "") || "user";
    const nombre = (parsed.data.nickname ?? "").trim() || null;
    plainPassword = await playerPasswordFor(invite.userId);
    const hash = await hashPassword(plainPassword);
    for (let i = 0; i < 8 && !player; i++) {
      try {
        player = await prisma.chatPlayer.create({
          data: {
            userId: invite.userId,
            casinoUsername: `${base}${randDigits(5)}`,
            password: hash,
            nombre,
            invitedByUserId: invite.operatorId,
            inviteCodeId: invite.id,
            estatus: "active",
            ...chatAttribution(req, { fbclid, fbp, fbc }),
          },
          select: { id: true, casinoUsername: true },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue; // usuario chocó -> reintenta
        throw e;
      }
    }
    if (!player) return res.status(500).json({ error: "No se pudo generar tu usuario, probá de nuevo." });
  } else {
    const username = (parsed.data.username ?? "").trim();
    if (username.length < 2) return res.status(400).json({ error: "Elegí un usuario." });
    try {
      player = await prisma.chatPlayer.create({
        data: { userId: invite.userId, casinoUsername: username, invitedByUserId: invite.operatorId, inviteCodeId: invite.id },
        select: { id: true, casinoUsername: true },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return res.status(409).json({ error: "Ese usuario ya está registrado. Elegí otro o iniciá sesión.", code: "USERNAME_TAKEN" });
      }
      throw e;
    }
  }

  // Cerramos el link de forma ATÓMICA (single-use): solo seguimos si NOSOTROS lo cerramos
  // (count===1). Si otra request se lo llevó en paralelo (count===0), revertimos el player
  // recién creado y devolvemos 404 — así dos personas con el mismo link no crean dos jugadores.
  const closed = await prisma.inviteCode.updateMany({ where: { id: invite.id, isActive: true }, data: { isActive: false } });
  if (closed.count !== 1) {
    await prisma.chatPlayer.delete({ where: { id: player.id } }).catch(() => undefined);
    return res.status(404).json({ error: "Este link acaba de usarse. Pedí uno nuevo o iniciá sesión." });
  }

  // Abrir la conversación asignada al operador del link + primer mensaje.
  const acc = await prisma.user.findUnique({
    where: { id: invite.userId },
    select: { welcomeMsgText: true, welcomeMsgImage: true, chatPlatformUrl: true },
  });
  const conv = await prisma.chatConversation.create({
    data: { userId: invite.userId, playerId: player.id, assignedOperatorId: invite.operatorId, status: "open" },
    select: { id: true },
  });
  if (autogenerate) {
    // Un-tap: primer mensaje = usuario + clave + botón a la plataforma.
    await postWelcomeCreds(invite.userId, conv.id, acc?.welcomeMsgText ?? null, player.casinoUsername, plainPassword, acc?.chatPlatformUrl ?? null);
  } else {
    const welcomeBody = acc?.welcomeMsgText?.trim();
    if (welcomeBody || acc?.welcomeMsgImage) {
      await prisma.chatMessage.create({
        data: { userId: invite.userId, conversationId: conv.id, senderType: "system", body: welcomeBody ?? null, metadata: acc?.welcomeMsgImage ? { image: acc.welcomeMsgImage } : {} },
      });
      await prisma.chatConversation.update({
        where: { id: conv.id },
        data: { lastMessageAt: new Date(), lastMessagePreview: welcomeBody ?? "📷 Imagen", unreadPlayer: 1 },
      });
    }
  }

  // CAPI del registro (best-effort, no bloquea). Un-tap: CompleteRegistration con external_id =
  // usuario (matchea el Purchase de la carga, Fase E). Clásico: Lead con external_id = playerId.
  let regPixel: string | null = null;
  let regEventId: string | null = null;
  if (autogenerate) {
    regEventId = `${player.casinoUsername}:register`;
    const creds = await resolveUserPixel(invite.userId, "CompleteRegistration");
    regPixel = creds?.pixelId ?? null;
    void fireChatRegistration(invite.userId, creds, player.casinoUsername, regEventId, { fbclid, fbp, fbc });
  } else if (fbclid || fbc) {
    void fireChatLead(invite.userId, player.id, { fbclid, fbp, fbc });
  }

  const token = signChatClientToken(invite.userId, player.id);
  setChatCookie(res, token); // sesión persistente (además del Bearer)
  // `password` + `username`: solo en modo un-tap. `pixel` + `eventId`: para que la PWA dispare el
  // MISMO evento por el pixel del navegador (dedup con la CAPI por eventId).
  return res.status(201).json({
    token, player, conversationId: conv.id,
    username: player.casinoUsername, password: plainPassword,
    pixel: regPixel, eventId: regEventId,
  });
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

  let player: { id: string; casinoUsername: string; password: string | null; userId: string; skin?: { slug: string } | null } | null = null;
  let accId: string | null = null;

  if (slug) {
    // El slug puede ser la cuenta o una SKIN de marca (misma cuenta por atrás).
    const entry = await resolveEntrySlug(slug);
    if (!entry) return res.status(404).json({ error: "Cuenta no encontrada", code: "account_required" });
    accId = entry.accountId;
    player = await prisma.chatPlayer.findUnique({
      where: { userId_casinoUsername: { userId: entry.accountId, casinoUsername: username } },
      select: { id: true, casinoUsername: true, password: true, userId: true, skin: { select: { slug: true } } },
    });
  } else {
    // Sin slug: resolvemos por usuario (jugadores con clave = accesos nuevos).
    const matches = await prisma.chatPlayer.findMany({
      where: { casinoUsername: username, password: { not: null } },
      select: { id: true, casinoUsername: true, password: true, userId: true, skin: { select: { slug: true } } },
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
  if (!(await canOperateChat(accId))) {
    return res.status(403).json({ error: "El chat no está disponible en este momento. Probá más tarde.", code: "line_required" });
  }
  const conv = await prisma.chatConversation.findFirst({ where: { userId: accId, playerId: player.id }, select: { id: true } });
  const acc = await prisma.user.findUnique({ where: { id: accId }, select: { slug: true } });
  const token = signChatClientToken(accId, player.id);
  setChatCookie(res, token); // sesión persistente (además del Bearer)
  // Devolvemos el slug: la app lo guarda para recordar la cuenta y mostrar el branding la próxima vez.
  // Jugador de una SKIN: devolvemos el slug de SU marca (no el principal) para que vea su piel.
  return res.json({ token, player: { id: player.id, casinoUsername: player.casinoUsername }, conversationId: conv?.id ?? null, accountSlug: player.skin?.slug ?? acc?.slug ?? null });
});

// GET /api/chat/public/:slug — branding + estado de una cuenta por su slug (público, para la
// entrada abierta desde una landing). `active=false` = la cuenta no tiene día de WhatsApp vigente
// -> el chat está apagado (no funciona hasta que recargue días).
chatPublicRouter.get("/public/:slug", async (req, res) => {
  // El branding se lee SIEMPRE fresco: sin esto el navegador podía servir una config vieja (logoUrl de
  // un asset ya borrado) y quedaba el logo roto hasta limpiar caché. La imagen en sí es immutable por id.
  res.set("Cache-Control", "no-store");
  // El slug puede ser la cuenta o una SKIN de marca: la skin pisa lo visual (skin.campo ?? cuenta.campo)
  // y devolvemos SU slug como accountSlug — así la PWA guarda/rehidrata la marca correcta y todos los
  // pasos siguientes (/start, /direct) viajan con el slug de la skin.
  const entry = await resolveEntrySlug(req.params.slug);
  if (!entry) return res.status(404).json({ error: "Cuenta no encontrada" });
  const acc = await prisma.user.findUnique({
    where: { id: entry.accountId },
    select: { id: true, slug: true, brandName: true, logoUrl: true, primaryColor: true, accentColor: true, chatTheme: true, welcomeText: true, chatWaLink: true, chatPlatformUrl: true, chatInstallPromptEnabled: true, chatNotifTitle: true, chatNotifText: true },
  });
  if (!acc) return res.status(404).json({ error: "Cuenta no encontrada" });
  const s = entry.skin;
  return res.json({
    accountSlug: s ? s.slug : acc.slug,
    active: await canOperateChat(acc.id),
    branding: {
      brandName: s?.brandName ?? acc.brandName, logoUrl: s?.logoUrl ?? acc.logoUrl, chatTheme: s?.chatTheme ?? acc.chatTheme,
      primaryColor: s?.primaryColor ?? acc.primaryColor, accentColor: s?.accentColor ?? acc.accentColor,
      welcomeText: s?.welcomeText ?? acc.welcomeText, chatWaLink: acc.chatWaLink, chatPlatformUrl: s?.chatPlatformUrl ?? acc.chatPlatformUrl,
      chatInstallPromptEnabled: acc.chatInstallPromptEnabled,
      chatNotifTitle: s?.chatNotifTitle ?? acc.chatNotifTitle, chatNotifText: s?.chatNotifText ?? acc.chatNotifText,
    },
  });
});

const startSchema = z.object({
  accountSlug: z.string().min(1).max(60),
  username: z.string().min(2).max(40).optional(),  // clásico: usuario elegido (retoma o crea)
  nickname: z.string().max(40).optional(),         // un-tap: semilla del usuario generado
  autogenerate: z.boolean().optional(),            // true = el server genera usuario + clave
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
  const { accountSlug, autogenerate, fbclid, fbp, fbc } = parsed.data;

  // El slug puede ser la cuenta o una SKIN: misma cuenta por atrás, textos visuales de la skin.
  const entry = await resolveEntrySlug(accountSlug.trim());
  if (!entry) return res.status(404).json({ error: "Cuenta no encontrada" });
  const skin = entry.skin;
  const acc = await prisma.user.findUnique({
    where: { id: entry.accountId },
    select: { id: true, welcomeMsgText: true, welcomeMsgImage: true, chatPlatformUrl: true, chatManualAccount: true },
  });
  if (!acc) return res.status(404).json({ error: "Cuenta no encontrada" });
  const welcomeMsgText = skin?.welcomeMsgText ?? acc.welcomeMsgText;
  const platformUrl = skin?.chatPlatformUrl ?? acc.chatPlatformUrl;
  // Candado de días: sin día de WhatsApp vigente el chat está apagado.
  if (!(await canOperateChat(acc.id))) {
    return res.status(403).json({ error: "El chat no está disponible en este momento. Probá más tarde.", code: "line_required" });
  }

  // --- Modo un-tap (landing del Chat App): el server genera usuario + clave y crea SIEMPRE un
  //     jugador nuevo. Reusa la misma lógica que /register autogenerate + CompleteRegistration. ---
  if (autogenerate) {
    const base = nickSlug(parsed.data.nickname ?? "") || "user";
    const nombre = (parsed.data.nickname ?? "").trim() || null;
    const plainPassword = await playerPasswordFor(acc.id);
    const hash = await hashPassword(plainPassword);
    let np: { id: string; casinoUsername: string } | undefined;
    for (let i = 0; i < 8 && !np; i++) {
      try {
        np = await prisma.chatPlayer.create({
          data: { userId: acc.id, skinId: skin?.id ?? null, casinoUsername: `${base}${randDigits(5)}`, password: hash, nombre, estatus: "active", ...chatAttribution(req, { fbclid, fbp, fbc }) },
          select: { id: true, casinoUsername: true },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
        throw e;
      }
    }
    if (!np) return res.status(500).json({ error: "No se pudo generar tu usuario, probá de nuevo." });
    const conv = await prisma.chatConversation.create({ data: { userId: acc.id, playerId: np.id, status: "open" }, select: { id: true } });
    // Cuenta MANUAL: NO mostramos usuario/clave (el cajero crea la cuenta a mano) → solo bienvenida.
    // Cuenta normal: primer mensaje = usuario + clave + botón a la plataforma.
    if (acc.chatManualAccount) {
      await postManualWelcome(acc.id, conv.id, welcomeMsgText ?? null, acc.welcomeMsgImage ?? null);
    } else {
      await postWelcomeCreds(acc.id, conv.id, welcomeMsgText ?? null, np.casinoUsername, plainPassword, platformUrl ?? null);
    }
    // El pixel (Lead+Registro) se dispara IGUAL en ambos modos: external_id = usuario interno del jugador.
    const eventId = `${np.casinoUsername}:register`;
    const creds = await resolveUserPixel(acc.id, "CompleteRegistration");
    void fireChatRegistration(acc.id, creds, np.casinoUsername, eventId, { fbclid, fbp, fbc });
    const token = signChatClientToken(acc.id, np.id);
    setChatCookie(res, token); // sesión persistente (además del Bearer)
    // username va SIEMPRE (es el external_id que el pixel del navegador usa para deduplicar con el CAPI);
    // en modo manual la PWA no lo muestra (salta la pantalla de creds y entra al chat). La clave sí se omite.
    return res.status(201).json({ token, player: np, conversationId: conv.id, manual: acc.chatManualAccount, username: np.casinoUsername, password: acc.chatManualAccount ? null : plainPassword, pixel: creds?.pixelId ?? null, eventId });
  }

  // --- Modo clásico (username explícito): retoma si existe, o crea si es nuevo. ---
  const username = (parsed.data.username ?? "").trim();
  if (username.length < 2) return res.status(400).json({ error: "Falta el usuario." });
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
      data: { userId: acc.id, skinId: skin?.id ?? null, casinoUsername: username.trim(), estatus: "active" },
      select: { id: true, casinoUsername: true },
    });
    const conv = await prisma.chatConversation.create({
      data: { userId: acc.id, playerId: player.id, status: "open" },
      select: { id: true },
    });
    conversationId = conv.id;
    const welcomeBody = welcomeMsgText?.trim();
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
  setChatCookie(res, token); // sesión persistente (además del Bearer)
  return res.status(player ? 200 : 201).json({ token, player, conversationId });
});

const DEFAULT_DIRECT_WELCOME = "¡Hola! 🎉 Bienvenido. Para empezar, decime tu nombre 👇";
const directSchema = z.object({
  accountSlug: z.string().min(1).max(60),
  // Nombre/apodo del gate de entrada (PWA): con él, el username sale del nombre (no más web*
  // fantasma) y el bot del puente atiende sin re-preguntar el nombre.
  nickname: z.string().max(40).optional(),
  // Identificadores del clic de Meta (los reenvía la landing por la URL): aunque el chat directo es
  // anónimo, con esto disparamos el Registro al pixel y el loop de atribución cierra igual.
  fbclid: z.string().max(400).optional(),
  fbp: z.string().max(200).optional(),
  fbc: z.string().max(200).optional(),
});

// POST /api/chat/direct — CHAT DIRECTO (3ª opción de entrada, SIN registro): el jugador cae derecho
// en el chat. Crea un jugador anónimo (usuario + clave autogenerados por atrás, para que la carga al
// casino funcione después) y abre la conversación con el PRIMER MENSAJE nuestro (configurable:
// chatDirectWelcome) que le pide el nombre. Marca la conversación con botStep="ask_name": el primer
// mensaje del jugador se guarda como su nombre (lo hace runChatBot, aun con el bot general apagado).
// Los botones de cargar/retirar salen solos en la app (barra del cajero). GATEADO por días.
chatPublicRouter.post("/direct", async (req, res) => {
  const parsed = directSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido" });
  const { fbclid, fbp, fbc } = parsed.data;
  const nombreGate = (parsed.data.nickname ?? "").trim() || null; // nombre del gate de entrada (PWA)
  // El slug puede ser la cuenta o una SKIN (mismo inbox, otra marca): la bienvenida sale de la skin.
  const entry = await resolveEntrySlug(parsed.data.accountSlug.trim());
  if (!entry) return res.status(404).json({ error: "Cuenta no encontrada" });
  const skin = entry.skin;
  const acc = await prisma.user.findUnique({
    where: { id: entry.accountId },
    select: { id: true, chatDirectWelcome: true },
  });
  if (!acc) return res.status(404).json({ error: "Cuenta no encontrada" });
  if (!(await canOperateChat(acc.id))) {
    return res.status(403).json({ error: "El chat no está disponible en este momento. Probá más tarde.", code: "line_required" });
  }

  const plainPassword = await playerPasswordFor(acc.id);
  const hash = await hashPassword(plainPassword);
  let np: { id: string; casinoUsername: string } | undefined;
  for (let i = 0; i < 8 && !np; i++) {
    try {
      // Con nombre del gate: username REAL a partir del nombre (nickSlug+dígitos, como /start) — el
      // bot del puente lo crea/vincula directo. Sin nombre (flujo viejo): web<dígitos> provisional.
      np = await prisma.chatPlayer.create({
        data: {
          userId: acc.id, skinId: skin?.id ?? null,
          casinoUsername: nombreGate ? `${nickSlug(nombreGate) || "user"}${randDigits(5)}` : `web${randDigits(6)}`,
          nombre: nombreGate,
          password: hash, estatus: "active", ...chatAttribution(req, { fbclid, fbp, fbc }),
        },
        select: { id: true, casinoUsername: true },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue; // usuario chocó -> reintenta
      throw e;
    }
  }
  if (!np) return res.status(500).json({ error: "No se pudo iniciar el chat, probá de nuevo." });

  const conv = await prisma.chatConversation.create({
    // Con nombre del gate no hay que preguntarlo de nuevo (botStep ask_name era para eso).
    data: { userId: acc.id, playerId: np.id, status: "open", botStep: nombreGate ? null : "ask_name" },
    select: { id: true },
  });
  // Con nombre del gate + puente al bot PRENDIDO: la cuenta del casino se crea YA (no se espera
  // al primer mensaje) — se dispara un forward sintético al bot, que hace el alta y postea el
  // bloque completo (usuario/clave/bono/CBU) como primer mensaje. El welcome local es un puente
  // corto por si el alta tarda unos segundos. Sin puente (o sin nombre): comportamiento de antes.
  const bridgeOnDirect = nombreGate
    ? !!(await prisma.user.findUnique({ where: { id: acc.id }, select: { chatBotBridge: true } }))?.chatBotBridge
    : false;
  if (bridgeOnDirect && nombreGate) {
    forwardChatToBot(acc.id, np.id, { text: nombreGate, pushName: nombreGate, chatUsername: np.casinoUsername, chatPassword: plainPassword });
  }
  const welcome = nombreGate
    ? (bridgeOnDirect
        ? `¡Hola, ${nombreGate}! 👋 Un segundo que te preparamos tu cuenta… 🎰`
        : `¡Hola, ${nombreGate}! 👋 Contanos qué necesitás y te ayudamos al toque 👇`)
    : (skin?.chatDirectWelcome ?? acc.chatDirectWelcome)?.trim() || DEFAULT_DIRECT_WELCOME;
  await prisma.chatMessage.create({
    data: { userId: acc.id, conversationId: conv.id, senderType: "system", body: welcome, metadata: {} },
  });
  await prisma.chatConversation.update({
    where: { id: conv.id },
    data: { lastMessageAt: new Date(), lastMessagePreview: welcome.slice(0, 118), unreadPlayer: 1 },
  });

  // Pixel: aunque el chat directo es anónimo, disparamos el Registro (external_id = usuario interno) para
  // que Meta optimice por registros y el Purchase de la carga matchee después (mismo loop que /r).
  const eventId = `${np.casinoUsername}:register`;
  const pxCreds = await resolveUserPixel(acc.id, "CompleteRegistration");
  void fireChatRegistration(acc.id, pxCreds, np.casinoUsername, eventId, { fbclid, fbp, fbc });

  const token = signChatClientToken(acc.id, np.id);
  setChatCookie(res, token); // sesión persistente (además del Bearer)
  return res.status(201).json({ token, player: np, conversationId: conv.id, username: np.casinoUsername, pixel: pxCreds?.pixelId ?? null, eventId });
});

// GET /api/chat/session — RECUPERA la sesión del jugador desde la cookie httpOnly (o el Bearer). La
// PWA la llama al abrir cuando no tiene token en localStorage: si la cookie es válida, repuebla la
// sesión SIN volver a registrar (así NO se duplica la cuenta de ganamos). Es "rodante": re-emite un
// token fresco y renueva la cookie 90 días, de modo que la sesión no vence mientras el jugador vuelva.
// POST /api/chat/logout — cierra la sesión del JUGADOR en ESTE dispositivo: limpia la cookie httpOnly
// de 90 días (la PWA borra su token de localStorage por su lado). Pedido de mrc/Gg: teléfonos
// compartidos o jugadores a los que el cajero les cambia la cuenta necesitan poder salir y entrar con
// otro usuario. No borra nada del jugador — con usuario y clave vuelve a entrar cuando quiera.
chatPublicRouter.post("/logout", (_req, res) => {
  res.clearCookie(CHAT_CLIENT_COOKIE, { path: "/" });
  return res.json({ ok: true });
});

chatPublicRouter.get("/session", async (req, res) => {
  const token = extractChatClientToken(req);
  if (!token) return res.status(401).json({ error: "sin sesión" });
  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    res.clearCookie(CHAT_CLIENT_COOKIE, { path: "/" });
    return res.status(401).json({ error: "sesión vencida" });
  }
  if (payload.type !== "client" || !payload.accountId || !payload.playerId) {
    return res.status(401).json({ error: "token inválido" });
  }
  // El jugador y la cuenta tienen que seguir existiendo (si se borraron, no recuperamos).
  const player = await prisma.chatPlayer.findFirst({
    where: { id: payload.playerId, userId: payload.accountId },
    select: { id: true, casinoUsername: true, skin: { select: { slug: true } } },
  });
  if (!player) {
    res.clearCookie(CHAT_CLIENT_COOKIE, { path: "/" });
    return res.status(401).json({ error: "sesión inválida" });
  }
  const acc = await prisma.user.findUnique({ where: { id: payload.accountId }, select: { slug: true } });
  const conv = await prisma.chatConversation.findFirst({ where: { userId: payload.accountId, playerId: player.id }, select: { id: true } });
  const fresh = signChatClientToken(payload.accountId, player.id); // rolling: renueva 90 días
  setChatCookie(res, fresh);
  // Jugador de una SKIN: su slug es el de la skin (la marca que eligió lo sigue al recuperar sesión).
  return res.json({ token: fresh, player: { id: player.id, casinoUsername: player.casinoUsername }, accountSlug: player.skin?.slug ?? acc?.slug ?? null, conversationId: conv?.id ?? null });
});

// ============================ CAJERO SELF-SERVICE (Fase E) ============================
// REGLA DURA: la acreditación al wallet la habilita SOLO el operador aprobando, o un webhook de
// gateway REAL. NUNCA por la imagen del comprobante. El Purchase CAPI se dispara SOLO al acreditar.
const MIN_DEPOSIT = 2000;      // carga mínima ARS
const MIN_WITHDRAWAL = 5000;   // retiro mínimo ARS
const ars = (n: number) => `$${n.toLocaleString("es-AR")}`;

// Purchase por CAPI de una carga. external_id = usuario (matchea el CompleteRegistration de Fase C
// → cierra el loop registro↔compra). eventId por depósito (dedup en Meta). IDEMPOTENTE: se dispara
// UNA sola vez por carga (marca purchaseFiredAt antes de mandar; el que llega primero gana).
// Se llama al LEER el comprobante con IA (auto) o al APROBAR la carga — lo que ocurra primero.
// OJO: esto es SOLO la señal de marketing a Meta. NO acredita fichas (eso sigue en approve/webhook, §9.2).
async function firePlayerPurchaseOnce(
  deposit: { id: string; userId: string; amount: number; currency: string; purchaseFiredAt: Date | null },
  username: string,
): Promise<boolean> {
  if (deposit.purchaseFiredAt) return false; // ya se disparó
  // Claim atómico: solo un proceso setea purchaseFiredAt (evita doble disparo upload/approve en carrera).
  const claim = await prisma.chatDeposit.updateMany({
    where: { id: deposit.id, purchaseFiredAt: null },
    data: { purchaseFiredAt: new Date() },
  });
  if (claim.count !== 1) return false;

  // Log en MetaEvent para que la venta sea VISIBLE en analytics/admin (como markPurchase).
  const creds = await resolveUserPixel(deposit.userId, "Purchase");
  const metaEvent = await prisma.metaEvent.create({
    data: { userId: deposit.userId, eventName: "Purchase", pixelId: creds?.pixelId ?? "", payload: {}, status: "pending" },
  });
  try {
    const result = await sendCapiEvent({
      eventName: "Purchase", userId: deposit.userId, externalId: username, eventId: `${deposit.id}:purchase`,
      value: deposit.amount, currency: deposit.currency, actionSource: "chat",
      pixelId: creds?.pixelId, capiToken: creds?.capiToken,
    });
    await prisma.metaEvent.update({ where: { id: metaEvent.id }, data: { status: "sent", pixelId: result.pixelId, payload: result.payload as object, response: result.response as object } });
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[chat] Purchase CAPI (carga) falló:", msg);
    await prisma.metaEvent.update({ where: { id: metaEvent.id }, data: { status: "failed", response: { error: msg } } });
    return false;
  }
}

// Lee el comprobante de una carga con IA y, si es un comprobante real, dispara el Purchase a Meta
// (una sola vez). Best-effort, aislado del flujo del jugador. NO acredita fichas.
// Exportada para reuso desde el script de backfill (mandar comprobantes históricos a Meta).
export async function readReceiptAndFirePurchase(depositId: string, opts?: { sendIntent?: boolean; receipt?: Awaited<ReturnType<typeof analyzeReceipt>> }) {
  try {
    const dep = await prisma.chatDeposit.findUnique({
      where: { id: depositId },
      select: { id: true, userId: true, playerId: true, amount: true, currency: true, purchaseFiredAt: true, comprobanteType: true, comprobanteData: true },
    });
    if (!dep || !dep.comprobanteData) return;
    if (dep.purchaseFiredAt && !opts?.sendIntent) return; // ya se disparó el Purchase y no hay intent que mandar
    // Con IA: confirmamos que la imagen ES un comprobante antes de mandar el evento (evita ensuciar
    // el pixel con fotos que no son pagos). Sin IA: confiamos en la carga estructurada del jugador.
    // Reusa el OCR que ya hizo el caller (/me/deposit para leer el monto); si no vino, lo lee acá.
    let receipt = opts?.receipt ?? null;
    if (!receipt && aiEnabled() && /image|pdf/i.test(dep.comprobanteType ?? "")) {
      receipt = await analyzeReceipt(Buffer.from(dep.comprobanteData).toString("base64"), dep.comprobanteType ?? undefined);
    }
    if (receipt && (!receipt.isReceipt || receipt.confidence < 0.5)) return; // la IA dice que no es un comprobante
    const player = await prisma.chatPlayer.findUnique({ where: { id: dep.playerId }, select: { casinoUsername: true } });
    if (!player) return;
    // Purchase a Meta (marketing, una sola vez) — idempotente por purchaseFiredAt.
    if (!dep.purchaseFiredAt) await firePlayerPurchaseOnce(dep, player.casinoUsername);
    // MODELO B (auto-carga, detrás del flag): avisamos la INTENCIÓN de carga a ganamos con el NOMBRE del
    // remitente + el código de operación que sacó el OCR (NO el CBU: el OCR confunde origen/destino). NO
    // acredita (eso llega por el callback firmado). Idempotente.
    if (opts?.sendIntent) {
      await sendDepositIntent(dep, player.casinoUsername, {
        senderName: receipt?.senderName ?? null,
        codigoOperacion: receipt?.codigoOperacion ?? null,
      });
    }
  } catch (e) {
    console.error("[chat] lectura de comprobante falló:", e instanceof Error ? e.message : String(e));
  }
}

// Deja un mensaje del sistema en la conversación del jugador (aviso de carga/retiro) + emite en vivo.
// senderType "player" -> el mensaje sale del lado del JUGADOR (burbuja derecha) y flaguea al
// operador. Se usa para las acciones que inicia el jugador (registrar carga / pedir retiro).
// "system" (default) -> avisos del casino al jugador (acreditado/rechazado): burbuja izquierda.
async function postCashierMsg(userId: string, playerId: string, body: string, senderType: "system" | "player" = "system") {
  const conv = await prisma.chatConversation.findFirst({ where: { userId, playerId }, select: { id: true } });
  if (!conv) return;
  const msg = await prisma.chatMessage.create({ data: { userId, conversationId: conv.id, senderType, senderId: senderType === "player" ? playerId : null, body }, select: { id: true, senderType: true, body: true, createdAt: true } });
  const unread = senderType === "player" ? { unreadOperator: { increment: 1 } } : { unreadPlayer: { increment: 1 } };
  await prisma.chatConversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date(), lastMessagePreview: body.slice(0, 120), ...unread } });
  const payload = { conversationId: conv.id, message: msg };
  emitChat(`chat:${userId}:player:${playerId}`, "chat:message", payload);
  emitChat(`chat:${userId}`, "chat:message", payload);
}

// Postea el COMPROBANTE que subió el jugador (por el form "Cargar fichas" → /me/deposit) como un mensaje
// con imagen en la conversación. Así el comprobante QUEDA EN EL CHAT (PWA) y el cajero lo ve dentro de la
// conversación, no sólo en la pestaña Cajero. La imagen se guarda como BrandingAsset (URL corta pública,
// mismo mecanismo que el resto de las imágenes del chat) para no inflar el row del mensaje con el data URL.
// Sale del lado del jugador (senderType "player") y flaguea al operador. Best-effort: si falla no corta la carga.
async function postComprobanteImage(userId: string, playerId: string, comprobanteType: string, comprobanteData: Buffer) {
  try {
    const conv = await prisma.chatConversation.findFirst({ where: { userId, playerId }, select: { id: true } });
    if (!conv) return;
    const asset = await prisma.brandingAsset.create({ data: { userId, contentType: comprobanteType, data: comprobanteData }, select: { id: true } });
    const base = (process.env.APP_BASE_URL ?? "http://localhost:4000").replace(/\/$/, "");
    const url = `${base}/api/chat/branding/asset/${asset.id}`;
    const msg = await prisma.chatMessage.create({
      data: { userId, conversationId: conv.id, senderType: "player", senderId: playerId, body: null, metadata: { image: url, comprobante: true } },
      select: { id: true, senderType: true, body: true, createdAt: true },
    });
    await prisma.chatConversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date(), lastMessagePreview: "📷 Comprobante", unreadOperator: { increment: 1 } } });
    // Payload con AMBOS: `image` aplanado (lo lee la PWA del jugador) y `metadata.image` (lo lee el panel
    // del cajero, ChatAppPage) → la imagen aparece EN VIVO en los dos lados sin recargar.
    const message = { id: msg.id, senderType: msg.senderType, body: msg.body, image: url, metadata: { image: url, comprobante: true }, createdAt: msg.createdAt };
    emitChat(`chat:${userId}`, "chat:message", { conversationId: conv.id, message });
    emitChat(`chat:${userId}:player:${playerId}`, "chat:message", { conversationId: conv.id, message });
  } catch (e) {
    console.error("[chat] postComprobanteImage:", e instanceof Error ? e.message : String(e));
  }
}

// El jugador manda el COMPROBANTE como imagen suelta en el chat (el bot le dice "subí el comprobante 📎
// acá") en vez de por el form "Cargar fichas". Lo leemos con IA y, si es un comprobante real, registramos
// la carga (pending) → la IA dispara Purchase + intent y aparece en la pestaña Cajero (dashboard). NUNCA
// acredita fichas: eso sigue SOLO en approve manual / callback firmado (§9.2). La imagen ya quedó en el
// chat (la posteó /me/messages). Devuelve true si lo tomó como comprobante (para que el bot no re-pregunte
// "Ya pagué"). Best-effort y aislado.
async function handlePlayerComprobante(accountId: string, playerId: string, comprobanteType: string, comprobanteData: Buffer, botAmount: number | null): Promise<boolean> {
  try {
    if (!aiEnabled() || !/image/i.test(comprobanteType)) return false;
    const receipt = await analyzeReceipt(comprobanteData.toString("base64"), comprobanteType);
    if (!receipt || !receipt.isReceipt || receipt.confidence < 0.5) return false; // la IA dice que no es un comprobante
    // Dedup: si el jugador ya tiene una carga pending reciente (usó también el form "Cargar fichas"), no
    // creamos otra — evita doble Purchase / doble intent. El comprobante ya quedó igual en el chat.
    const recent = await prisma.chatDeposit.findFirst({
      where: { userId: accountId, playerId, status: "pending", createdAt: { gte: new Date(Date.now() - 15 * 60 * 1000) } },
      select: { id: true },
    });
    if (recent) return true;
    const ocr = receipt.amount && receipt.amount > 0 ? Math.round(receipt.amount) : null;
    if (!ocr) {
      // Es un comprobante pero no pudimos leer el monto: avisamos al cajero (la imagen ya está en el chat).
      await notify(accountId, "system", "🧾 Comprobante sin monto legible",
        "Un jugador mandó un comprobante y no pudimos leer el monto. Revisalo en el chat y cargalo a mano si corresponde.").catch(() => undefined);
      await postCashierMsg(accountId, playerId, "🧾 Recibimos tu comprobante. Un cajero lo está verificando 🙌", "system").catch(() => undefined);
      return true;
    }
    const declared = botAmount && botAmount > 0 ? Math.round(botAmount / 100) : null; // lo que dijo en el flujo del bot
    const amount = declared && declared !== ocr ? declared : ocr; // si difieren confiamos en lo declarado
    if (declared && ocr && declared !== ocr) {
      await notify(accountId, "system", "⚠️ Monto: comprobante ≠ declarado",
        `El jugador dijo ${ars(declared)} pero el comprobante se leyó ${ars(ocr)}. Usamos ${ars(declared)} para la carga; verificá que la transferencia real coincida.`).catch(() => undefined);
    }
    const dep = await prisma.chatDeposit.create({
      data: { userId: accountId, playerId, amount, method: "Transferencia", comprobanteType, comprobanteData, status: "pending" },
      select: { id: true, amount: true },
    });
    emitChat(`chat:${accountId}`, "chat:cashier", { type: "deposit", id: dep.id }); // aparece en la pestaña Cajero
    const cargaMsg = (await casinoLiveForAccount(accountId))
      ? `🧾 Recibimos tu carga de ${ars(dep.amount)}. La estamos acreditando — puede demorar unos minutos. Te avisamos apenas entre 🙌`
      : `🧾 Registramos tu carga de ${ars(dep.amount)}. La estamos verificando.`;
    await postCashierMsg(accountId, playerId, cargaMsg, "system").catch(() => undefined);
    // La IA relee el comprobante → Purchase a Meta (marketing, una vez) + intent a ganamos (modelo B). Reusa
    // el OCR que ya hicimos. NO acredita fichas.
    void readReceiptAndFirePurchase(dep.id, { sendIntent: true, receipt });
    return true;
  } catch (e) {
    console.error("[chat] handlePlayerComprobante:", e instanceof Error ? e.message : String(e));
    return false;
  }
}

// Tras acreditar una carga, le RE-mandamos al jugador sus credenciales + link a la plataforma, con un
// botón para COPIAR el usuario (lo pega directo al loguear). La clave sólo se muestra en cuentas modelo
// B (ganamos), donde es la clave por defecto conocida; en el resto no la tenemos en claro (bcrypt).
async function postCargaCreds(userId: string, playerId: string) {
  const [player, acc, conv] = await Promise.all([
    prisma.chatPlayer.findUnique({ where: { id: playerId }, select: { casinoUsername: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { chatPlatformUrl: true } }),
    prisma.chatConversation.findFirst({ where: { userId, playerId }, select: { id: true } }),
  ]);
  if (!player || !conv) return;
  const username = player.casinoUsername;
  const clave = (await casinoLiveForAccount(userId)) ? casinoPlayerPassword() : null;
  const url = acc?.chatPlatformUrl?.trim() || null;
  const lines = ["¡Listo, ya podés jugar! 🎰 Tus datos para entrar:", "", `👤 Usuario: ${username}`];
  if (clave) lines.push(`🔑 Clave: ${clave}`);
  const body = lines.join("\n");
  const link = url ? { label: "🎮 Entrar a la plataforma", url } : undefined;
  const copy = { label: "📋 Copiar usuario", value: username };
  const metadata: { copy: { label: string; value: string }; link?: { label: string; url: string } } = link ? { copy, link } : { copy };
  const msg = await prisma.chatMessage.create({ data: { userId, conversationId: conv.id, senderType: "system", body, metadata }, select: { id: true, senderType: true, body: true, createdAt: true } });
  await prisma.chatConversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date(), lastMessagePreview: body.slice(0, 120), unreadPlayer: { increment: 1 } } });
  const payload = { conversationId: conv.id, message: { id: msg.id, senderType: msg.senderType, body: msg.body, image: null, buttons: null, link: link ?? null, copy, createdAt: msg.createdAt } };
  emitChat(`chat:${userId}:player:${playerId}`, "chat:message", payload);
  emitChat(`chat:${userId}`, "chat:message", payload);
}

// ---- JUGADOR (requireChatClient) ----

// GET /api/chat/me/wallet — saldo + historial de cargas/retiros.
chatPublicRouter.get("/me/wallet", requireChatClient, async (req, res) => {
  const wallet = await prisma.chatWallet.upsert({
    where: { playerId: req.chatPlayerId! },
    create: { userId: req.accountId!, playerId: req.chatPlayerId!, balance: 0 },
    update: {},
    select: { balance: true, currency: true },
  });
  const [deposits, withdrawals, acc] = await Promise.all([
    prisma.chatDeposit.findMany({ where: { playerId: req.chatPlayerId! }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, amount: true, method: true, status: true, createdAt: true } }),
    prisma.chatWithdrawal.findMany({ where: { playerId: req.chatPlayerId! }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, amount: true, destino: true, status: true, createdAt: true } }),
    prisma.user.findUnique({ where: { id: req.accountId! }, select: { botPaymentInfo: true, chatPayCbu: true, chatPayAlias: true, chatPayTitular: true } }),
  ]);
  return res.json({
    balance: wallet.balance, currency: wallet.currency, minDeposit: MIN_DEPOSIT, minWithdrawal: MIN_WITHDRAWAL,
    paymentInfo: acc?.botPaymentInfo ?? null,
    pay: { cbu: acc?.chatPayCbu ?? null, alias: acc?.chatPayAlias ?? null, titular: acc?.chatPayTitular ?? null },
    deposits, withdrawals,
  });
});

const depositSchema = z.object({
  amount: z.number().int().positive().optional(), // OPCIONAL: si no viene, lo lee la IA del comprobante
  method: z.string().min(1).max(60).optional(),
  comprobante: z.string().regex(/^data:image\/(png|jpeg|jpg|webp);base64,/, "Imagen inválida").optional(),
});

// POST /api/chat/me/deposit — el jugador informa una carga (queda PENDING; NO acredita nada).
chatPublicRouter.post("/me/deposit", requireChatClient, async (req, res) => {
  const parsed = depositSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido", details: parsed.error.flatten() });
  let comprobanteType: string | null = null, comprobanteData: Buffer | null = null;
  if (parsed.data.comprobante) {
    const d = parsed.data.comprobante;
    comprobanteType = d.slice(5, d.indexOf(";"));
    comprobanteData = Buffer.from(d.slice(d.indexOf(",") + 1), "base64");
    if (comprobanteData.length > 2 * 1024 * 1024) return res.status(413).json({ error: "El comprobante supera 2 MB. Sacá una foto más liviana." });
  }
  // Monto: el jugador puede NO escribirlo (pase directo → lo lee la IA del comprobante). SIEMPRE leemos
  // el comprobante (monto + remitente) y reusamos este `receipt` para el Purchase + el intent (un solo OCR).
  let receipt: Awaited<ReturnType<typeof analyzeReceipt>> = null;
  if (comprobanteData && aiEnabled() && /image/i.test(comprobanteType ?? "")) {
    receipt = await analyzeReceipt(comprobanteData.toString("base64"), comprobanteType ?? undefined);
  }
  const declared = parsed.data.amount && parsed.data.amount > 0 ? parsed.data.amount : null; // lo que tipeó el jugador
  const ocr = receipt?.amount && receipt.amount > 0 ? receipt.amount : null;                  // lo que leyó la IA (entero)
  // Control cruzado: ganamos matchea por monto EXACTO, un dígito de más = plata colgada. Si el jugador
  // declaró Y el OCR difiere, confiamos en el DECLARADO (lo tipeó él) y avisamos al operador. Si el OCR es
  // ~100× el declarado, es el bug de centavos en superíndice (Personal Pay: '$1⁰⁰' leído como 100).
  let amount = declared ?? ocr ?? 0;
  if (declared && ocr && declared !== ocr) {
    amount = declared;
    const superscriptBug = ocr === declared * 100;
    await notify(req.accountId!, "system", "⚠️ Monto: comprobante ≠ declarado",
      `El jugador declaró ${ars(declared)} pero el comprobante se leyó ${ars(ocr)}${superscriptBug ? " (centavos en superíndice mal leídos)" : ""}. Usamos ${ars(declared)} para la carga; verificá que la transferencia real coincida.`).catch(() => undefined);
  }
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: "No pudimos leer el monto del comprobante. Escribí el monto o subí una foto más clara." });
  }
  const dep = await prisma.chatDeposit.create({
    data: { userId: req.accountId!, playerId: req.chatPlayerId!, amount, method: parsed.data.method ?? "Transferencia", comprobanteType, comprobanteData, status: "pending" },
    select: { id: true, amount: true, method: true, status: true, createdAt: true },
  });
  // El comprobante QUEDA EN EL CHAT: lo posteamos como mensaje con imagen (antes del aviso de carga) para
  // que el jugador lo vea en su conversación y el cajero lo vea dentro del chat, no sólo en la pestaña Cajero.
  if (comprobanteData) await postComprobanteImage(req.accountId!, req.chatPlayerId!, comprobanteType ?? "image/jpeg", comprobanteData);
  // Aviso al operador (en vivo, para la sección Cajero) — NO acredita.
  emitChat(`chat:${req.accountId}`, "chat:cashier", { type: "deposit", id: dep.id });
  void enqueueOperatorPush(req.accountId!, { title: "🧾 Nueva carga", body: `Un jugador informó una carga de ${ars(dep.amount)}`, url: "/chat" }).catch(() => undefined);
  // Con modelo B (auto-carga) seteamos la expectativa de tiempo: la acreditación es automática pero puede
  // demorar hasta ~1 min (worker frío del socio). Sin B, lo verifica el operador (no prometemos tiempo).
  const cargaMsg = (await casinoLiveForAccount(req.accountId!))
    ? `🧾 Recibimos tu carga de ${ars(dep.amount)}. La estamos acreditando — puede demorar unos minutos. Te avisamos apenas entre 🙌`
    : `🧾 Registraste una carga de ${ars(dep.amount)} (${dep.method}). La estamos verificando.`;
  await postCashierMsg(req.accountId!, req.chatPlayerId!, cargaMsg, "player").catch(() => undefined);
  // Si subió comprobante: la IA lo lee y (1) manda el Purchase a Meta una sola vez (cierra el loop del
  // pixel) y (2) con modelo B, avisa la INTENCIÓN de carga a ganamos con el CBU/CUIT del remitente.
  // NUNCA acredita fichas acá: eso lo dispara el callback firmado de ganamos (o el operador en modelo A).
  if (comprobanteData) void readReceiptAndFirePurchase(dep.id, { sendIntent: true, receipt: receipt ?? undefined });
  return res.status(201).json({ deposit: dep });
});

const withdrawalSchema = z.object({ amount: z.number().int().positive(), destino: z.string().min(3).max(60) });

// POST /api/chat/me/withdrawal — el jugador pide un retiro (queda REQUESTED). Chequea saldo.
chatPublicRouter.post("/me/withdrawal", requireChatClient, async (req, res) => {
  const parsed = withdrawalSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido" });
  if (parsed.data.amount < MIN_WITHDRAWAL) return res.status(400).json({ error: `El retiro mínimo es ${ars(MIN_WITHDRAWAL)}.` });
  const wallet = await prisma.chatWallet.findUnique({ where: { playerId: req.chatPlayerId! }, select: { balance: true } });
  if (!wallet || wallet.balance < parsed.data.amount) return res.status(400).json({ error: "Saldo insuficiente para ese retiro." });
  const w = await prisma.chatWithdrawal.create({
    data: { userId: req.accountId!, playerId: req.chatPlayerId!, amount: parsed.data.amount, destino: parsed.data.destino.trim(), status: "requested" },
    select: { id: true, amount: true, destino: true, status: true, createdAt: true },
  });
  emitChat(`chat:${req.accountId}`, "chat:cashier", { type: "withdrawal", id: w.id });
  void enqueueOperatorPush(req.accountId!, { title: "🏧 Nuevo retiro", body: `Un jugador pidió retirar ${ars(w.amount)}`, url: "/chat" }).catch(() => undefined);
  await postCashierMsg(req.accountId!, req.chatPlayerId!, `🏧 Pediste un retiro de ${ars(w.amount)}. Lo estamos procesando.`, "player").catch(() => undefined);
  return res.status(201).json({ withdrawal: w });
});

// ---- OPERADOR (requireAuth) ----

// GET /api/chat/cashier — pendientes (cargas pending + retiros requested) con el usuario del jugador.
chatRouter.get("/cashier", async (req, res) => {
  const [deposits, withdrawals] = await Promise.all([
    prisma.chatDeposit.findMany({ where: { userId: req.userId!, status: "pending" }, orderBy: { createdAt: "asc" }, select: { id: true, playerId: true, amount: true, method: true, comprobanteType: true, createdAt: true } }),
    prisma.chatWithdrawal.findMany({ where: { userId: req.userId!, status: "requested" }, orderBy: { createdAt: "asc" }, select: { id: true, playerId: true, amount: true, destino: true, createdAt: true } }),
  ]);
  const ids = [...new Set([...deposits.map((d) => d.playerId), ...withdrawals.map((w) => w.playerId)])];
  const players = ids.length ? await prisma.chatPlayer.findMany({ where: { id: { in: ids } }, select: { id: true, casinoUsername: true, nombre: true } }) : [];
  const nameById = new Map(players.map((p) => [p.id, p.nombre || p.casinoUsername]));
  return res.json({
    deposits: deposits.map((d) => ({ id: d.id, player: nameById.get(d.playerId) ?? "Jugador", amount: d.amount, method: d.method, hasComprobante: !!d.comprobanteType, createdAt: d.createdAt })),
    withdrawals: withdrawals.map((w) => ({ id: w.id, player: nameById.get(w.playerId) ?? "Jugador", amount: w.amount, destino: w.destino, createdAt: w.createdAt })),
  });
});

// GET /api/chat/cashier/deposit/:id/comprobante — sirve la imagen del comprobante (operador).
chatRouter.get("/cashier/deposit/:id/comprobante", async (req, res) => {
  const dep = await prisma.chatDeposit.findFirst({ where: { id: req.params.id, userId: req.userId! }, select: { comprobanteType: true, comprobanteData: true } });
  if (!dep?.comprobanteData) return res.status(404).json({ error: "Sin comprobante" });
  res.setHeader("Content-Type", dep.comprobanteType ?? "image/jpeg");
  res.setHeader("Cache-Control", "private, max-age=300");
  return res.send(Buffer.from(dep.comprobanteData));
});

// POST /api/chat/cashier/deposit/:id/approve — ACREDITA (única vía manual). Suma al wallet, marca
// credited y dispara Purchase CAPI. Idempotente por status (solo procesa si está pending).
chatRouter.post("/cashier/deposit/:id/approve", async (req, res) => {
  const dep = await prisma.chatDeposit.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!dep) return res.status(404).json({ error: "No encontrado" });
  if (dep.status !== "pending") return res.status(409).json({ error: "Esa carga ya fue resuelta." });
  const wallet = await prisma.chatWallet.upsert({
    where: { playerId: dep.playerId },
    create: { userId: req.userId!, playerId: dep.playerId, balance: dep.amount, currency: dep.currency },
    update: { balance: { increment: dep.amount } },
    select: { balance: true },
  });
  await prisma.chatDeposit.update({ where: { id: dep.id }, data: { status: "credited", resolvedAt: new Date() } });
  const player = await prisma.chatPlayer.findUnique({ where: { id: dep.playerId }, select: { casinoUsername: true } });
  // Purchase idempotente: si la IA ya lo disparó al leer el comprobante, este approve NO lo repite.
  if (player) void firePlayerPurchaseOnce(dep, player.casinoUsername);
  // Casino (socio ganamos, detrás del flag CASINO_API_*): acredita las fichas EN ganamos además del
  // wallet interno. Apagado = no-op. Idempotente por CasinoTx `dep-<id>`; si falla, avisa al operador.
  if (player) void creditDepositInCasino(dep, player.casinoUsername);
  await postCashierMsg(req.userId!, dep.playerId, `✅ ¡Carga acreditada! ${ars(dep.amount)}. Tu saldo: ${ars(wallet.balance)}.`);
  await postCargaCreds(req.userId!, dep.playerId); // re-envía usuario + clave + link + botón "Copiar usuario"
  emitChat(`chat:${req.userId}:player:${dep.playerId}`, "chat:wallet", { balance: wallet.balance });
  return res.json({ ok: true, balance: wallet.balance });
});

// POST /api/chat/cashier/deposit/:id/reject
chatRouter.post("/cashier/deposit/:id/reject", async (req, res) => {
  const dep = await prisma.chatDeposit.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!dep) return res.status(404).json({ error: "No encontrado" });
  if (dep.status !== "pending") return res.status(409).json({ error: "Esa carga ya fue resuelta." });
  await prisma.chatDeposit.update({ where: { id: dep.id }, data: { status: "rejected", resolvedAt: new Date() } });
  await postCashierMsg(req.userId!, dep.playerId, `❌ No pudimos verificar tu carga de ${ars(dep.amount)}. Escribinos y lo revisamos.`);
  return res.json({ ok: true });
});

// POST /api/chat/cashier/withdrawal/:id/approve — DÉBITO atómico (solo si el saldo alcanza) + paid.
chatRouter.post("/cashier/withdrawal/:id/approve", async (req, res) => {
  const w = await prisma.chatWithdrawal.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!w) return res.status(404).json({ error: "No encontrado" });
  if (w.status !== "requested") return res.status(409).json({ error: "Ese retiro ya fue resuelto." });
  // Débito condicional: solo descuenta si el saldo alcanza (evita saldo negativo en carreras).
  const debited = await prisma.chatWallet.updateMany({ where: { playerId: w.playerId, balance: { gte: w.amount } }, data: { balance: { decrement: w.amount } } });
  if (debited.count !== 1) return res.status(400).json({ error: "Saldo insuficiente del jugador para pagar el retiro." });
  await prisma.chatWithdrawal.update({ where: { id: w.id }, data: { status: "paid", resolvedAt: new Date() } });
  // Casino (socio ganamos, detrás del flag): debita las fichas EN ganamos. Apagado = no-op.
  const wPlayer = await prisma.chatPlayer.findUnique({ where: { id: w.playerId }, select: { casinoUsername: true } });
  if (wPlayer) void debitWithdrawalInCasino(w, wPlayer.casinoUsername);
  const wallet = await prisma.chatWallet.findUnique({ where: { playerId: w.playerId }, select: { balance: true } });
  await postCashierMsg(req.userId!, w.playerId, `✅ Retiro pagado: ${ars(w.amount)} a ${w.destino}. Saldo: ${ars(wallet?.balance ?? 0)}.`);
  emitChat(`chat:${req.userId}:player:${w.playerId}`, "chat:wallet", { balance: wallet?.balance ?? 0 });
  return res.json({ ok: true });
});

// POST /api/chat/cashier/withdrawal/:id/reject
chatRouter.post("/cashier/withdrawal/:id/reject", async (req, res) => {
  const w = await prisma.chatWithdrawal.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!w) return res.status(404).json({ error: "No encontrado" });
  if (w.status !== "requested") return res.status(409).json({ error: "Ese retiro ya fue resuelto." });
  await prisma.chatWithdrawal.update({ where: { id: w.id }, data: { status: "rejected", resolvedAt: new Date() } });
  await postCashierMsg(req.userId!, w.playerId, `❌ Tu retiro de ${ars(w.amount)} no se pudo procesar. Escribinos y lo vemos.`);
  return res.json({ ok: true });
});

// Aplica localmente una carga que ganamos YA acreditó (callback "credited"). Idempotente por el estado
// del ChatDeposit (Eduardo reintenta hasta 3x). Acredita el wallet interno + dispara el Purchase.
async function applyCasinoCallbackCredit(depositId: string, referencia: string, movementId: string | null) {
  const dep = await prisma.chatDeposit.findUnique({
    where: { id: depositId },
    select: { id: true, userId: true, playerId: true, amount: true, currency: true, status: true, purchaseFiredAt: true },
  });
  if (!dep) { console.warn(`[pay/webhook] credited sin ChatDeposit ${depositId}`); return; }
  if (dep.status === "credited") return; // ya acreditado (idempotente)
  // Claim atómico: solo UN callback acredita, aunque lleguen reintentos en paralelo.
  const claim = await prisma.chatDeposit.updateMany({ where: { id: depositId, status: { not: "credited" } }, data: { status: "credited", resolvedAt: new Date() } });
  if (claim.count !== 1) return;
  const wallet = await prisma.chatWallet.upsert({
    where: { playerId: dep.playerId },
    create: { userId: dep.userId, playerId: dep.playerId, balance: dep.amount, currency: dep.currency },
    update: { balance: { increment: dep.amount } },
    select: { balance: true },
  });
  await prisma.casinoTx.updateMany({ where: { referencia }, data: { status: "completed", txId: movementId, errorCode: null } }); // movementId = id de la transacción en ganamos (auditoría)
  const player = await prisma.chatPlayer.findUnique({ where: { id: dep.playerId }, select: { casinoUsername: true } });
  if (player) await firePlayerPurchaseOnce(dep, player.casinoUsername); // idempotente por purchaseFiredAt
  await postCashierMsg(dep.userId, dep.playerId, `✅ ¡Carga acreditada! ${ars(dep.amount)}. Tu saldo: ${ars(wallet.balance)}.`);
  await postCargaCreds(dep.userId, dep.playerId); // re-envía usuario + clave + link + botón "Copiar usuario"
  emitChat(`chat:${dep.userId}:player:${dep.playerId}`, "chat:wallet", { balance: wallet.balance });
}

// Callback "failed" / "expired": no se pudo confirmar la transferencia (o venció el intent a las 48 h).
async function failCasinoCallbackDeposit(depositId: string, referencia: string, status: string, error: string | null) {
  await prisma.casinoTx.updateMany({ where: { referencia }, data: { status: "failed", errorCode: error ?? status } });
  const claim = await prisma.chatDeposit.updateMany({ where: { id: depositId, status: "pending" }, data: { status: "rejected", resolvedAt: new Date() } });
  if (claim.count !== 1) return; // ya resuelto o ya acreditado -> no tocamos
  const dep = await prisma.chatDeposit.findUnique({ where: { id: depositId }, select: { userId: true, playerId: true, amount: true } });
  if (!dep) return;
  const motivo = status === "expired" ? "no recibimos la transferencia dentro de las 48 h" : "no pudimos confirmar el pago";
  await postCashierMsg(dep.userId, dep.playerId, `⚠️ Tu carga de ${ars(dep.amount)} no se pudo acreditar (${motivo}). Si ya transferiste, escribinos.`);
}

// POST /api/chat/pay/webhook — CALLBACK del socio (ganamos, modelo B — auto-carga). Firmado
// HMAC-SHA256 sobre `${X-Partner-Timestamp}.${body crudo}` en el header X-Partner-Signature. Es el
// ÚNICO camino de acreditación AUTOMÁTICA seguro: con firma válida y pago real confirmado, acredita el
// wallet + dispara el Purchase. Idempotente por el estado del ChatDeposit. NUNCA se acredita por la imagen.
chatPublicRouter.post("/pay/webhook", async (req, res) => {
  const secret = process.env.CHAT_PAY_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: "Gateway de pagos no configurado" });
  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
  const ts = typeof req.headers["x-partner-timestamp"] === "string" ? req.headers["x-partner-timestamp"] : undefined;
  const sig = typeof req.headers["x-partner-signature"] === "string" ? req.headers["x-partner-signature"] : undefined;
  if (!verifyPartnerSignature(secret, ts, sig, rawBody) || !isCallbackTimestampFresh(ts)) {
    return res.status(401).json({ error: "firma inválida" });
  }
  const b = (req.body ?? {}) as Record<string, unknown>;
  const status = String(b.status ?? "");
  const referencia = String(b.referencia ?? "");
  if (!referencia.startsWith("dep-")) return res.status(400).json({ error: "referencia inválida" });
  const depositId = referencia.slice(4);
  try {
    if (status === "credited") {
      await applyCasinoCallbackCredit(depositId, referencia, typeof b.movementId === "string" ? b.movementId : null);
    } else if (status === "failed" || status === "expired") {
      await failCasinoCallbackDeposit(depositId, referencia, status, typeof b.error === "string" ? b.error : null);
    } else if (status === "unknown" || status === "queued" || status === "ambiguous") {
      // Estados INTERMEDIOS (contrato del socio, confirmado 2026-08-13): queued = aún no aplicó; unknown =
      // no sabe si aplicó (timeout/proxy); ambiguous = no pudo confirmar. NO acreditamos y NO reemitimos con
      // otra referencia (cargaría dos veces). Esperamos el callback FINAL (credited/failed/expired) o se
      // consulta GET /intent?referencia=X. Ackeamos 200 para no reintentar el intermedio.
      console.warn(`[pay/webhook] status "${status}" para ${referencia} — no acredito, espero el estado final`);
    }
    return res.json({ ok: true }); // 2xx = procesado (idempotente). Si devolvemos != 2xx, Eduardo reintenta.
  } catch (e) {
    console.error("[pay/webhook] error:", e instanceof Error ? e.message : String(e));
    return res.status(500).json({ error: "error procesando el callback" });
  }
});
