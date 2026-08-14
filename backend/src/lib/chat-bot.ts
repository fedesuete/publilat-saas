// Bot de carga/descarga del Chat App. Automatiza la conversación de CARGA y DESCARGA: menú con
// botones → monto → datos de pago → avisa al cajero para verificar/acreditar/pagar (semi-automático).
// Fase 3: en vez de avisar al cajero, disparará el webhook del sistema del socio (botLoadWebhook).
//
// 100% AISLADO y ADITIVO: solo actúa si la cuenta tiene el bot PRENDIDO (botEnabled). Sin bot es
// no-op. No toca WhatsApp, ni el flujo actual del Chat App, ni la atribución.
import crypto from "node:crypto";
import { prisma } from "./prisma.js";
import { emitChat } from "./io.js";
import { casinoLiveForAccount, casinoCvuForAccount, ensureCasinoUser, casinoPlayerPassword } from "./casino-cashier.js"; // modelo B (auto-carga, key por cuenta)

// Usuario del jugador a partir de su nombre (apodo + dígitos), igual que el registro un-tap.
const nickSlug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "").slice(0, 12);
const randDigits = (n: number) => { let s = ""; for (let i = 0; i < n; i++) s += crypto.randomInt(0, 10); return s; };

// Mensaje del BOT hacia el jugador (se ve como mensaje entrante en su app). `buttons` = chips que el
// jugador puede tocar (cada uno manda su texto como si lo hubiera escrito).
async function botSay(accountId: string, convId: string, playerId: string, body: string, buttons?: string[], link?: { label: string; url: string }): Promise<void> {
  const meta: { bot: boolean; buttons?: string[]; link?: { label: string; url: string } } = { bot: true };
  if (buttons?.length) meta.buttons = buttons;
  if (link) meta.link = link;
  const msg = await prisma.chatMessage.create({
    data: { userId: accountId, conversationId: convId, senderType: "operator", senderId: null, body, metadata: meta },
    select: { id: true, senderType: true, body: true, createdAt: true },
  });
  await prisma.chatConversation.update({
    where: { id: convId },
    data: { lastMessageAt: new Date(), lastMessagePreview: body.slice(0, 120), unreadPlayer: { increment: 1 } },
  });
  const payload = { conversationId: convId, message: { ...msg, image: null, buttons: buttons ?? null, link: link ?? null } };
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
  const payload = { conversationId: convId, message: { ...msg, image: null, buttons: null } };
  emitChat(`chat:${accountId}`, "chat:message", payload);
}

const MENU = ["Cargar", "Retirar", "Cajero"];
const num = (s: string): number => { const m = s.replace(/[.,\s]/g, "").match(/\d+/); return m ? parseInt(m[0], 10) : NaN; };
const has = (t: string, ...words: string[]): boolean => words.some((w) => t.includes(w));

