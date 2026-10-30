// Pedidos "C-" del grupo SOPORTE para Claude (2026-10-30, pedido del dueño: "que mi empleado mande los cambios por el grupo,
// que Claude los ejecute y yo confirme").
//
// Flujo:
//   1. Alguien autorizado (CLAUDE_OPS_PEDIDOS) escribe en SOPORTE "C- <pedido>" (texto o captura con ese texto). Se crea un
//      ClaudeJob, se le pone 🟠 al mensaje y se avisa "#N recibido".
//   2. El worker del server del casino lo toma (routes/claude-ops.ts), corre Claude en modo CONSULTA (no puede cambiar nada)
//      y contesta: el diagnóstico, o el plan con "ok N" si hay que cambiar algo.
//   3. Un aprobador (CLAUDE_OPS_APROBADORES) contesta "ok N" (o "no N", u "ok N <ajuste>"). El worker lo vuelve a tomar en
//      modo EJECUCION, hace el cambio, lo verifica y contesta con el resultado y el mensaje para el cliente.
//   4. "C- #N <algo más>" (con o sin captura) sigue el mismo pedido, en la misma sesión de Claude.
// Lo que escribe el número de soporte desde su propio teléfono llega como fromMe: cuenta como "soporte" (ponerlo en las
// listas si debe poder pedir/aprobar). Los mensajes del bot empiezan con 🟠 y nunca matchean "C-" ni "ok N".
import axios from "axios";
import { prisma } from "./prisma.js";
import { downloadWahaMedia } from "./waha.js";

const WAHA_BASE = process.env.WAHA_BASE_URL ?? "http://localhost:3001";
const WAHA_KEY = process.env.WAHA_API_KEY ?? "";
const waha = () => axios.create({ baseURL: WAHA_BASE, headers: { "X-Api-Key": WAHA_KEY, "Content-Type": "application/json" }, timeout: 30_000 });

export const ICONO = "🟠";
const MAX_IMAGEN_BYTES = 6 * 1024 * 1024;
const MAX_TEXTO_WA = 3500;

// ============================ Parseo ============================

/** "C- texto" / "c - texto" / "C– #47 texto" → { numero?, texto }. null si no es un pedido para Claude. */
export function parsePedido(texto: string | null | undefined): { numero: number | null; texto: string } | null {
  const m = /^\s*[cC]\s*[-–—]\s*([\s\S]*)$/.exec(texto ?? "");
  if (!m) return null;
  let cuerpo = m[1].trim();
  let numero: number | null = null;
  const n = /^#\s*(\d{1,7})\b\s*([\s\S]*)$/.exec(cuerpo);
  if (n) { numero = Number(n[1]); cuerpo = n[2].trim(); }
  return { numero, texto: cuerpo };
}

/** "ok 47", "OK #47 pero con el 549…", "no 47 ya no hace falta" → { accion, numero, nota }. */
export function parseAprobacion(texto: string | null | undefined): { accion: "ok" | "no"; numero: number; nota: string } | null {
  const m = /^\s*(ok|okey|dale|si|sí|no)\s*#?\s*(\d{1,7})\b[\s,.:-]*([\s\S]*)$/i.exec(texto ?? "");
  if (!m) return null;
  const palabra = m[1].toLowerCase();
  return { accion: palabra === "no" ? "no" : "ok", numero: Number(m[2]), nota: m[3].trim() };
}

/** Lista de teléfonos de una variable (solo dígitos) + la palabra "soporte" (lo que se tipea desde el número de soporte). */
export function listaDe(v: string | undefined): Set<string> {
  const out = new Set<string>();
  for (const x of String(v ?? "").split(",")) {
    const s = x.trim().toLowerCase();
    if (!s) continue;
    if (s === "soporte") { out.add("soporte"); continue; }
    const d = s.replace(/\D/g, "");
    if (d.length >= 8) out.add(d);
  }
  return out;
}

export function activo(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.CLAUDE_OPS_SECRET) && listaDe(env.CLAUDE_OPS_PEDIDOS).size > 0;
}

/** Recorta para WhatsApp sin cortar a la mitad una línea, si se puede. */
export function recortar(texto: string, max = MAX_TEXTO_WA): string {
  const t = texto.trim();
  if (t.length <= max) return t;
  const corte = t.lastIndexOf("\n", max - 40);
  return `${t.slice(0, corte > max / 2 ? corte : max - 40).trimEnd()}\n… (recortado)`;
}

