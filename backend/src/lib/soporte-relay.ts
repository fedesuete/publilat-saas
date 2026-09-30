// Relay de soporte: todo lo que llega al número de soporte cae en UN grupo del equipo (SOPORTE), y
// desde ese grupo se le contesta al cliente con "B- mensaje". Hacia afuera parece un empleado de
// soporte que responde al instante; adentro son dos personas mirando un solo grupo.
//
// Cómo está montado el número de soporte (2026-09-29): está metido en el grupo de WhatsApp de CADA
// cliente (Bet17, Net cw, Ganaencasa…). Ahí es donde el cliente tira el comprobante de la carga o
// pregunta algo. Este módulo:
//   1. Lo reenvía al grupo SOPORTE con nombre del grupo, quién escribió y un código corto y fijo del
//      cliente. Si es una imagen (comprobante), la baja y la vuelve a mandar como imagen.
//   2. Le contesta al cliente en SU grupo, al toque: "estamos procesando tu carga/consulta". Una vez
//      cada tanto por grupo, no por cada mensaje, o parecería un robot.
//   3. Cuando alguien del equipo responde en SOPORTE citando la consulta y empezando con "B-", el
//      texto sale al grupo del cliente desde el número de soporte. Sin cita no sabemos a quién va:
//      se avisa en SOPORTE en vez de mandarle a cualquiera.
//
// Cómo llegan los eventos SIN tocar el webhook principal (§9.6): la sesión de WAHA acepta varios
// webhooks. A la sesión del número de soporte se le agrega un SEGUNDO webhook que apunta a
// routes/soporte-wa.ts. El webhook de siempre sigue recibiendo lo mismo y sigue descartando los grupos
// como hasta ahora: este módulo no está en el medio de nada, es un oyente aparte. Si se cae, no
// afecta a WhatsApp, al Inbox ni a la atribución.
//
// Los chats 1 a 1 con el número de soporte NO entran por acá: los toma relayConsultas() leyendo la
// tabla Message (que el webhook ya llena). Así ningún mensaje se reenvía dos veces.
import axios from "axios";
import { prisma } from "./prisma.js";
import { getEngine } from "./wa-engine.js";
import { sendToContact } from "./wa-send.js";
import { downloadWahaMedia } from "./waha.js";

/** Cada cuánto se le puede repetir el acuse al MISMO cliente (1 a 1). Si escribe 5 veces, recibe uno. */
const ACK_MS = Number(process.env.SOPORTE_ACK_HORAS ?? "6") * 3600_000;
/** En un GRUPO de cliente hay más gente y más tráfico: el acuse se repite más seguido, pero no siempre. */
const ACK_GRUPO_MS = Number(process.env.SOPORTE_ACK_GRUPO_MIN ?? "10") * 60_000;
/** Hasta qué antigüedad se reenvía (1 a 1). Evita volcar el historial al grupo al prender el relay. */
const VENTANA_MIN = Number(process.env.SOPORTE_RELAY_VENTANA_MIN ?? "30");
/** Tope por corrida: si entra una avalancha, se reparte entre vueltas en vez de inundar el grupo. */
const MAX_POR_VUELTA = Number(process.env.SOPORTE_RELAY_MAX ?? "20");

export const ACK_POR_DEFECTO = "👋 ¡Hola! Recibimos tu consulta y ya la estamos viendo. En un momento te responde alguien del equipo.";
export const ACK_CARGA = "✅ Recibido. Estamos procesando tu carga, en un momento te confirmamos.";
export const ACK_CONSULTA = "👋 Recibido. Estamos procesando tu consulta, en un momento te respondemos.";

const WAHA_BASE = (process.env.WAHA_BASE_URL ?? "http://localhost:3001").replace(/\/$/, "");
const WAHA_KEY = process.env.WAHA_API_KEY ?? "";
const waha = () => axios.create({ baseURL: WAHA_BASE, headers: { "X-Api-Key": WAHA_KEY, "Content-Type": "application/json" }, timeout: 30_000 });

