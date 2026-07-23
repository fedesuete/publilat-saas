// Bot de carga/descarga del Chat App (Fase 1). Automatiza la conversación de CARGA: menú → monto →
// datos de pago del cliente → avisa al cajero para que verifique y cargue (semi-automático).
// Fase 3: en vez de avisar al cajero, disparará el webhook del sistema del socio (botLoadWebhook).
//
// 100% AISLADO y ADITIVO: solo actúa si la cuenta tiene el bot PRENDIDO (botEnabled). Sin bot es
// no-op. No toca WhatsApp, ni el flujo actual del Chat App, ni la atribución.
import { prisma } from "./prisma.js";
import { emitChat } from "./io.js";

// Mensaje del BOT hacia el jugador (se ve como mensaje entrante en su app).
async function botSay(accountId: string, convId: string, playerId: string, body: string): Promise<void> {
  const msg = await prisma.chatMessage.create({
    data: { userId: accountId, conversationId: convId, senderType: "operator", senderId: null, body, metadata: { bot: true } },
    select: { id: true, senderType: true, body: true, createdAt: true },
  });
  await prisma.chatConversation.update({
    where: { id: convId },
    data: { lastMessageAt: new Date(), lastMessagePreview: body.slice(0, 120), unreadPlayer: { increment: 1 } },
  });
  const payload = { conversationId: convId, message: { ...msg, image: null } };
  emitChat(`chat:${accountId}:player:${playerId}`, "chat:message", payload); // al jugador
  emitChat(`chat:${accountId}`, "chat:message", payload);                    // al operador (para verlo en el inbox)
}

// Aviso al CAJERO dentro de la conversación (mensaje de sistema + no-leído del operador).
async function alertCajero(accountId: string, convId: string, text: string): Promise<void> {
  const msg = await prisma.chatMessage.create({
    data: { userId: accountId, conversationId: convId, senderType: "system", body: text, metadata: { bot: true, alert: true } },
    select: { id: true, senderType: true, body: true, createdAt: true },
  });
  await prisma.chatConversation.update({
    where: { id: convId },
    data: { lastMessageAt: new Date(), lastMessagePreview: text.slice(0, 120), unreadOperator: { increment: 1 } },
  });
  const payload = { conversationId: convId, message: { ...msg, image: null } };
  emitChat(`chat:${accountId}`, "chat:message", payload);
}

const num = (s: string): number => { const m = s.replace(/[.,\s]/g, "").match(/\d+/); return m ? parseInt(m[0], 10) : NaN; };
const has = (t: string, ...words: string[]): boolean => words.some((w) => t.includes(w));

// Procesa el mensaje del jugador y (si corresponde) responde el bot. Se llama best-effort desde
// /api/chat/me/messages DESPUÉS de guardar/emitir el mensaje del jugador.
export async function runChatBot(accountId: string, convId: string, playerId: string, rawText: string): Promise<void> {
  const acc = await prisma.user.findUnique({ where: { id: accountId }, select: { botEnabled: true, botPaymentInfo: true, botWelcome: true } });
  if (!acc?.botEnabled) return;
  const conv = await prisma.chatConversation.findUnique({
    where: { id: convId },
    select: { botStep: true, botAmount: true, player: { select: { casinoUsername: true } } },
  });
  if (!conv || conv.botStep === "human") return; // ya lo maneja un cajero

  const t = rawText.trim().toLowerCase();
  const playerName = conv.player?.casinoUsername ?? "jugador";

  // Pedir cajero en CUALQUIER momento corta el bot y avisa.
  if (has(t, "cajero", "humano", "persona", "operador", "atencion", "atención") || t === "3") {
    await prisma.chatConversation.update({ where: { id: convId }, data: { botStep: "human" } });
    await botSay(accountId, convId, playerId, "Te paso con un cajero 👤. Aguardá un momento que te responden.");
    await alertCajero(accountId, convId, `🙋 ${playerName} pidió hablar con un cajero.`);
    return;
  }

  const step = conv.botStep;

  if (step === "carga_monto") {
    const amount = num(t);
    if (!amount || amount <= 0) { await botSay(accountId, convId, playerId, "No entendí el monto 🤔. Escribí solo el número, por ejemplo *5000*."); return; }
    await prisma.chatConversation.update({ where: { id: convId }, data: { botStep: "carga_pago", botAmount: amount * 100 } });
    const pay = acc.botPaymentInfo?.trim() || "En un momento un cajero te pasa los datos de pago.";
    await botSay(accountId, convId, playerId, `Perfecto, cargás *$${amount}* ✅\n\nPagá así:\n${pay}\n\nCuando pagues, escribí *ya pagué* y te acreditamos en minutos 🚀`);
    return;
  }

  if (step === "carga_pago") {
    if (has(t, "pague", "pagué", "listo", "pago", "transferi", "transferí", "ya esta", "ya está", "hecho")) {
      const amount = (conv.botAmount ?? 0) / 100;
      await prisma.chatConversation.update({ where: { id: convId }, data: { botStep: null, botAmount: null } });
      await botSay(accountId, convId, playerId, "¡Genial! 🙌 Un cajero está verificando tu pago y te acredita en unos minutos ⏳");
      await alertCajero(accountId, convId, `⚠️ CARGA PENDIENTE: $${amount} de ${playerName}. Verificá el pago y cargá los créditos.`);
      return;
    }
    await botSay(accountId, convId, playerId, "Cuando hayas pagado escribí *ya pagué* y lo verificamos ✅. O escribí *cajero* si necesitás ayuda.");
    return;
  }

  // Sin paso activo: intención directa o menú de bienvenida.
  if (has(t, "cargar", "carga", "depositar", "deposito", "depósito", "meter") || t === "1") {
    await prisma.chatConversation.update({ where: { id: convId }, data: { botStep: "carga_monto" } });
    await botSay(accountId, convId, playerId, "¿Cuánto querés cargar? Escribí el monto 💰");
    return;
  }
  if (has(t, "retirar", "retiro", "descarga", "descargar", "cobrar", "sacar") || t === "2") {
    // Fase 2: descarga automática. Por ahora lo derivamos a un cajero.
    await prisma.chatConversation.update({ where: { id: convId }, data: { botStep: "human" } });
    await botSay(accountId, convId, playerId, "Para tu retiro te paso con un cajero 👤. Aguardá un momento.");
    await alertCajero(accountId, convId, `💸 ${playerName} quiere RETIRAR. Atendelo.`);
    return;
  }

  const welcome = acc.botWelcome?.trim() ? acc.botWelcome.trim() + "\n\n" : "";
  await botSay(accountId, convId, playerId, `${welcome}¿Qué querés hacer?\n\n1️⃣ *Cargar*\n2️⃣ *Retirar*\n3️⃣ *Hablar con un cajero*\n\nRespondé con el número o la palabra 🙂`);
}
