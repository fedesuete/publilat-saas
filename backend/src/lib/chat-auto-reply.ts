// Respuestas automáticas por palabra clave del Chat App.
//
// Pedido de un operador (2026-09-30): "que detecte palabras clave y mande el alias", como las
// automatizaciones de WhatsApp pero adentro del Chat App. El motor de flujos de WhatsApp está atado a
// los contactos de WhatsApp (no sirve acá), y lo que se necesita es mucho más simple: si el jugador
// escribe algo que contiene una palabra clave, el bot contesta con el texto configurado. Funciona con
// el bot de carga APAGADO: es independiente.
//
// Este archivo es puro (sin base ni red) para poder testear el matching; lo usa lib/chat-bot.ts.

export interface ReglaAuto {
  keywords: string[];
  reply: string;
}

export const MAX_REGLAS = 30;
export const MAX_KEYWORDS = 10;

/** Normaliza para comparar: minúsculas y sin tildes, así "depósito" matchea "deposito". */
export function normalizar(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

/**
 * Lee las reglas guardadas (JSON de la cuenta). Tolerante: ignora lo que no tenga forma de regla,
 * recorta lo que se pase de largo. Nunca tira: una config rota no puede tumbar el bot.
 */
export function parseReglas(raw: unknown): ReglaAuto[] {
  if (!Array.isArray(raw)) return [];
  const out: ReglaAuto[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const kws = Array.isArray(o.keywords)
      ? o.keywords.filter((k): k is string => typeof k === "string").map((k) => k.trim()).filter(Boolean).slice(0, MAX_KEYWORDS)
      : [];
    const reply = typeof o.reply === "string" ? o.reply.trim() : "";
    if (!kws.length || !reply) continue;
    out.push({ keywords: kws, reply });
    if (out.length >= MAX_REGLAS) break;
  }
  return out;
}

/**
 * La respuesta para un mensaje del jugador, o null si ninguna regla aplica. Gana la PRIMERA regla en
 * orden (el operador las ordena como quiere). "Contiene", no "igual": "hola quiero el alias" matchea
 * la palabra "alias".
 */
export function elegirRespuesta(texto: string | null | undefined, reglas: ReglaAuto[]): string | null {
  const t = normalizar(texto ?? "");
  if (!t) return null;
  for (const r of reglas) {
    if (r.keywords.some((k) => { const n = normalizar(k); return n.length > 0 && t.includes(n); })) return r.reply;
  }
  return null;
}