/** Código corto y legible por teléfono. Sin vocales: no salen palabras raras. */
const ALFABETO = "ACDEFGHJKLMNPQRSTUVWXYZ23456789";
function codigoNuevo(): string {
  let s = "";
  for (let i = 0; i < 3; i++) s += ALFABETO[Math.floor(Math.random() * ALFABETO.length)];
  return s;
}

type Hilo = { id: string; code: string; lastAckAt: Date | null; groupJid: string | null };
const HILO = { id: true, code: true, lastAckAt: true, groupJid: true } as const;

/** El hilo de soporte del contacto (1 a 1). Lo crea si es la primera vez; el código es estable. */
export async function hiloDe(userId: string, contactId: string): Promise<Hilo> {
  const existente = await prisma.supportThread.findUnique({ where: { contactId }, select: HILO });
  if (existente) return existente;
  for (let i = 0; i < 12; i++) {
    try {
      return await prisma.supportThread.create({ data: { userId, contactId, code: codigoNuevo() }, select: HILO });
    } catch {
      const yaEsta = await prisma.supportThread.findUnique({ where: { contactId }, select: HILO });
      if (yaEsta) return yaEsta; // carrera: lo creó otra corrida
      // código repetido: reintenta con otro
    }
  }
  throw new Error("no se pudo crear el hilo de soporte");
}

/** El hilo de soporte de un GRUPO de cliente. Mismo código para siempre, aunque cambie el nombre. */
export async function hiloDeGrupo(userId: string, groupJid: string, groupName: string): Promise<Hilo> {
  const existente = await prisma.supportThread.findUnique({ where: { groupJid }, select: HILO });
  if (existente) return existente;
  for (let i = 0; i < 12; i++) {
    try {
      return await prisma.supportThread.create({
        data: { userId, groupJid, groupName: groupName.slice(0, 120) || null, code: codigoNuevo() },
        select: HILO,
      });
    } catch {
      const yaEsta = await prisma.supportThread.findUnique({ where: { groupJid }, select: HILO });
      if (yaEsta) return yaEsta;
    }
  }
  throw new Error("no se pudo crear el hilo del grupo");
}

/** Teléfono legible para que en el grupo se pueda copiar y llamar. */
export function telefonoLegible(phone: string | null | undefined): string {
  const d = (phone ?? "").replace(/\D/g, "");
  return d ? `+${d}` : "sin teléfono";
}

export interface Consulta {
  code: string;
  nombre: string;
  phone: string | null;
  texto: string;
  esImagen: boolean;
}

/** Lo que se deja en SOPORTE por una consulta 1 a 1. Aparte para poder testearlo sin red ni base. */
export function textoParaGrupo(c: Consulta): string {
  const quien = c.nombre || telefonoLegible(c.phone);
  const cuerpo = c.texto.trim() || (c.esImagen ? "(mandó una imagen)" : "(mensaje vacío)");
  return [
    `🆕 #${c.code} · ${quien}`,
    telefonoLegible(c.phone),
    "",
    cuerpo,
    "",
    "↩️ Para contestarle: respondé ESTE mensaje citándolo y empezá con B-",
  ].join("\n");
}

export interface ConsultaDeGrupo {
  code: string;
  grupo: string; // nombre del grupo del cliente
  quien: string; // quién escribió (nombre de WhatsApp o teléfono)
  texto: string;
  esImagen: boolean;
}

/** Lo que se deja en SOPORTE por un mensaje en un GRUPO de cliente (texto o caption de la imagen). */
export function textoDesdeGrupo(c: ConsultaDeGrupo): string {
  const cuerpo = c.texto.trim() || (c.esImagen ? "(comprobante sin texto)" : "(mensaje vacío)");
  return [
    `🆕 #${c.code} · ${c.grupo}`,
    `👤 ${c.quien}`,
    "",
    cuerpo,
    "",
    "↩️ Para contestarle en su grupo: respondé ESTE mensaje citándolo y empezá con B-",
  ].join("\n");
}

/**
 * ¿Es una orden "B- mensaje" para el bot? Acepta B-, b-, "B -", "B–" y espacios de más.
 * Devuelve el texto que hay que mandarle al cliente, o null si no es una orden.
 */
