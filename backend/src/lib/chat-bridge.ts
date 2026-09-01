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
