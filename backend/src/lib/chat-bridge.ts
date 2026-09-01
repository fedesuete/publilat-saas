// Puente Chat App ↔ bot cajero externo (combatwin/mijoker). Dos direcciones, ambas GATEADAS:
//
//  ENTRADA: forwardChatToBot — reenvía el mensaje del jugador del Chat App al bot externo con un
//  payload sintético Evolution-like (misma forma que lib/bot-forward.ts para WhatsApp), con
//  `instance` = publilat-chat-<accountId> y `phone` = chat:<chatPlayerId>. Habilitado por env
//  `BOT_CHAT_FORWARD` = {"<accountId>":"<url>"}. Sin env (o sin la cuenta en el mapa) es no-op.
//  Fire-and-forget: timeout 5s, catch con log, NUNCA bloquea el chat.
//
//  SALIDA: postBotChatMessage — el bot responde vía POST /api/bot-relay/chat-send con el mismo
//  `playerRef` (chat:<id>); acá se postea en la conversación como mensaje del cajero (igual que
//  postCashierMsg de routes/chat.ts) y se emite en vivo. SOLO postea con User.chatBotBridge=true;
//  con chatBotBridgeShadow (modo sombra) loguea lo que respondería SIN postear. Apagado = no-op.
//
// El prefijo no numérico `chat:` garantiza que el ref nunca colisiona con un teléfono real.
import { prisma } from "./prisma.js";
import { emitChat } from "./io.js";
import { resolveUserPixel } from "./pixel.js";
import { sendCapiEvent } from "./meta-capi.js";

const REF_PREFIX = "chat:";

export function chatInstance(accountId: string): string {
  return `publilat-chat-${accountId}`;
}

export function parseChatPlayerRef(ref: string): string | null {
  if (!ref.startsWith(REF_PREFIX)) return null;
  const id = ref.slice(REF_PREFIX.length);
  return id.length > 0 ? id : null;
}

// ---- ENTRADA: Chat App → bot ----
export function forwardChatToBot(accountId: string, chatPlayerId: string, data: {
  text?: string | null;
  msgId?: string;
  pushName?: string | null;
  chatUsername?: string | null;  // ChatPlayer.casinoUsername: el usuario que la app YA le mostró
                                 // al jugador → el bot lo vincula/crea con ESE username (no inventa otro)
  chatPassword?: string | null;  // la clave que la app mostró junto al usuario → el alta en la
                                 // plataforma usa ESTA (un solo juego de credenciales)
  mediaBase64?: string | null;   // comprobante en base64 SIN prefijo data:
  mediaMimetype?: string | null;
}): void {
  let url: string | undefined;
  try {
    url = (JSON.parse(process.env.BOT_CHAT_FORWARD || "{}") as Record<string, string>)[accountId];
  } catch {
    return; // BOT_CHAT_FORWARD mal formado → no reenvía (no rompe el flujo)
  }
  if (!url) return;
  const ref = `${REF_PREFIX}${chatPlayerId}`;
  // message con la MISMA forma que manda WhatsApp (bot-forward.ts): texto = conversation;
  // imagen = imageMessage con caption + mediaBase64 aparte. Así el bot lo parsea sin ramas nuevas.
  const message = data.mediaBase64
    ? { imageMessage: { caption: data.text ?? "", mimetype: data.mediaMimetype ?? "image/jpeg" } }
    : { conversation: data.text ?? "" };
  void fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      instance: chatInstance(accountId),
      data: {
        key: { remoteJid: ref, fromMe: false, id: data.msgId, senderPn: ref },
        message,
        pushName: data.pushName ?? undefined,
        chatUsername: data.chatUsername ?? undefined,
        chatPassword: data.chatPassword ?? undefined,
        mediaBase64: data.mediaBase64 ?? undefined,
        mediaMimetype: data.mediaMimetype ?? undefined,
      },
    }),
    signal: AbortSignal.timeout(5000),
  }).catch((e) => console.warn("[chat-bridge fwd]", accountId, e instanceof Error ? e.message : String(e)));
}

// ---- SYNC: el bot creó el username DEFINITIVO para un jugador del flujo directo (web* provisional
// que la app nunca le mostró) → acá se pisa el provisional, así el login del Chat App y la cuenta
// del casino quedan con EL MISMO usuario. Best-effort: username tomado o jugador inexistente = no-op.
export async function updateChatPlayerUsername(playerRef: string, username: string): Promise<{ ok: boolean; skipped?: string }> {
  const playerId = parseChatPlayerRef(playerRef);
  if (!playerId || !username.trim()) return { ok: false, skipped: "bad_input" };
  try {
    await prisma.chatPlayer.update({ where: { id: playerId }, data: { casinoUsername: username.trim() } });
    return { ok: true };
  } catch (e) {
    console.warn("[chat-bridge sync-username]", playerId, e instanceof Error ? e.message : String(e));
    return { ok: false, skipped: "update_failed" };
  }
}

// ---- OPERATOR HOLD: el OPERADOR respondió en una conversación del Chat App → avisamos al bot
// para que se calle en esa conversación (ventana operatorHoldMinutes, igual que en WhatsApp con
// notify-bot.ts). Mismo gate por env que el forward: sin BOT_CHAT_FORWARD para la cuenta es un
// no-op. Fire-and-forget: nunca bloquea ni rompe el envío del operador.
export function notifyBotOperatorActiveChat(accountId: string, chatPlayerId: string): void {
  let webhookUrl: string | undefined;
  try {
    webhookUrl = (JSON.parse(process.env.BOT_CHAT_FORWARD || "{}") as Record<string, string>)[accountId];
  } catch {
    return;
  }
  if (!webhookUrl) return;
  const url = webhookUrl.replace("/api/wa/webhook", "/api/wa/operator-active");
  void fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instance: chatInstance(accountId), phone: `${REF_PREFIX}${chatPlayerId}` }),
    signal: AbortSignal.timeout(5000),
  }).catch((e) => console.warn("[chat-bridge op-hold]", accountId, e instanceof Error ? e.message : String(e)));
}