export function parseComando(texto: string | null | undefined): string | null {
  const m = /^\s*[bB]\s*[-–—]\s*([\s\S]+)$/.exec(texto ?? "");
  if (!m) return null;
  const cuerpo = m[1].trim();
  return cuerpo || null;
}

/** Cola del id de WhatsApp: "true_123@g.us_ABC" → "ABC". Los ids llegan en las dos formas. */
export function idCola(id: string | null | undefined): string {
  const s = String(id ?? "");
  return s.includes("_") ? s.split("_").pop()! : s;
}

/** Id del mensaje CITADO en un payload de WAHA/NOWEB, mirando en los lugares donde puede venir. */
export function idCitado(p: Record<string, any> | null | undefined): string | null {
  if (!p) return null;
  const r = p.replyTo;
  if (typeof r === "string" && r) return idCola(r);
  if (r && typeof r === "object" && typeof r.id === "string" && r.id) return idCola(r.id);
  const msg = p._data?.message ?? {};
  for (const k of Object.keys(msg)) {
    const st = msg[k]?.contextInfo?.stanzaId;
    if (typeof st === "string" && st) return idCola(st);
  }
  return null;
}

/** Sesión de WAHA de la línea por la que entró la consulta (para mandar al grupo desde ese número). */
async function sesionDe(lineId: string | null): Promise<string | null> {
  if (!lineId) return null;
  const l = await prisma.waLine.findUnique({ where: { id: lineId }, select: { id: true, sessionId: true } });
  return l ? (l.sessionId ?? `line_${l.id}`) : null;
}

const sentId = (data: any): string | undefined => {
  const x = data?.id ?? data?.key;
  return x?._serialized ?? (typeof x === "string" ? x : x?.id) ?? undefined;
};

/** Imagen a un chat/grupo por la API de WAHA (NOWEB no sabe reenviar: se baja y se vuelve a mandar). */
async function enviarImagen(session: string, chatId: string, base64: string, mimetype: string, caption: string): Promise<string | undefined> {
  const ext = mimetype.includes("png") ? "png" : mimetype.includes("webp") ? "webp" : "jpg";
  const { data } = await waha().post("/api/sendImage", {
    session, chatId, caption,
    file: { mimetype, filename: `comprobante.${ext}`, data: base64 },
  });
  return sentId(data);
}

/** Texto a un chat/grupo, opcionalmente CITANDO un mensaje (reply_to). */
async function enviarTexto(session: string, chatId: string, text: string, replyTo?: string): Promise<string | undefined> {
  if (!replyTo) {
    const r = await getEngine().sendText(session, chatId, text);
    return r?.key?.id ?? sentId(r);
  }
  const { data } = await waha().post("/api/sendText", { session, chatId, text, reply_to: replyTo });
  return sentId(data);
}

// ============================ 1 a 1: chats directos con el número de soporte ============================

/**
 * Reenvía a SOPORTE las consultas 1 a 1 nuevas y le avisa al cliente. Devuelve cuántas movió.
 * Idempotente: SupportRelayMsg.messageId es único, así que un mensaje se reenvía UNA sola vez
 * aunque el job se solape consigo mismo.
 */
