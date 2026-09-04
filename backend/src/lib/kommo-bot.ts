// Bot de carga/descarga para el canal KOMMO (Fase 1, semi-automático). Es el MISMO flujo del bot del
// Chat App (lib/chat-bot.ts) hablando por otro caño: acá no podemos empujar mensajes — solo devolver
// UNA respuesta cuando el jugador escribe (el Salesbot de Kommo la entrega por WhatsApp). Por eso el
// estado vive en KommoBotState (por lead de Kommo) y los avisos al cajero van por la campanita
// (Notification) + el espejo del chat que ya cae al Inbox.
//
// LÍMITES del canal (verificados):
//  - Las FOTOS llegan como texto placeholder ("Recibiste un mensaje multimedia (id: ...)"), SIN el
//    archivo → acá no hay lectura IA del comprobante; el cajero lo mira en Kommo y aprueba.
//  - Regla dura §9.2: NUNCA acreditar fichas automático por un comprobante. El bot junta monto+aviso;
//    acredita el cajero (o la recaudadora en Fase 3).
// Fase 2 (socio): creación de usuario ganamos (ensureCasinoUser) + autocarga vía CasinoTx cuando la
// cuenta tenga su casinoApiKey.
import crypto from "node:crypto";
import { prisma } from "./prisma.js";
import { notify } from "./notifications.js";
import { casinoLiveForAccount, casinoCvuForAccount, ensureCasinoUser, casinoPlayerPassword, sendDepositIntent } from "./casino-cashier.js";

const num = (s: string): number => { const m = s.replace(/[.,\s]/g, "").match(/\d+/); return m ? parseInt(m[0], 10) : NaN; };
const has = (t: string, ...words: string[]): boolean => words.some((w) => t.includes(w));
// Placeholder con el que Kommo (WhatsApp Lite) entrega los mensajes con imagen/archivo.
const MULTIMEDIA_RE = /mensaje multimedia|multimedia message/i;

async function setStep(id: string, step: string | null, amountCents?: number | null): Promise<void> {
  await prisma.kommoBotState.update({
    where: { id },
    data: { step, ...(amountCents !== undefined ? { amountCents } : {}) },
  });
}

// Identidad del jugador en el casino para este chat de Kommo: shadow ChatPlayer (así la carga aparece
// en el Cajero del panel y el intent/CasinoTx tienen jugador). Username autogenerado (user+dígitos),
// misma clave por defecto que el un-tap. Idempotente: si ya existe en el estado, lo reusa.
async function ensureKommoPlayer(
  userId: string,
  st: { id: string; casinoUsername: string | null; playerId: string | null },
): Promise<{ username: string; playerId: string }> {
  if (st.casinoUsername && st.playerId) return { username: st.casinoUsername, playerId: st.playerId };
  for (let i = 0; i < 6; i++) {
    const username = `user${crypto.randomInt(10000, 99999)}`;
    try {
      const p = await prisma.chatPlayer.create({
        data: { userId, casinoUsername: username, estatus: "active" },
        select: { id: true },
      });
      await prisma.kommoBotState.update({ where: { id: st.id }, data: { casinoUsername: username, playerId: p.id } });
      st.casinoUsername = username;
      st.playerId = p.id;
      return { username, playerId: p.id };
    } catch { /* choque userId+casinoUsername → probamos otros dígitos */ }
  }
  throw new Error("no se pudo generar el usuario del casino");
}

