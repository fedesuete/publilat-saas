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
import { prisma } from "./prisma.js";
import { notify } from "./notifications.js";

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