export async function relayConsultas(): Promise<number> {
  const cuentas = await prisma.user.findMany({
    where: { supportRelayEnabled: true, supportGroupId: { not: null } },
    select: { id: true, supportGroupId: true, supportAckText: true },
  });
  if (!cuentas.length) return 0;

  let movidas = 0;
  const desde = new Date(Date.now() - VENTANA_MIN * 60_000);

  for (const cuenta of cuentas) {
    const candidatos = await prisma.message.findMany({
      where: { direction: "in", createdAt: { gte: desde }, contact: { userId: cuenta.id } },
      orderBy: { createdAt: "asc" },
      take: 200,
      select: {
        id: true, body: true, mediaType: true, lineId: true, createdAt: true,
        contact: { select: { id: true, name: true, phone: true } },
      },
    });
    // Sacar los ya reenviados ANTES de cortar por el tope. Si se cortaba primero, bastaban 20
    // mensajes viejos dentro de la ventana para que los nuevos no salieran nunca.
    const yaEstan = new Set(
      (await prisma.supportRelayMsg.findMany({
        where: { messageId: { in: candidatos.map((c) => c.id) } },
        select: { messageId: true },
      })).map((r) => r.messageId),
    );
    const nuevos = candidatos.filter((c) => !yaEstan.has(c.id)).slice(0, MAX_POR_VUELTA);

    for (const m of nuevos) {
      const hilo = await hiloDe(cuenta.id, m.contact.id);

      // CANDADO: si este mensaje ya se reenvió, el unique choca y seguimos de largo.
      try {
        await prisma.supportRelayMsg.create({ data: { messageId: m.id, threadId: hilo.id } });
      } catch {
        continue;
      }

      const sesion = await sesionDe(m.lineId);
      if (!sesion) continue; // sin línea no hay por dónde escribir

      const texto = textoParaGrupo({
        code: hilo.code,
        nombre: m.contact.name ?? "",
        phone: m.contact.phone,
        texto: m.body ?? "",
        esImagen: Boolean(m.mediaType),
      });

      try {
        const groupMsgId = await enviarTexto(sesion, cuenta.supportGroupId!, texto);
        if (groupMsgId) await prisma.supportRelayMsg.update({ where: { messageId: m.id }, data: { groupMsgId } });
        movidas++;
      } catch (e) {
        // No pudo entrar al grupo: soltamos el candado para reintentar en la próxima vuelta.
        await prisma.supportRelayMsg.deleteMany({ where: { messageId: m.id } });
        console.error("[soporte] no se pudo dejar la consulta en el grupo:", e instanceof Error ? e.message : String(e));
        continue;
      }

      // Acuse al cliente: UNA vez cada ACK_MS. Sin esto le contesta un robot en cada mensaje.
      const ahora = Date.now();
      if (!hilo.lastAckAt || ahora - hilo.lastAckAt.getTime() >= ACK_MS) {
        const ok = await sendToContact(cuenta.id, m.contact.id, cuenta.supportAckText?.trim() || ACK_POR_DEFECTO).catch(() => false);
        if (ok) await prisma.supportThread.update({ where: { id: hilo.id }, data: { lastAckAt: new Date(ahora) } });
      }
    }
  }
  return movidas;
}

// ============================ GRUPOS: lo que llega por el segundo webhook ============================

type Cuenta = { id: string; supportGroupId: string; supportIgnoreGroups: unknown; supportTeamNumbers: unknown };

// ============================ Quién es del EQUIPO ============================
// Solo lo que escribe el CLIENTE se relayea. Lo que escribe el equipo desde sus propios teléfonos en el
// grupo de un cliente no va a SOPORTE ni recibe acuse (2026-09-30: Emi contestaba en Ganaencasavip y el
// relay lo reenviaba y le agradecía como si fuera un cliente). Equipo = miembros del grupo SOPORTE
// (detectados solos, por LID y por teléfono: WhatsApp manda los remitentes de las dos formas) + los
// números cargados a mano en User.supportTeamNumbers.
const EQUIPO_TTL_MS = 5 * 60_000;
const equipoCache = new Map<string, { at: number; ids: Set<string> }>();

/** Id comparable: un LID queda como "…@lid" en minúsculas; un teléfono, solo dígitos. */
export function normalizarId(x: unknown): string | null {
  if (typeof x !== "string" || !x.trim()) return null;
  const s = x.trim();
  if (s.toLowerCase().endsWith("@lid")) return s.toLowerCase();
  const d = s.split("@")[0].replace(/\D/g, "");
  return d.length >= 6 ? d : null;
}

/** Todas las identidades con las que viene el remitente de un mensaje de grupo (LID y/o teléfono). */
export function remitenteDe(p: Record<string, any> | null | undefined): string[] {
  if (!p) return [];
  const rk = p._data?.key ?? {};
  const cand = [p.participant, p.author, rk.participant, rk.participantPn, rk.senderPn, rk.participantAlt, rk.senderAlt, p.participantPn, p.senderPn];
  const out = new Set<string>();
  for (const c of cand) { const n = normalizarId(typeof c === "string" ? c : c?._serialized); if (n) out.add(n); }
  return [...out];
}

export function esDelEquipo(remitente: string[], equipo: Set<string>): boolean {
  return remitente.some((r) => equipo.has(r));
}