/** Texto que el bot deja en el grupo según cómo terminó la vuelta. */
export function textoRespuesta(numero: number, estado: string, cuerpo: string): string {
  const c = recortar(cuerpo);
  switch (estado) {
    case "esperando_ok":
      return `${ICONO} *#${numero}* · plan\n\n${c}\n\n👉 Para hacerlo: *ok ${numero}*  ·  para cancelar: *no ${numero}*`;
    case "necesita_info":
      return `${ICONO}❓ *#${numero}*\n\n${c}\n\n👉 Respondé con *C- #${numero}* y el dato (podés mandar captura con ese texto).`;
    case "error":
      return `${ICONO}❌ *#${numero}*\n\n${c}`;
    default:
      return `${ICONO}✅ *#${numero}*\n\n${c}`;
  }
}

// ============================ Quién escribió (teléfono) ============================

const telCache = new Map<string, { at: number; lidATel: Map<string, string> }>();

/** LID → teléfono de los miembros de un grupo (WhatsApp manda a veces solo el LID del remitente). Caché 5 min. */
async function lidATelefono(session: string, groupJid: string): Promise<Map<string, string>> {
  const key = `${session}:${groupJid}`;
  const c = telCache.get(key);
  if (c && Date.now() - c.at < 5 * 60_000) return c.lidATel;
  const mapa = new Map<string, string>();
  try {
    const { data } = await waha().get(`/api/${encodeURIComponent(session)}/groups`);
    const lista: any[] = Array.isArray(data) ? data : Object.values(data ?? {});
    const g = lista.find((x) => (typeof x?.id === "string" ? x.id : x?.id?._serialized) === groupJid);
    for (const part of Array.isArray(g?.participants) ? g.participants : []) {
      const ids = [part?.id, part?.lid, part?.jid].map((v) => (typeof v === "string" ? v : v?._serialized)).filter((v): v is string => typeof v === "string");
      const tel = [part?.phoneNumber, ...ids].map((v) => (typeof v === "string" ? v : "")).find((v) => v && !v.endsWith("@lid"));
      const telDig = tel ? tel.split("@")[0].replace(/\D/g, "") : "";
      if (!telDig) continue;
      for (const i of ids) if (i.toLowerCase().endsWith("@lid")) mapa.set(i.toLowerCase(), telDig);
    }
  } catch (e) {
    console.warn("[claude-ops] no pude leer los miembros del grupo:", e instanceof Error ? e.message : String(e));
    if (c) return c.lidATel;
  }
  telCache.set(key, { at: Date.now(), lidATel: mapa });
  return mapa;
}

/** Teléfonos (solo dígitos) del remitente; "soporte" si lo escribió el propio número de soporte. */
export async function telefonosDe(session: string, groupJid: string, p: Record<string, any>, remitente: string[]): Promise<string[]> {
  if (p?.fromMe) return ["soporte"];
  const tels = new Set(remitente.filter((r) => !r.endsWith("@lid")));
  const lids = remitente.filter((r) => r.endsWith("@lid"));
  if (lids.length) {
    const mapa = await lidATelefono(session, groupJid);
    for (const l of lids) { const t = mapa.get(l); if (t) tels.add(t); }
  }
  return [...tels];
}

// ============================ WhatsApp ============================

async function reaccionar(session: string, messageId: string, emoji: string): Promise<void> {
  if (!messageId) return;
  await waha().put("/api/reaction", { session, messageId, reaction: emoji }).catch((e) => {
    console.warn("[claude-ops] no pude reaccionar:", e instanceof Error ? e.message : String(e));
  });
}

async function decir(session: string, chatId: string, text: string, replyTo?: string): Promise<void> {
  await waha().post("/api/sendText", { session, chatId, text, ...(replyTo ? { reply_to: replyTo } : {}) }).catch((e) => {
    console.error("[claude-ops] no pude escribir en el grupo:", e instanceof Error ? e.message : String(e));
  });
}

/** Captura del mensaje (si es imagen), en base64. */
async function imagenDe(p: Record<string, any>): Promise<{ mimetype: string; base64: string } | null> {
  const mime: string = p?.media?.mimetype ?? p?._data?.mimetype ?? "";
  const url: string | undefined = p?.media?.url ?? undefined;
  if (!p?.hasMedia || !url || !mime.startsWith("image")) return null;
  const m = await downloadWahaMedia(url, mime);
  if (!m?.base64) return null;
  if (Buffer.byteLength(m.base64, "base64") > MAX_IMAGEN_BYTES) return null;
  return { mimetype: m.mimetype ?? mime, base64: m.base64 };
}

/** Id completo del mensaje (para reaccionar) y su cola (para citarlo, como el resto del relay). */
function idsDe(p: Record<string, any>, idCola: string): { completo: string; cola: string } {
  const raw = p?.id;
  const completo = typeof raw === "string" ? raw : raw?._serialized ?? "";
  return { completo: completo || idCola, cola: idCola };
}

// ============================ Entrada desde el grupo SOPORTE ============================

