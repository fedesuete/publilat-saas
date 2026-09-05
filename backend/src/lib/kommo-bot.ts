// Bot de carga/descarga para el canal KOMMO. Mismo cerebro que el bot del Chat App hablando por otro
// caño: acá no podemos empujar mensajes — solo devolver UNA respuesta cuando el jugador escribe (el
// Salesbot de Kommo la entrega por WhatsApp). Estado en KommoBotState (por lead de Kommo).
//
// FLUJO "RAUL" (cuenta con casino conectado = modelo B, 100% automático sin cajero):
//   hola → el bot pide el NOMBRE COMPLETO (como figura en el banco; UNA vez, queda VINCULADO) →
//   crea el usuario del casino + entrega accesos + CVU de la recaudadora → el jugador transfiere lo
//   que quiera y manda el comprobante (acá la FOTO llega como placeholder, sin archivo — es solo la
//   señal de "ya pagué") → el bot pregunta cuánto transfirió → intent (titular vinculado + monto) →
//   la recaudadora confirma la PLATA REAL → acredita solo. Sin plata no hay fichas (§9.2 OK).
//   [Etapa 2, cuando el matcher del socio soporte vínculo sin monto: ni el número se pregunta.]
//
// SIN casino conectado: flujo semi-automático (menú → monto → botPaymentInfo → aviso al cajero).
import crypto from "node:crypto";
import { prisma } from "./prisma.js";
import { notify } from "./notifications.js";
import { casinoLiveForAccount, casinoCvuForAccount, ensureCasinoUser, casinoPlayerPassword, sendDepositIntent } from "./casino-cashier.js";

const num = (s: string): number => { const m = s.replace(/[.,\s]/g, "").match(/\d+/); return m ? parseInt(m[0], 10) : NaN; };
const has = (t: string, ...words: string[]): boolean => words.some((w) => t.includes(w));
const nickSlug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "").slice(0, 12);
// Placeholder con el que Kommo (WhatsApp Lite) entrega los mensajes con imagen/archivo.
const MULTIMEDIA_RE = /mensaje multimedia|multimedia message/i;

type St = { id: string; step: string | null; amountCents: number | null; casinoUsername: string | null; playerId: string | null; titular: string | null };

async function setStep(id: string, step: string | null, amountCents?: number | null): Promise<void> {
  await prisma.kommoBotState.update({
    where: { id },
    data: { step, ...(amountCents !== undefined ? { amountCents } : {}) },
  });
}