/** Ids (LID + teléfono) de los miembros del grupo SOPORTE + los cargados a mano. Caché 5 min por sesión. */
async function equipoDe(session: string, cuenta: Cuenta): Promise<Set<string>> {
  const key = `${session}:${cuenta.supportGroupId}`;
  const c = equipoCache.get(key);
  if (c && Date.now() - c.at < EQUIPO_TTL_MS) return c.ids;
  const ids = new Set<string>();
  for (const n of Array.isArray(cuenta.supportTeamNumbers) ? cuenta.supportTeamNumbers : []) { const x = normalizarId(n); if (x) ids.add(x); }
  try {
    // La lista completa de grupos (probada en prod); el endpoint de un grupo solo no está verificado.
    const { data } = await waha().get(`/api/${encodeURIComponent(session)}/groups`);
    const lista: any[] = Array.isArray(data) ? data : Object.values(data ?? {});
    const sop = lista.find((g) => (typeof g?.id === "string" ? g.id : g?.id?._serialized) === cuenta.supportGroupId);
    for (const part of Array.isArray(sop?.participants) ? sop.participants : []) {
      for (const v of [part?.id, part?.phoneNumber, part?.jid]) { const x = normalizarId(typeof v === "string" ? v : v?._serialized); if (x) ids.add(x); }
    }
  } catch (e) {
    console.warn("[soporte] no pude leer los miembros del grupo de soporte:", e instanceof Error ? e.message : String(e));
    if (c) return c.ids; // mejor la lista vieja que ninguna
  }
  equipoCache.set(key, { at: Date.now(), ids });
  return ids;
}

async function cuentaDeSesion(session: string): Promise<Cuenta | null> {
  const line = await prisma.waLine.findFirst({
    where: { OR: [{ sessionId: session }, { id: session.replace(/^line_/, "") }] },
    select: { user: { select: { id: true, supportGroupId: true, supportRelayEnabled: true, supportIgnoreGroups: true, supportTeamNumbers: true } } },
  });
  const u = line?.user;
  if (!u || !u.supportRelayEnabled || !u.supportGroupId) return null;
  return { id: u.id, supportGroupId: u.supportGroupId, supportIgnoreGroups: u.supportIgnoreGroups, supportTeamNumbers: u.supportTeamNumbers };
}

function grupoIgnorado(cuenta: Cuenta, jid: string): boolean {
  const lista = Array.isArray(cuenta.supportIgnoreGroups) ? (cuenta.supportIgnoreGroups as unknown[]) : [];
  return lista.some((x) => typeof x === "string" && x === jid);
}

/** Nombre del grupo (WAHA lo trae en _data o hay que pedirlo). Best-effort, con caché en el hilo. */
async function nombreDeGrupo(session: string, jid: string, p: Record<string, any>): Promise<string> {
  const enPayload = p?._data?.chat?.name ?? p?.chat?.name ?? p?._data?.groupName;
  if (typeof enPayload === "string" && enPayload.trim()) return enPayload.trim();
  const guardado = await prisma.supportThread.findUnique({ where: { groupJid: jid }, select: { groupName: true } });
  if (guardado?.groupName) return guardado.groupName;
  try {
    const { data } = await waha().get(`/api/${encodeURIComponent(session)}/groups/${encodeURIComponent(jid)}`);
    const n = data?.subject ?? data?.name;
    if (typeof n === "string" && n.trim()) return n.trim();
  } catch { /* sin nombre: se muestra el jid */ }
  return jid.replace(/@g\.us$/, "");
}

/** Quién escribió dentro del grupo: nombre de WhatsApp, o el teléfono si se ve, o el LID. */
function quienEscribio(p: Record<string, any>): string {
  const nombre = p?._data?.pushName ?? p?._data?.notifyName ?? p?.notifyName;
  if (typeof nombre === "string" && nombre.trim()) return nombre.trim();
  const rk = p?._data?.key ?? {};
  const pn = [rk.participantPn, rk.senderPn, p?.participantPn].find((v) => typeof v === "string" && v.includes("@") && !v.endsWith("@lid"));
  if (pn) return telefonoLegible(pn);
  const part = p?.participant ?? rk.participant ?? p?.author;
  return typeof part === "string" ? part.split("@")[0] : "alguien del grupo";
}