/**
 * Mira un mensaje del grupo SOPORTE. Devuelve true si era para Claude (pedido, seguimiento o aprobación) y ya se atendió:
 * entonces el relay "B-" no lo mira.
 */
export async function atenderClaude(
  session: string,
  cuenta: { id: string; supportGroupId: string },
  p: Record<string, any>,
  texto: string,
  idCola: string,
  remitente: string[],
): Promise<boolean> {
  if (!activo()) return false;
  const pedido = parsePedido(texto);
  const aprob = pedido ? null : parseAprobacion(texto);
  if (!pedido && !aprob) return false;

  const grupo = cuenta.supportGroupId;
  const ids = idsDe(p, idCola);
  const tels = await telefonosDe(session, grupo, p, remitente);

  // ---- "ok N" / "no N" ----
  if (aprob) {
    const aprobadores = listaDe(process.env.CLAUDE_OPS_APROBADORES);
    if (!tels.some((t) => aprobadores.has(t))) {
      await decir(session, grupo, `${ICONO} Solo los aprobadores pueden confirmar el #${aprob.numero}.`, ids.cola);
      return true;
    }
    const job = await prisma.claudeJob.findUnique({ where: { numero: aprob.numero } });
    if (!job) { await decir(session, grupo, `${ICONO} No encuentro el pedido #${aprob.numero}.`, ids.cola); return true; }
    if (job.estado !== "esperando_ok") {
      await decir(session, grupo, `${ICONO} El #${job.numero} no está esperando confirmación (estado: ${job.estado}).`, ids.cola);
      return true;
    }
    if (aprob.accion === "no") {
      await prisma.claudeJob.update({ where: { id: job.id }, data: { estado: "rechazado", aprobadoPor: tels[0] ?? null, resultado: aprob.nota || null } });
      await reaccionar(session, ids.completo, "🚫");
      await decir(session, grupo, `${ICONO} #${job.numero} cancelado. No se hizo ningún cambio.`, ids.cola);
      return true;
    }
    const ok = await prisma.claudeJob.updateMany({
      where: { id: job.id, estado: "esperando_ok" },
      data: { estado: "aprobado", aprobadoPor: tels[0] ?? null, pendiente: aprob.nota || null },
    });
    if (ok.count) {
      await reaccionar(session, ids.completo, "👍");
      await decir(session, grupo, `${ICONO} #${job.numero} aprobado${aprob.nota ? " con el ajuste" : ""}. Lo hago y aviso.`, ids.cola);
    }
    return true;
  }

  // ---- "C- …": pedido nuevo o seguimiento "C- #N …" ----
  const pedidores = listaDe(process.env.CLAUDE_OPS_PEDIDOS);
  if (!tels.some((t) => pedidores.has(t))) {
    await decir(session, grupo, `${ICONO} Este número no está habilitado para pedirle cambios a Claude.`, ids.cola);
    return true;
  }
  const img = await imagenDe(p).catch(() => null);
  if (!pedido!.texto && !img) {
    await decir(session, grupo, `${ICONO} Escribí qué necesitás después de "C-" (podés mandar una captura con ese texto).`, ids.cola);
    return true;
  }
  const nombre = (p?._data?.pushName ?? p?._data?.notifyName ?? null) as string | null;
  const autor = tels.find((t) => pedidores.has(t)) ?? tels[0] ?? "?";

  if (pedido!.numero != null) {
    const job = await prisma.claudeJob.findUnique({ where: { numero: pedido!.numero } });
    if (!job) { await decir(session, grupo, `${ICONO} No encuentro el pedido #${pedido!.numero}.`, ids.cola); return true; }
    if (["trabajando", "ejecutando"].includes(job.estado)) {
      await decir(session, grupo, `${ICONO} El #${job.numero} se está procesando. Mandalo de nuevo cuando conteste.`, ids.cola);
      return true;
    }
    const imagenes = Array.isArray(job.imagenes) ? (job.imagenes as unknown[]) : [];
    const nota = [job.pendiente, `${nombre ?? autor}: ${pedido!.texto || "(captura)"}`].filter(Boolean).join("\n");
    await prisma.claudeJob.update({
      where: { id: job.id },
      data: { estado: "nuevo", pendiente: nota, ...(img ? { imagenes: [...imagenes, img] as any } : {}) },
    });
    await reaccionar(session, ids.completo, ICONO);
    return true;
  }

  const job = await prisma.claudeJob.create({
    data: {
      userId: cuenta.id, session, groupJid: grupo, msgId: ids.cola, autor, autorNombre: nombre,
      texto: pedido!.texto || "(ver captura)", ...(img ? { imagenes: [img] as any } : {}),
    },
  });
  await reaccionar(session, ids.completo, ICONO);
  await decir(session, grupo, `${ICONO} *#${job.numero}* recibido. Claude lo está mirando.`, ids.cola);
  return true;
}