// Procesa un mensaje entrante del canal Kommo y devuelve la respuesta del bot (o null = mudo).
export async function runKommoBot(userId: string, kommoLeadId: string, rawText: string): Promise<string | null> {
  const acc = await prisma.user.findUnique({
    where: { id: userId },
    select: { botEnabled: true, botWelcome: true, botPaymentInfo: true, brandName: true },
  });
  if (!acc) return null;

  const st = await prisma.kommoBotState.upsert({
    where: { userId_kommoLeadId: { userId, kommoLeadId } },
    create: { userId, kommoLeadId },
    update: {},
  });

  // Bot APAGADO: saludo de cortesía UNA sola vez por conversación (no spamear cada mensaje).
  if (!acc.botEnabled) {
    if (st.step === "welcomed") return null;
    await setStep(st.id, "welcomed");
    const marca = (acc.brandName ?? "").trim();
    return (acc.botWelcome ?? "").trim() || `¡Hola! 👋 Gracias por escribir${marca ? ` a ${marca}` : ""}. Ya te atendemos por acá.`;
  }

  const t = rawText.trim().toLowerCase();
  const isFoto = MULTIMEDIA_RE.test(rawText);
  const lead = `lead ${kommoLeadId}`;

  // Pedir cajero en CUALQUIER momento corta el bot y avisa (se responde a mano DESDE KOMMO).
  if (has(t, "cajero", "humano", "persona", "operador", "atencion", "atención") || t === "3") {
    await setStep(st.id, "human");
    void notify(userId, "system", "🙋 Piden un cajero (Kommo)", `El ${lead} pidió hablar con un cajero. Respondele desde Kommo.`);
    return "Te paso con un cajero 👤. Aguardá un momento que te responden.";
  }
  if (st.step === "human") return null; // lo maneja un humano: el bot se calla

  // ---------- CARGA ----------
  if (st.step === "carga_monto") {
    const amount = num(t);
    if (!amount || amount <= 0) return "No entendí el monto 🤔. Escribí solo el número, por ejemplo *5000*.";

    // MODELO B (cuenta con casino conectado): 100% automático, SIN cajero. El bot crea el usuario en
    // el casino, muestra el CVU de la recaudadora y pide el NOMBRE del titular que transfiere — con
    // nombre+monto ganamos matchea la transferencia REAL (webhook) y acredita solo (§9.2 OK: acredita
    // la plata confirmada, no una foto — acá ni siquiera vemos la foto).
    if (await casinoLiveForAccount(userId)) {
      try {
        const { username } = await ensureKommoPlayer(userId, st);
        void ensureCasinoUser(userId, username).then((u) => {
          if (!u.ok) void notify(userId, "system", "⚠️ Alta en el casino tardó/falló", `El alta de ${username} falló (${u.errorCode ?? "error"}). Si la carga no acredita sola, revisala.`);
        }).catch(() => undefined);
        const cvu = await casinoCvuForAccount(userId);
        if (!cvu.ok) {
          await setStep(st.id, null, null);
          void notify(userId, "system", "⚠️ La recaudadora no dio CVU (Kommo)", `Error ${cvu.errorCode ?? "?"} — saturada o desactivada. Avisar al casino.`);
          return "En este momento no podemos procesar cargas 😔. Probá de nuevo en unos minutos.";
        }
        await setStep(st.id, "carga_nombre", amount * 100);
        return `Perfecto, cargás *$${amount}* ✅\n\n🎰 Tu cuenta para jugar:\n👤 Usuario: *${username}*\n🔑 Clave: *${casinoPlayerPassword()}*\n\nTransferí desde tu banco a:\n💳 CVU: *${cvu.cvu}*\n🏷️ Alias: *${cvu.alias}*\n👤 Titular: ${cvu.titular}\n\nCuando transfieras, escribime el *nombre del titular* de la cuenta desde la que mandaste la plata (así te acreditamos al instante) 🚀`;
      } catch {
        // si algo del casino falla, caemos al flujo semi-automático de siempre
      }
    }

    // SEMI-AUTOMÁTICO (sin casino conectado): datos de pago manuales + aviso al cajero.
    await setStep(st.id, "carga_pago", amount * 100);
    const pay = acc.botPaymentInfo?.trim() || "En un momento un cajero te pasa los datos de pago.";
    return `Perfecto, cargás *$${amount}* ✅\n\nPagá así:\n${pay}\n\nCuando pagues, mandá la *foto del comprobante* 📎 acá y te acreditamos en minutos 🚀`;
  }
  // MODELO B: esperando el nombre del titular que transfirió → intent a ganamos → acredita el callback.
  if (st.step === "carga_nombre") {
    if (isFoto) return "¡Recibido! 📎 Para acreditarte al instante, *escribime el nombre del titular* de la cuenta que hizo la transferencia 👇";
    const senderName = rawText.trim().replace(/\s+/g, " ").slice(0, 80);
    if (senderName.length < 3 || !/[a-záéíóúñ]/i.test(senderName)) {
      return "Pasame el *nombre y apellido del titular* de la cuenta que transfirió (como figura en el banco) 🙌";
    }
    const amount = (st.amountCents ?? 0) / 100;
    await setStep(st.id, null, null);
    if (!st.casinoUsername || !st.playerId) return "Algo salió mal con tu usuario 😔. Escribí *cargar* de nuevo y lo rehacemos.";
    const dep = await prisma.chatDeposit.create({
      data: { userId, playerId: st.playerId, amount, currency: "ARS", method: "transferencia" },
      select: { id: true },
    });
    await sendDepositIntent(
      { id: dep.id, userId, playerId: st.playerId, amount, currency: "ARS" },
      st.casinoUsername,
      { senderName, codigoOperacion: null },
    );
    void notify(userId, "system", `💰 Carga automática en curso (Kommo): $${amount}`, `Jugador ${st.casinoUsername} · titular "${senderName}". Se acredita sola cuando impacte la transferencia; si no impacta, revisala en el Cajero.`);
    return `¡Listo! 🙌 Ni bien impacte tu transferencia se acreditan las fichas solas 🚀\n\nRecordá tus datos:\n👤 Usuario: *${st.casinoUsername}*\n🔑 Clave: *${casinoPlayerPassword()}*\n\nCualquier cosa escribí *cajero* 👤`;
  }
  if (st.step === "carga_pago") {
    if (isFoto || has(t, "pague", "pagué", "listo", "pago", "transferi", "transferí", "ya esta", "ya está", "hecho")) {
      const amount = (st.amountCents ?? 0) / 100;
      await setStep(st.id, null, null);
      void notify(
        userId, "system",
        `⚠️ CARGA PENDIENTE (Kommo): $${amount}`,
        `${lead}: ${isFoto ? "mandó el comprobante — miralo en Kommo" : "dice que ya pagó"}. Verificá el pago y cargale las fichas.`,
      );
      return "¡Genial! 🙌 Un cajero está verificando tu pago y te acredita en unos minutos ⏳";
    }
    return "Cuando pagues, mandá la *foto del comprobante* 📎 acá y lo verificamos ✅";
  }

  // ---------- DESCARGA / RETIRO ----------
  if (st.step === "desc_monto") {
    const amount = num(t);
    if (!amount || amount <= 0) return "No entendí el monto 🤔. Escribí solo el número, por ejemplo *5000*.";
    await setStep(st.id, "desc_datos", amount * 100);
    return `Perfecto, retirás *$${amount}* 💸\n\nPasame tus datos para el pago:\n*Alias o CBU* + *nombre del titular*.`;
  }
  if (st.step === "desc_datos") {
    const amount = (st.amountCents ?? 0) / 100;
    await setStep(st.id, null, null);
    void notify(userId, "system", `💸 RETIRO PENDIENTE (Kommo): $${amount}`, `${lead}. Pagar a: ${rawText.trim().slice(0, 200)}`);
    return "¡Listo! 🙌 Un cajero está procesando tu retiro y te avisa en unos minutos ⏳";
  }

  // ---------- SIN PASO ACTIVO: intención directa o menú ----------
  if (has(t, "cargar", "carga", "cargame", "cárgame", "depositar", "deposito", "depósito", "meter") || t === "1") {
    await setStep(st.id, "carga_monto");
    return "¿Cuánto querés cargar? Escribí el monto 💰";
  }
  if (has(t, "retirar", "retiro", "descarga", "descargar", "cobrar", "sacar") || t === "2") {
    await setStep(st.id, "desc_monto");
    return "¿Cuánto querés retirar? Escribí el monto 💸";
  }
  if (isFoto) {
    // Foto fuera del flujo de carga: probable comprobante suelto → avisar igual.
    void notify(userId, "system", "📎 Foto recibida (Kommo)", `El ${lead} mandó una imagen — miralo en Kommo.`);
    return "¡Recibido! 📎 Un cajero lo revisa y te responde en un momento.";
  }

  const welcome = acc.botWelcome?.trim() ? acc.botWelcome.trim() + "\n\n" : "";
  return `${welcome}¿Qué querés hacer? 👇\n\n*1* 💰 Cargar\n*2* 💸 Retirar\n*3* 🙋 Hablar con un cajero`;
}