/**
 * Evento crudo de WAHA (message / message.any) de la sesión del número de soporte. Solo mira
 * GRUPOS: los 1 a 1 los atiende relayConsultas() por la base, así nada se reenvía dos veces.
 */
export async function onEventoDeGrupo(session: string, p: Record<string, any>): Promise<void> {
  const chat: string = String(p?.from ?? "");
  if (!chat.endsWith("@g.us")) return; // 1 a 1, estados, difusión: no es asunto de acá
  const cuenta = await cuentaDeSesion(session);
  if (!cuenta) return;

  const texto: string = typeof p?.body === "string" ? p.body : "";
  const idMsg = idCola(p?.id ?? p?._data?.key?.id);

  // ---- El grupo SOPORTE: es el canal de órdenes. Todo lo que no empiece con B- se ignora. ----
  if (chat === cuenta.supportGroupId) {
    const orden = parseComando(texto);
    if (!orden) return; // charla interna del equipo: no se guarda ni se mira
    const citado = idCitado(p);
    const relay = citado ? await prisma.supportRelayMsg.findFirst({ where: { groupMsgId: { endsWith: citado } }, select: { threadId: true } }) : null;
    const hilo = relay ? await prisma.supportThread.findUnique({ where: { id: relay.threadId }, select: { groupJid: true, contactId: true, code: true } }) : null;
    if (!hilo) {
      // Sin cita (o citaron otra cosa): antes que mandarle a cualquiera, se pide en el grupo.
      await enviarTexto(session, cuenta.supportGroupId, "⚠️ No sé a quién va. Respondé CITANDO el mensaje del cliente (el que empieza con 🆕) y empezá con B-.", idMsg || undefined).catch(() => undefined);
      return;
    }
    try {
      if (hilo.groupJid) {
        await enviarTexto(session, hilo.groupJid, orden);
      } else if (hilo.contactId) {
        const ok = await sendToContact(cuenta.id, hilo.contactId, orden);
        if (!ok) throw new Error("sendToContact devolvió false");
      } else {
        throw new Error("hilo sin destino");
      }
      await enviarTexto(session, cuenta.supportGroupId, `✅ Enviado a #${hilo.code}`, idMsg || undefined).catch(() => undefined);
    } catch (e) {
      console.error("[soporte] no se pudo mandar la respuesta B-:", e instanceof Error ? e.message : String(e));
      await enviarTexto(session, cuenta.supportGroupId, `❌ No salió el mensaje a #${hilo.code}. Probá de nuevo en un rato.`, idMsg || undefined).catch(() => undefined);
    }
    return;
  }

  // ---- Un grupo de CLIENTE: se reenvía a SOPORTE y se le contesta al toque. ----
  if (p?.fromMe) return; // lo nuestro (acuses, respuestas B-, o lo que se tipee desde el teléfono de soporte)
  if (grupoIgnorado(cuenta, chat)) return;
  // Solo el CLIENTE: si escribió alguien del equipo desde su propio teléfono, ni se reenvía ni se le contesta.
  if (esDelEquipo(remitenteDe(p), await equipoDe(session, cuenta))) return;
  if (!idMsg) return;

  const hilo = await hiloDeGrupo(cuenta.id, chat, await nombreDeGrupo(session, chat, p));

  // CANDADO de idempotencia: el mismo evento puede llegar dos veces (message + message.any).
  const messageId = `wa:${idMsg}`;
  try {
    await prisma.supportRelayMsg.create({ data: { messageId, threadId: hilo.id } });
  } catch {
    return;
  }

  const mime: string = p?.media?.mimetype ?? p?._data?.mimetype ?? "";
  const mediaUrl: string | undefined = p?.media?.url ?? undefined;
  const esImagen = Boolean(p?.hasMedia && mediaUrl && mime.startsWith("image"));
  const grupoNombre = (await prisma.supportThread.findUnique({ where: { id: hilo.id }, select: { groupName: true } }))?.groupName ?? chat;
  const cuerpo = textoDesdeGrupo({ code: hilo.code, grupo: grupoNombre, quien: quienEscribio(p), texto, esImagen });

  try {
    let groupMsgId: string | undefined;
    if (esImagen) {
      const media = await downloadWahaMedia(mediaUrl!, mime);
      groupMsgId = media?.base64
        ? await enviarImagen(session, cuenta.supportGroupId, media.base64, media.mimetype ?? mime, cuerpo)
        : await enviarTexto(session, cuenta.supportGroupId, cuerpo + "\n(no se pudo bajar la imagen)");
    } else {
      groupMsgId = await enviarTexto(session, cuenta.supportGroupId, cuerpo);
    }
    if (groupMsgId) await prisma.supportRelayMsg.update({ where: { messageId }, data: { groupMsgId } });
  } catch (e) {
    await prisma.supportRelayMsg.deleteMany({ where: { messageId } }); // que el reintento de WAHA lo vuelva a traer
    console.error("[soporte] no se pudo reenviar del grupo del cliente:", e instanceof Error ? e.message : String(e));
    return;
  }

  // Acuse en el grupo del cliente: una vez cada ACK_GRUPO_MS. Texto según lo que mandó.
  const ahora = Date.now();
  if (!hilo.lastAckAt || ahora - hilo.lastAckAt.getTime() >= ACK_GRUPO_MS) {
    const ok = await enviarTexto(session, chat, esImagen ? ACK_CARGA : ACK_CONSULTA, idMsg).then(() => true).catch(() => false);
    if (ok) await prisma.supportThread.update({ where: { id: hilo.id }, data: { lastAckAt: new Date(ahora) } });
  }
}