// ---- PURCHASE: el bot acreditó una carga REAL de un jugador del Chat App → señal de marketing a
// Meta (Purchase CAPI) con el pixel de la cuenta. Los Purchase de WhatsApp los dispara el OCR del
// inbox; los del Chat App no pasan por ahí, entran por POST /api/bot-relay/purchase con el
// playerRef chat:<id>. external_id = casinoUsername (matchea el CompleteRegistration del alta) +
// fbp/fbc/IP/UA guardados en el ChatPlayer al entrar por el anuncio (EMQ). eventId ÚNICO por
// carga: Meta cuenta cada una. NO acredita fichas (la plata ya se movió del lado del bot).
export async function fireChatBridgePurchase(playerRef: string, amount: number, currency: string): Promise<{ ok: boolean; skipped?: string }> {
  const playerId = parseChatPlayerRef(playerRef);
  if (!playerId || !(amount > 0)) return { ok: false, skipped: "bad_input" };
  const player = await prisma.chatPlayer.findUnique({
    where: { id: playerId },
    select: { id: true, userId: true, casinoUsername: true, fbp: true, fbc: true, fbclid: true, clientIp: true, userAgent: true },
  });
  if (!player) return { ok: false, skipped: "no_player" };
  // SOLO jugadores que vinieron de un ANUNCIO de Meta (fbclid/fbc del click guardados al alta).
  // Los registrados de antes y los orgánicos (link compartido, sin click) NO disparan Purchase:
  // el pixel mide la campaña, no el volumen orgánico (pedido de Eduardo 01/09). fbp NO alcanza
  // como señal (la cookie del pixel se siembra en cualquier visita, con o sin anuncio).
  if (!player.fbclid && !player.fbc) {
    console.log(`[chat-bridge purchase] ${playerId} sin click de anuncio → no se reporta a Meta`);
    return { ok: true, skipped: "sin_click_de_anuncio" };
  }
  const creds = await resolveUserPixel(player.userId, "Purchase");
  // Log en MetaEvent para que la venta sea VISIBLE en analytics/admin (mismo patrón que el cajero nativo).
  const metaEvent = await prisma.metaEvent.create({
    data: { userId: player.userId, eventName: "Purchase", pixelId: creds?.pixelId ?? "", payload: {}, status: "pending" },
  });
  try {
    const fbc = player.fbc ?? (player.fbclid ? `fb.1.${Date.now()}.${player.fbclid}` : undefined);
    const result = await sendCapiEvent({
      eventName: "Purchase",
      userId: player.userId,
      externalId: player.casinoUsername,
      eventId: `${player.id}:bridge:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      value: amount,
      currency,
      actionSource: "chat",
      fbp: player.fbp ?? undefined,
      fbc,
      clientIp: player.clientIp ?? undefined,
      userAgent: player.userAgent ?? undefined,
      pixelId: creds?.pixelId,
      capiToken: creds?.capiToken,
    });
    await prisma.metaEvent.update({ where: { id: metaEvent.id }, data: { status: "sent", pixelId: result.pixelId, payload: result.payload as object, response: result.response as object } });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[chat-bridge purchase]", playerId, msg);
    await prisma.metaEvent.update({ where: { id: metaEvent.id }, data: { status: "failed", response: { error: msg } } }).catch(() => undefined);
    return { ok: false, skipped: "capi_failed" };
  }
}

// ---- SALIDA: bot → Chat App ----
export async function postBotChatMessage(playerRef: string, message: string): Promise<{ ok: boolean; skipped?: string; shadow?: boolean }> {
  const playerId = parseChatPlayerRef(playerRef);
  if (!playerId) return { ok: false, skipped: "bad_ref" };
  const player = await prisma.chatPlayer.findUnique({
    where: { id: playerId },
    select: { id: true, userId: true, user: { select: { chatBotBridge: true, chatBotBridgeShadow: true } } },
  });
  if (!player) return { ok: false, skipped: "no_player" };
  if (!player.user.chatBotBridge) {
    if (player.user.chatBotBridgeShadow) {
      // Modo sombra: registramos QUÉ respondería el bot, sin tocar la conversación.
      console.log(`[chat-bridge shadow] ${player.userId} → ${playerId}: ${message.slice(0, 300)}`);
      return { ok: true, shadow: true };
    }
    return { ok: true, skipped: "bridge_off" }; // 200 igual: no queremos reintentos del bot
  }
  const conv = await prisma.chatConversation.findFirst({ where: { userId: player.userId, playerId }, select: { id: true } });
  if (!conv) return { ok: false, skipped: "no_conversation" };
  // Mismo shape que postCashierMsg (routes/chat.ts): burbuja izquierda del sistema + preview + unread.
  const msg = await prisma.chatMessage.create({
    data: { userId: player.userId, conversationId: conv.id, senderType: "system", senderId: null, body: message },
    select: { id: true, senderType: true, body: true, createdAt: true },
  });
  await prisma.chatConversation.update({
    where: { id: conv.id },
    data: { lastMessageAt: new Date(), lastMessagePreview: message.slice(0, 120), unreadPlayer: { increment: 1 } },
  });
  const payload = { conversationId: conv.id, message: msg };
  emitChat(`chat:${player.userId}:player:${playerId}`, "chat:message", payload);
  emitChat(`chat:${player.userId}`, "chat:message", payload);
  return { ok: true };
}