// Procesa el mensaje del jugador y (si corresponde) responde el bot. Se llama best-effort desde
// /api/chat/me/messages DESPUÉS de guardar/emitir el mensaje del jugador.
export async function runChatBot(accountId: string, convId: string, playerId: string, rawText: string): Promise<void> {
  const conv = await prisma.chatConversation.findUnique({
    where: { id: convId },
    select: { botStep: true, botAmount: true, player: { select: { casinoUsername: true, nombre: true } } },
  });
  if (!conv || conv.botStep === "human") return; // ya lo maneja un cajero

  // ---------- CHAT DIRECTO (entrada sin registro): el PRIMER mensaje del jugador es su NOMBRE ----------
  // Corre AUNQUE el bot general esté apagado: deja el nombre guardado, saluda y (si el bot está
  // prendido) muestra el menú. Los botones de cargar/retirar salen solos en la app (barra del cajero).
  if (conv.botStep === "ask_name") {
    const name = rawText.trim().slice(0, 40);
    if (name) await prisma.chatPlayer.update({ where: { id: playerId }, data: { nombre: name } }).catch(() => undefined);
    await prisma.chatConversation.update({ where: { id: convId }, data: { botStep: null } });
    // MODELO B: usamos el NOMBRE que escribió como base del usuario de ganamos (apodo + dígitos, en vez
    // del web###### random), lo creamos en ganamos y le devolvemos usuario + clave + link para jugar.
    if ((await casinoLiveForAccount(accountId)) && conv.player?.casinoUsername) {
      const base = nickSlug(name) || "user";
      let username = conv.player.casinoUsername;
      for (let i = 0; i < 6; i++) {
        const candidate = `${base}${randDigits(5)}`;
        try {
          await prisma.chatPlayer.update({ where: { id: playerId }, data: { casinoUsername: candidate, ...(name ? { nombre: name } : {}) } });
          username = candidate;
          break;
        } catch { /* choque userId+casinoUsername → reintentamos con otros dígitos */ }
      }
      await ensureCasinoUser(accountId, username).catch(() => undefined);
      const acc2 = await prisma.user.findUnique({ where: { id: accountId }, select: { chatPlatformUrl: true } });
      const url = acc2?.chatPlatformUrl?.trim();
      const link = url ? { label: "🎮 Entrar a jugar", url } : undefined;
      const body = `¡Listo${name ? `, ${name}` : ""}! 🎉 Tu cuenta para jugar:\n\n👤 Usuario: ${username}\n🔑 Clave: ${casinoPlayerPassword()}\n\n📌 Guardá estos datos: son los que te dejan volver a entrar si cerrás la app.\n\n¿Qué querés hacer? 👇`;
      await botSay(accountId, convId, playerId, body, undefined, link);
      return;
    }
    // Los botones "💰 Cargar fichas" / "💸 Retirar" salen solos en la barra del cajero (abajo).
    const greet = name ? `¡Genial, ${name}! ¿Qué querés hacer? 👇` : "¿Qué querés hacer? 👇";
    await botSay(accountId, convId, playerId, greet);
    return;
  }

  const acc = await prisma.user.findUnique({ where: { id: accountId }, select: { botEnabled: true, botPaymentInfo: true, botWelcome: true } });
  if (!acc?.botEnabled) return;

  const t = rawText.trim().toLowerCase();
  const playerName = conv.player?.casinoUsername ?? "jugador";
  const setStep = (botStep: string | null, botAmount?: number | null) =>
    prisma.chatConversation.update({ where: { id: convId }, data: { botStep, ...(botAmount !== undefined ? { botAmount } : {}) } });

  // Pedir cajero en CUALQUIER momento corta el bot y avisa.
  if (has(t, "cajero", "humano", "persona", "operador", "atencion", "atención") || t === "3") {
    await setStep("human");
    await botSay(accountId, convId, playerId, "Te paso con un cajero 👤. Aguardá un momento que te responden.");
    await alertCajero(accountId, convId, `🙋 ${playerName} pidió hablar con un cajero.`);
    return;
  }

  const step = conv.botStep;

  // ---------- CARGA ----------
  if (step === "carga_monto") {
    const amount = num(t);
    if (!amount || amount <= 0) { await botSay(accountId, convId, playerId, "No entendí el monto 🤔. Escribí solo el número, por ejemplo *5000*."); return; }
    // MODELO B (auto-carga ganamos): 1) crear el usuario en ganamos (si no la carga queda failed),
    // 2) mostrar el CVU de la recaudadora (del endpoint, no hardcodeado). El crédito lo dispara el
    // comprobante que sube el jugador (→ intent → callback). No usa "Ya pagué" ni al cajero.
    if ((await casinoLiveForAccount(accountId)) && conv.player?.casinoUsername) {
      // Pre-alta BEST-EFFORT: si el socio tarda/cuelga (alta Playwright a veces >30s) NO bloqueamos la
      // carga — el usuario casi siempre YA existe y sendDepositIntent lo re-registra al subir el
      // comprobante. Bloqueamos SOLO si el CVU falla (no habría a dónde transferir). El pre-alta caído se
      // avisa al cajero, no corta al jugador (antes esto trababa la carga → plata en limbo sin intent).
      const u = await ensureCasinoUser(accountId, conv.player.casinoUsername);
      const cvu = await casinoCvuForAccount(accountId);
      if (!cvu.ok) {
        await setStep(null, null);
        await botSay(accountId, convId, playerId, "En este momento no podemos procesar cargas 😔. Probá de nuevo en unos minutos.");
        await alertCajero(accountId, convId, `⚠️ La recaudadora no dio CVU (${cvu.errorCode ?? "error"}) — saturada o desactivada. Avisar a ganamos.`);
        return;
      }
      if (!u.ok) await alertCajero(accountId, convId, `⚠️ El alta de ${conv.player.casinoUsername} en el casino tardó/falló (${u.errorCode ?? "error"}). Mostré el CVU igual (el usuario suele ya existir); si esta carga no acredita sola, revisalo.`);
      await setStep(null, null);
      await botSay(
        accountId, convId, playerId,
        `Perfecto, cargás *$${amount}* ✅\n\nTransferí desde tu banco a:\n\n💳 CVU: *${cvu.cvu}*\n🏷️ Alias: *${cvu.alias}*\n👤 Titular: ${cvu.titular}\n\nCuando transfieras, subí el *comprobante* 📎 acá y te acreditamos las fichas solo 🚀`,
        ["Cajero"],
      );
      return;
    }
    // Semi-automático (sin modelo B): datos de pago manuales (botPaymentInfo) + aviso al cajero.
    await setStep("carga_pago", amount * 100);
    const pay = acc.botPaymentInfo?.trim() || "En un momento un cajero te pasa los datos de pago.";
    await botSay(accountId, convId, playerId, `Perfecto, cargás *$${amount}* ✅\n\nPagá así:\n${pay}\n\nCuando pagues, tocá *Ya pagué* y te acreditamos en minutos 🚀`, ["Ya pagué", "Cajero"]);
    return;
  }
  if (step === "carga_pago") {
    if (has(t, "pague", "pagué", "listo", "pago", "transferi", "transferí", "ya esta", "ya está", "hecho")) {
      const amount = (conv.botAmount ?? 0) / 100;
      await setStep(null, null);
      await botSay(accountId, convId, playerId, "¡Genial! 🙌 Un cajero está verificando tu pago y te acredita en unos minutos ⏳");
      await alertCajero(accountId, convId, `⚠️ CARGA PENDIENTE: $${amount} de ${playerName}. Verificá el pago y cargá los créditos.`);
      return;
    }
    await botSay(accountId, convId, playerId, "Cuando hayas pagado tocá *Ya pagué* y lo verificamos ✅.", ["Ya pagué", "Cajero"]);
    return;
  }

  // ---------- DESCARGA / RETIRO ----------
  if (step === "desc_monto") {
    const amount = num(t);
    if (!amount || amount <= 0) { await botSay(accountId, convId, playerId, "No entendí el monto 🤔. Escribí solo el número, por ejemplo *5000*."); return; }
    await setStep("desc_datos", amount * 100);
    await botSay(accountId, convId, playerId, `Perfecto, retirás *$${amount}* 💸\n\nPasame tus datos para el pago:\n*Alias o CBU* + *nombre del titular*.`);
    return;
  }
  if (step === "desc_datos") {
    const amount = (conv.botAmount ?? 0) / 100;
    await setStep(null, null);
    await botSay(accountId, convId, playerId, "¡Listo! 🙌 Un cajero está procesando tu retiro y te avisa en unos minutos ⏳");
    await alertCajero(accountId, convId, `💸 RETIRO PENDIENTE: $${amount} de ${playerName}.\nPagar a: ${rawText.trim()}`);
    return;
  }

  // ---------- SIN PASO ACTIVO: intención directa o menú ----------
  if (has(t, "cargar", "carga", "depositar", "deposito", "depósito", "meter") || t === "1") {
    await setStep("carga_monto");
    await botSay(accountId, convId, playerId, "¿Cuánto querés cargar? Escribí el monto 💰");
    return;
  }
  if (has(t, "retirar", "retiro", "descarga", "descargar", "cobrar", "sacar") || t === "2") {
    await setStep("desc_monto");
    await botSay(accountId, convId, playerId, "¿Cuánto querés retirar? Escribí el monto 💸");
    return;
  }

  const welcome = acc.botWelcome?.trim() ? acc.botWelcome.trim() + "\n\n" : "";
  await botSay(accountId, convId, playerId, `${welcome}¿Qué querés hacer? Tocá una opción 👇`, MENU);
}