// ============================ El segundo webhook en la sesión de WAHA ============================

/** URL que WAHA tiene que tener como segundo webhook (misma firma por token que el principal). */
export function urlWebhookSoporte(): string | null {
  const token = process.env.EVOLUTION_WEBHOOK_TOKEN ?? "";
  const principal = process.env.WAHA_WEBHOOK_URL ?? process.env.EVOLUTION_WEBHOOK_URL ?? "";
  if (!token || !principal) return null;
  // Mismo host que el webhook principal (http://app:4000 en docker), otra ruta.
  try {
    const u = new URL(principal);
    return `${u.origin}/api/soporte/wa?token=${encodeURIComponent(token)}`;
  } catch {
    return null;
  }
}

/**
 * Se asegura de que la sesión del número de soporte tenga el segundo webhook. Solo escribe (y por lo
 * tanto REINICIA la sesión) si falta: nuestro propio código reescribe la config al recrear la sesión
 * (createInstance / setProxy) y ahí se perdería. Devuelve true si tuvo que reponerlo.
 */
export async function asegurarWebhookSoporte(): Promise<number> {
  const url = urlWebhookSoporte();
  if (!url) return 0;
  const cuentas = await prisma.user.findMany({
    where: { supportRelayEnabled: true, supportGroupId: { not: null } },
    select: { id: true },
  });
  let repuestos = 0;
  for (const c of cuentas) {
    const lineas = await prisma.waLine.findMany({ where: { userId: c.id, provider: "baileys", status: "active" }, select: { id: true, sessionId: true } });
    for (const l of lineas) {
      const ses = l.sessionId ?? `line_${l.id}`;
      try {
        const { data } = await waha().get(`/api/sessions/${encodeURIComponent(ses)}`);
        const hooks: Array<{ url: string; events?: string[] }> = Array.isArray(data?.config?.webhooks) ? data.config.webhooks : [];
        if (hooks.some((h) => typeof h?.url === "string" && h.url.split("?")[0] === url.split("?")[0])) continue;
        const config = { ...(data?.config ?? {}), webhooks: [...hooks, { url, events: ["message.any"] }] };
        await waha().put(`/api/sessions/${encodeURIComponent(ses)}`, { config });
        console.warn(`[soporte] segundo webhook repuesto en ${ses} (la sesión se reinicia)`);
        repuestos++;
      } catch (e) {
        console.error(`[soporte] no pude verificar el webhook de ${ses}:`, e instanceof Error ? e.message : String(e));
      }
    }
  }
  return repuestos;
}