// ============================ Avisos del server del casino ============================

/**
 * 2026-10-30 (Federico: "que nos llegue en el grupo de soporte que se cargaron fichas"): texto suelto al grupo SOPORTE desde el
 * número de soporte (la cuenta con el relay prendido y su línea activa). Lo usa el vigilante de cargas de soporte247 del server
 * del casino. Devuelve false si no hay grupo/línea configurados.
 */
export async function avisarAlGrupo(texto: string): Promise<boolean> {
  const cuenta = await prisma.user.findFirst({ where: { supportRelayEnabled: true, supportGroupId: { not: null } }, select: { id: true, supportGroupId: true } });
  if (!cuenta?.supportGroupId) return false;
  const linea = await prisma.waLine.findFirst({ where: { userId: cuenta.id, provider: "baileys", status: "active" }, select: { id: true, sessionId: true } });
  if (!linea) return false;
  await waha().post("/api/sendText", { session: linea.sessionId ?? `line_${linea.id}`, chatId: cuenta.supportGroupId, text: recortar(texto) });
  return true;
}

// ============================ Lado del worker ============================

export type Tarea = {
  id: string; numero: number; fase: "consulta" | "ejecucion"; texto: string; mensaje: string; autor: string;
  claudeSession: string | null; plan: string | null; imagenes: Array<{ mimetype: string; base64: string }>;
};

/** Toma el próximo pedido (aprobados primero) y lo marca en curso. null si no hay nada. */
export async function tomarTarea(): Promise<Tarea | null> {
  // Un pedido que quedó "en curso" más de 40 min (worker caído a la mitad) vuelve a la cola de donde salió.
  const viejo = new Date(Date.now() - 40 * 60_000);
  await prisma.claudeJob.updateMany({ where: { estado: "trabajando", tomadoAt: { lt: viejo } }, data: { estado: "nuevo" } });
  await prisma.claudeJob.updateMany({ where: { estado: "ejecutando", tomadoAt: { lt: viejo } }, data: { estado: "error", resultado: "El worker no terminó la ejecución en 40 min." } });

  for (const [desde, hacia] of [["aprobado", "ejecutando"], ["nuevo", "trabajando"]] as const) {
    const cand = await prisma.claudeJob.findFirst({ where: { estado: desde }, orderBy: { updatedAt: "asc" } });
    if (!cand) continue;
    const r = await prisma.claudeJob.updateMany({ where: { id: cand.id, estado: desde }, data: { estado: hacia, tomadoAt: new Date() } });
    if (!r.count) continue; // otro worker lo agarró
    const todas = Array.isArray(cand.imagenes) ? (cand.imagenes as Array<{ mimetype: string; base64: string }>) : [];
    await prisma.claudeJob.update({ where: { id: cand.id }, data: { pendiente: null, imagenesEnviadas: todas.length } });
    const primera = !cand.claudeSession;
    return {
      id: cand.id, numero: cand.numero, fase: hacia === "ejecutando" ? "ejecucion" : "consulta", texto: cand.texto,
      mensaje: primera ? cand.texto : cand.pendiente ?? "", autor: cand.autorNombre ?? cand.autor,
      claudeSession: cand.claudeSession, plan: cand.plan, imagenes: todas.slice(cand.imagenesEnviadas),
    };
  }
  return null;
}

/** El worker terminó una vuelta: se guarda y se contesta en el grupo citando el pedido. */
export async function cerrarVuelta(id: string, fase: "consulta" | "ejecucion", estado: string, cuerpo: string, claudeSession: string | null): Promise<boolean> {
  const job = await prisma.claudeJob.findUnique({ where: { id } });
  if (!job) return false;
  const valido = fase === "consulta" ? ["esperando_ok", "hecho", "necesita_info", "error"] : ["hecho", "error"];
  const est = valido.includes(estado) ? estado : "error";
  // Si mientras trabajaba llegó un seguimiento ("C- #N …" dejó estado=nuevo), no se pisa: el seguimiento se toma después.
  const nuevoEstado = est === "necesita_info" ? "hecho" : est;
  await prisma.claudeJob.updateMany({
    where: { id, estado: fase === "consulta" ? "trabajando" : "ejecutando" },
    data: { estado: nuevoEstado, ...(claudeSession ? { claudeSession } : {}), ...(est === "esperando_ok" ? { plan: cuerpo } : { resultado: cuerpo }) },
  });
  if (claudeSession) await prisma.claudeJob.update({ where: { id }, data: { claudeSession } });
  await decir(job.session, job.groupJid, textoRespuesta(job.numero, est, cuerpo), job.msgId);
  return true;
}