// Identidad del jugador en el casino: shadow ChatPlayer (para que la carga aparezca en el Cajero y el
// intent/CasinoTx tengan jugador). Username = apodo del nombre + dígitos (como el un-tap del Chat App).
async function ensureKommoPlayer(userId: string, st: St, name?: string): Promise<{ username: string; playerId: string }> {
  if (st.casinoUsername && st.playerId) return { username: st.casinoUsername, playerId: st.playerId };
  const base = nickSlug(name ?? "") || "user";
  for (let i = 0; i < 6; i++) {
    const username = `${base}${crypto.randomInt(1000, 9999)}`;
    try {
      const p = await prisma.chatPlayer.create({
        data: { userId, casinoUsername: username, nombre: name?.trim() || null, estatus: "active" },
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

const cvuBlock = (cvu: { cvu?: string | null; alias?: string | null; titular?: string | null }): string =>
  `💳 CVU: *${cvu.cvu}*\n🏷️ Alias: *${cvu.alias}*\n👤 Titular: ${cvu.titular}`;

// Procesa un mensaje entrante del canal Kommo y devuelve la respuesta del bot (o null = mudo).
export async function runKommoBot(userId: string, kommoLeadId: string, rawText: string): Promise<string | null> {
  const acc = await prisma.user.findUnique({
    where: { id: userId },
    select: { botEnabled: true, botWelcome: true, botPaymentInfo: true, brandName: true },
  });
  if (!acc) return null;

  const st = (await prisma.kommoBotState.upsert({
    where: { userId_kommoLeadId: { userId, kommoLeadId } },
    create: { userId, kommoLeadId },
    update: {},
  })) as St & { userId: string };

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
  if (has(t, "cajero", "humano", "persona", "operador", "atencion", "atención")) {
    await setStep(st.id, "human");
    void notify(userId, "system", "🙋 Piden un cajero (Kommo)", `El ${lead} pidió hablar con un cajero. Respondele desde Kommo.`);
    return "Te paso con un cajero 👤. Aguardá un momento que te responden.";
  }
  if (st.step === "human") return null; // lo maneja un humano: el bot se calla

  // ---------- RETIRO (igual en ambos modos: monto → datos → aviso) ----------
  if (st.step === "desc_monto") {
    const amount = num(t);
    if (!amount || amount <= 0) return "No entendí el monto 🤔. Escribí solo el número, por ejemplo *5000*.";
    await setStep(st.id, "desc_datos", amount * 100);
    return `Perfecto, retirás *$${amount}* 💸\n\nPasame tus datos para el pago:\n*Alias o CBU* + *nombre del titular*.`;
  }
  if (st.step === "desc_datos") {
    const amount = (st.amountCents ?? 0) / 100;
    await setStep(st.id, null, null);
    void notify(userId, "system", `💸 RETIRO PENDIENTE (Kommo): $${amount}`, `${lead}${st.casinoUsername ? ` · jugador ${st.casinoUsername}` : ""}. Pagar a: ${rawText.trim().slice(0, 200)}`);
    return "¡Listo! 🙌 Estamos procesando tu retiro y te avisamos en unos minutos ⏳";
  }

  // ══════════ MODO AUTOMÁTICO (casino conectado) — flujo "raul" ══════════
  if (await casinoLiveForAccount(userId)) {
    const marca = (acc.brandName ?? "").trim();

    // Paso 1 — VINCULACIÓN (una sola vez): nombre completo → usuario + accesos + CVU.
    if (!st.titular) {
      if (st.step !== "ask_name") {
        await setStep(st.id, "ask_name");
        const welcome = (acc.botWelcome ?? "").trim();
        return `${welcome || `¡Hola! 👋 Bienvenido${marca ? ` a ${marca}` : ""}.`}\n\nPara crearte el usuario decime tu *nombre completo* (como figura en tu cuenta del banco) 👇`;
      }
      if (isFoto) return "Primero decime tu *nombre completo* (como figura en tu banco) 🙌 — después mandás el comprobante.";
      const name = rawText.trim().replace(/\s+/g, " ").slice(0, 60);
      if (name.length < 3 || !/[a-záéíóúñ]/i.test(name) || /\d{4,}/.test(name)) {
        return "Decime tu *nombre y apellido* (como figura en el banco) 🙌";
      }
      try {
        const { username } = await ensureKommoPlayer(userId, st, name);
        await prisma.kommoBotState.update({ where: { id: st.id }, data: { titular: name, step: null } });
        st.titular = name;
        void ensureCasinoUser(userId, username).then((u) => {
          if (!u.ok) void notify(userId, "system", "⚠️ Alta en el casino tardó/falló", `El alta de ${username} falló (${u.errorCode ?? "error"}). Si su carga no acredita sola, revisala.`);
        }).catch(() => undefined);
        const first = name.split(" ")[0];
        const cvu = await casinoCvuForAccount(userId);
        const acceso = `¡Listo, ${first}! 🎉 Tu cuenta para jugar:\n\n👤 Usuario: *${username}*\n🔑 Clave: *${casinoPlayerPassword()}*\n\n📌 Guardá estos datos.`;
        if (!cvu.ok) {
          void notify(userId, "system", "⚠️ La recaudadora no dio CVU (Kommo)", `Error ${cvu.errorCode ?? "?"} — saturada o desactivada.`);
          return `${acceso}\n\nPara cargar, escribime *cargar* en unos minutos (estamos actualizando los datos de pago) 🙌`;
        }
        return `${acceso}\n\n💰 Para cargar, transferí *el monto que quieras* a:\n${cvuBlock(cvu)}\n\nCuando transfieras, mandame el *comprobante* 📎 y las fichas entran solas 🚀`;
      } catch {
        return "Uy, algo falló creando tu usuario 😔. Mandame tu *nombre completo* de nuevo.";
      }
    }

    // Paso 3 — dijo cuánto transfirió → intent (titular vinculado + monto) → acredita el callback.
    if (st.step === "carga_monto_confirm") {
      if (isFoto) return "¿Cuánto transferiste? Escribí *solo el número* 🙌 (ej: 5000)";
      const amount = num(t);
      if (!amount || amount <= 0) return "¿Cuánto transferiste? Escribí *solo el número* 🙌 (ej: 5000)";
      await setStep(st.id, null, null);
      if (!st.casinoUsername || !st.playerId) return "Algo salió mal con tu usuario 😔. Escribí *cargar* y lo rehacemos.";
      const dep = await prisma.chatDeposit.create({
        data: { userId, playerId: st.playerId, amount, currency: "ARS", method: "transferencia" },
        select: { id: true },
      });
      await sendDepositIntent(
        { id: dep.id, userId, playerId: st.playerId, amount, currency: "ARS" },
        st.casinoUsername,
        { senderName: st.titular, codigoOperacion: null },
      );
      void notify(userId, "system", `💰 Carga automática en curso (Kommo): $${amount}`, `Jugador ${st.casinoUsername} · titular "${st.titular}". Se acredita sola cuando impacte; si no impacta, revisala en el Cajero.`);
      return `¡Perfecto! *$${amount}* en verificación ✅\n\nNi bien impacte tu transferencia se acreditan las fichas *solas* 🚀\n\n👤 Tu usuario: *${st.casinoUsername}*`;
    }

    // Paso 2 — mandó el comprobante (o avisa que pagó) → preguntamos el monto.
    if (isFoto || has(t, "pague", "pagué", "transferi", "transferí", "comprobante", "ya esta", "ya está", "cargue", "cargué", "hecho", "listo")) {
      await setStep(st.id, "carga_monto_confirm");
      return "¡Recibido! 🙌 ¿Cuánto transferiste? Escribí *solo el número* (ej: 5000)";
    }

    // Pide los datos de pago de nuevo.
    if (has(t, "cargar", "carga", "cargame", "cvu", "alias", "depositar", "deposito", "depósito", "meter", "datos") || t === "1") {
      const cvu = await casinoCvuForAccount(userId);
      if (!cvu.ok) {
        void notify(userId, "system", "⚠️ La recaudadora no dio CVU (Kommo)", `Error ${cvu.errorCode ?? "?"}.`);
        return "En este momento no puedo darte los datos 😔. Probá de nuevo en unos minutos.";
      }
      return `💰 Transferí *el monto que quieras* a:\n${cvuBlock(cvu)}\n\nDespués mandame el *comprobante* 📎 y las fichas entran solas 🚀`;
    }
    if (has(t, "retirar", "retiro", "descarga", "descargar", "cobrar", "sacar") || t === "2") {
      await setStep(st.id, "desc_monto");
      return "¿Cuánto querés retirar? Escribí el monto 💸";
    }

    // Guía corta para cualquier otra cosa.
    return `¿Qué necesitás? 👇\n\n💰 Para cargar: escribí *cargar* (te paso los datos) y después mandá el *comprobante* 📎\n💸 Para sacar: *retirar*\n🙋 ¿Un humano?: *cajero*`;
  }

  // ══════════ MODO SEMI-AUTOMÁTICO (sin casino conectado) ══════════
  if (st.step === "carga_monto") {
    const amount = num(t);
    if (!amount || amount <= 0) return "No entendí el monto 🤔. Escribí solo el número, por ejemplo *5000*.";
    await setStep(st.id, "carga_pago", amount * 100);
    const pay = acc.botPaymentInfo?.trim() || "En un momento un cajero te pasa los datos de pago.";
    return `Perfecto, cargás *$${amount}* ✅\n\nPagá así:\n${pay}\n\nCuando pagues, mandá la *foto del comprobante* 📎 acá y te acreditamos en minutos 🚀`;
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
  if (has(t, "cargar", "carga", "cargame", "cárgame", "depositar", "deposito", "depósito", "meter") || t === "1") {
    await setStep(st.id, "carga_monto");
    return "¿Cuánto querés cargar? Escribí el monto 💰";
  }
  if (has(t, "retirar", "retiro", "descarga", "descargar", "cobrar", "sacar") || t === "2") {
    await setStep(st.id, "desc_monto");
    return "¿Cuánto querés retirar? Escribí el monto 💸";
  }
  if (isFoto) {
    void notify(userId, "system", "📎 Foto recibida (Kommo)", `El ${lead} mandó una imagen — miralo en Kommo.`);
    return "¡Recibido! 📎 Un cajero lo revisa y te responde en un momento.";
  }
  const welcome = acc.botWelcome?.trim() ? acc.botWelcome.trim() + "\n\n" : "";
  return `${welcome}¿Qué querés hacer? 👇\n\n*1* 💰 Cargar\n*2* 💸 Retirar\n🙋 ¿Un humano?: escribí *cajero*`;
}
