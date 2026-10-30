// Clientes sin respuesta + resumen de la noche en el grupo SOPORTE (2026-10-31, Federico: "sí, los 3").
//
// Por qué existe: el 30/10 J.K. (Eurofortuna) escribió en su grupo a las 16:00, 17:34, 17:39 y 19:15 y nadie le contestó ni
// se lo pasó al bot: 3,5 h esperando, invisibles para el dueño. El número de soporte está en el grupo de cada cliente, así
// que el relay (lib/soporte-relay.ts) ve lo que escribe el cliente y lo que contesta el equipo. Acá se lleva la cuenta por
// hilo (SupportThread):
//   - un mensaje del cliente arranca el reloj si no había nada pendiente (pendingSinceAt = el PRIMERO sin contestar);
//   - cualquier mensaje del equipo en ese grupo (B- desde SOPORTE, o desde su propio teléfono) lo da por contestado; en
//     los chats 1 a 1 cuenta la respuesta que salió por WhatsApp (Message direction=out);
//   - "soporte-alerta" (cada 10 min, lib/queue.ts): avisa en SOPORTE cuando un cliente lleva SOPORTE_SIN_RESPUESTA_MIN
//     (120) sin respuesta, UNA vez por consulta;
//   - "soporte-resumen" (SOPORTE_RESUMEN_HORA, 23:00 AR): pedidos a Claude del día, clientes esperando, movimiento por chat.
// Aditivo: sin cuenta con el relay prendido no corre nada. No toca WhatsApp ni la atribución.
import { prisma } from "./prisma.js";
import { getEngine } from "./wa-engine.js";
import { recortar } from "./claude-ops.js";

export const TZ = "America/Argentina/Buenos_Aires";
export const SIN_RESPUESTA_MIN = Number(process.env.SOPORTE_SIN_RESPUESTA_MIN ?? "120");

/** "23:00" → "0 23 * * *" (patrón de BullMQ). Una hora rara cae al default (23:00). */
export function patronResumen(hora: string | undefined = process.env.SOPORTE_RESUMEN_HORA): string {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*$/.exec(hora ?? "");
  const h = m ? Number(m[1]) : 23;
  const min = m?.[2] ? Number(m[2]) : 0;
  return h >= 0 && h <= 23 && min >= 0 && min <= 59 ? `${min} ${h} * * *` : "0 23 * * *";
}

// ============================ Textos (puros, testeables) ============================

export interface Esperando {
  code: string; // #ABC del hilo
  nombre: string; // grupo o contacto
  quien: string; // quién escribió
  texto: string; // último mensaje del cliente
  desde: Date; // primer mensaje sin contestar
}

export interface ResumenJobs {
  total: number; // creados en el día
  hechos: number;
  rechazados: number;
  errores: Array<{ numero: number; texto: string }>;
  esperandoOk: Array<{ numero: number; texto: string }>; // de cualquier día: siguen esperando
  enCurso: Array<{ numero: number; texto: string }>;
}

export interface Movimiento { nombre: string; mensajes: number }

/** "35 min", "2 h 05 min", "3 h", "1 día 2 h". */
export function textoEspera(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return m ? `${h} h ${String(m).padStart(2, "0")} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return `${d} día${d === 1 ? "" : "s"} ${h % 24} h`;
}

/** "jue 30/10" en hora argentina. */
export function fechaAR(d: Date): string {
  const p = new Intl.DateTimeFormat("es-AR", { timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit" }).formatToParts(d);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${v("weekday").replace(/\.$/, "")} ${v("day")}/${v("month")}`;
}

/** Las 00:00 de ese día en Argentina (UTC-3 todo el año), como Date. */
export function inicioDiaAR(d: Date): Date {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return new Date(`${f}T00:00:00-03:00`);
}

const corto = (s: string, n: number): string => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

/** El aviso en SOPORTE cuando un cliente lleva mucho esperando. */
export function textoAlerta(e: Esperando, ahora: Date): string {
  return [
    `⏰ *#${e.code} · ${e.nombre}* — ${e.quien || "el cliente"} lleva *${textoEspera(ahora.getTime() - e.desde.getTime())}* sin respuesta`,
    `«${corto(e.texto, 160) || "(imagen)"}»`,
    "",
    `↩️ Para contestarle: respondé citando su mensaje 🆕 #${e.code} y empezá con B-`,
  ].join("\n");
}

/** Los que ya esperan más de `minutos` y por los que todavía no se avisó. */
export function paraAlertar<T extends { desde: Date; alertedAt: Date | null }>(esperando: T[], ahora: Date, minutos: number): T[] {
  return esperando.filter((e) => !e.alertedAt && ahora.getTime() - e.desde.getTime() >= minutos * 60_000);
}

/** Cuenta los pedidos a Claude: los del día por resultado, y los que siguen abiertos aunque sean de otro día. */
export function resumirJobs(jobs: Array<{ numero: number; estado: string; texto: string; createdAt: Date }>, inicio: Date): ResumenJobs {
  const hoy = jobs.filter((j) => j.createdAt >= inicio);
  const item = (j: { numero: number; texto: string }) => ({ numero: j.numero, texto: corto(j.texto, 60) });
  return {
    total: hoy.length,
    hechos: hoy.filter((j) => j.estado === "hecho").length,
    rechazados: hoy.filter((j) => j.estado === "rechazado").length,
    errores: hoy.filter((j) => j.estado === "error").map(item),
    esperandoOk: jobs.filter((j) => j.estado === "esperando_ok").map(item),
    enCurso: jobs.filter((j) => ["nuevo", "trabajando", "aprobado", "ejecutando"].includes(j.estado)).map(item),
  };
}

/** El resumen de la noche, listo para el grupo. */
export function textoResumen(a: { ahora: Date; jobs: ResumenJobs; esperando: Esperando[]; movimiento: Movimiento[] }): string {
  const L: string[] = [`📋 *Resumen del día · ${fechaAR(a.ahora)}*`, ""];
  const j = a.jobs;
  const partes = [`${j.hechos} hecho${j.hechos === 1 ? "" : "s"}`];
  if (j.esperandoOk.length) partes.push(`${j.esperandoOk.length} esperando ok`);
  if (j.enCurso.length) partes.push(`${j.enCurso.length} en curso`);
  if (j.errores.length) partes.push(`${j.errores.length} con error`);
  if (j.rechazados) partes.push(`${j.rechazados} cancelado${j.rechazados === 1 ? "" : "s"}`);
  L.push(`🟠 *Pedidos a Claude:* ${j.total} en el día — ${partes.join(" · ")}`);
  for (const x of j.esperandoOk) L.push(`   ⏳ #${x.numero} ${x.texto} → *ok ${x.numero}* o *no ${x.numero}*`);
  for (const x of j.enCurso) L.push(`   ⚙️ #${x.numero} ${x.texto}`);
  for (const x of j.errores) L.push(`   ❌ #${x.numero} ${x.texto}`);
  L.push("");
  if (a.esperando.length) {
    L.push(`⏳ *Clientes esperando respuesta:* ${a.esperando.length}`);
    for (const e of a.esperando) {
      L.push(`   • #${e.code} ${e.nombre} — ${e.quien || "el cliente"}, hace ${textoEspera(a.ahora.getTime() - e.desde.getTime())}: «${corto(e.texto, 90) || "(imagen)"}»`);
    }
  } else {
    L.push("✅ *Ningún cliente esperando respuesta.*");
  }
  L.push("");
  const total = a.movimiento.reduce((s, m) => s + m.mensajes, 0);
  if (total) {
    L.push(`📨 *Mensajes de clientes hoy:* ${total} en ${a.movimiento.length} chat${a.movimiento.length === 1 ? "" : "s"}`);
    L.push(`   ${[...a.movimiento].sort((x, y) => y.mensajes - x.mensajes).slice(0, 6).map((m) => `${m.nombre} ${m.mensajes}`).join(" · ")}`);
  } else {
    L.push("📨 *Mensajes de clientes hoy:* ninguno");
  }
  return L.join("\n");
}

// ============================ Seguimiento por hilo (lo llama el relay) ============================

/** El cliente escribió: si no había nada pendiente, arranca el reloj desde este mensaje. */
export async function marcarMensajeCliente(threadId: string, quien: string, texto: string, ahora: Date = new Date()): Promise<void> {
  const h = await prisma.supportThread.findUnique({ where: { id: threadId }, select: { pendingSinceAt: true } });
  if (!h) return;
  await prisma.supportThread.update({
    where: { id: threadId },
    data: {
      lastClientAt: ahora,
      lastClientWho: corto(quien, 80) || null,
      lastClientText: corto(texto, 300) || null,
      ...(h.pendingSinceAt ? {} : { pendingSinceAt: ahora, alertedAt: null }),
    },
  });
}

/** Alguien del equipo escribió en el grupo del cliente: lo pendiente queda contestado. */
export async function marcarRespuestaEquipo(groupJid: string, ahora: Date = new Date()): Promise<void> {
  await prisma.supportThread.updateMany({ where: { groupJid }, data: { lastTeamAt: ahora, pendingSinceAt: null, alertedAt: null } });
}

// ============================ Jobs (lib/queue.ts) ============================

type Cuenta = { id: string; supportGroupId: string };

async function cuentasConRelay(): Promise<Cuenta[]> {
  const cuentas = await prisma.user.findMany({
    where: { supportRelayEnabled: true, supportGroupId: { not: null } },
    select: { id: true, supportGroupId: true },
  });
  return cuentas.filter((c): c is Cuenta => Boolean(c.supportGroupId));
}

/** Texto al grupo SOPORTE desde el número de soporte de la cuenta. false si no hay línea. */
async function enviarASoporte(cuenta: Cuenta, texto: string): Promise<boolean> {
  const linea = await prisma.waLine.findFirst({ where: { userId: cuenta.id, provider: "baileys", status: "active" }, select: { id: true, sessionId: true } });
  if (!linea) return false;
  await getEngine().sendText(linea.sessionId ?? `line_${linea.id}`, cuenta.supportGroupId, recortar(texto));
  return true;
}

/**
 * Los hilos de la cuenta con algo sin contestar. En los 1 a 1 la respuesta del equipo sale por el Inbox y queda en
 * Message (direction=out): si hay una después del mensaje pendiente, el hilo se da por contestado acá mismo.
 */
async function esperandoAhora(cuentaId: string): Promise<Array<Esperando & { id: string; alertedAt: Date | null }>> {
  const hilos = await prisma.supportThread.findMany({
    where: { userId: cuentaId, pendingSinceAt: { not: null } },
    select: { id: true, code: true, groupName: true, contactId: true, pendingSinceAt: true, lastClientWho: true, lastClientText: true, alertedAt: true },
    orderBy: { pendingSinceAt: "asc" },
  });
  const contactIds = hilos.map((h) => h.contactId).filter((x): x is string => Boolean(x));
  const contactos = contactIds.length
    ? await prisma.contact.findMany({ where: { id: { in: contactIds } }, select: { id: true, name: true, phone: true } })
    : [];
  const nombreDe = new Map(contactos.map((c) => [c.id, c.name || (c.phone ? `+${c.phone.replace(/\D/g, "")}` : "contacto")]));
  const out: Array<Esperando & { id: string; alertedAt: Date | null }> = [];
  for (const h of hilos) {
    if (!h.pendingSinceAt) continue;
    if (h.contactId) {
      const resp = await prisma.message.findFirst({
        where: { contactId: h.contactId, direction: "out", createdAt: { gt: h.pendingSinceAt } },
        select: { createdAt: true },
      });
      if (resp) {
        await prisma.supportThread.update({ where: { id: h.id }, data: { lastTeamAt: resp.createdAt, pendingSinceAt: null, alertedAt: null } });
        continue;
      }
    }
    out.push({
      id: h.id, alertedAt: h.alertedAt, code: h.code, desde: h.pendingSinceAt,
      nombre: h.groupName ?? (h.contactId ? nombreDe.get(h.contactId) ?? "contacto" : `#${h.code}`),
      quien: h.lastClientWho ?? "", texto: h.lastClientText ?? "",
    });
  }
  return out;
}

/** Cada 10 min: un aviso por cada cliente que pasó el tope sin respuesta (una vez por consulta). Devuelve cuántos. */
export async function alertarSinRespuesta(ahora: Date = new Date()): Promise<number> {
  let avisos = 0;
  for (const cuenta of await cuentasConRelay()) {
    for (const e of paraAlertar(await esperandoAhora(cuenta.id), ahora, SIN_RESPUESTA_MIN)) {
      if (!(await enviarASoporte(cuenta, textoAlerta(e, ahora)))) break; // sin línea no hay por dónde avisar
      await prisma.supportThread.update({ where: { id: e.id }, data: { alertedAt: ahora } });
      avisos++;
    }
  }
  return avisos;
}

/** A la hora configurada: el resumen del día en el grupo SOPORTE. Devuelve cuántas cuentas lo recibieron. */
export async function mandarResumenDiario(ahora: Date = new Date()): Promise<number> {
  const inicio = inicioDiaAR(ahora);
  let mandados = 0;
  for (const cuenta of await cuentasConRelay()) {
    const jobs = await prisma.claudeJob.findMany({
      where: { userId: cuenta.id, OR: [{ createdAt: { gte: inicio } }, { estado: { in: ["esperando_ok", "nuevo", "trabajando", "aprobado", "ejecutando"] } }] },
      select: { numero: true, estado: true, texto: true, createdAt: true },
      orderBy: { numero: "asc" },
    });
    const esperando = await esperandoAhora(cuenta.id);
    const porHilo = await prisma.supportRelayMsg.groupBy({ by: ["threadId"], where: { createdAt: { gte: inicio } }, _count: { _all: true } });
    const hilos = porHilo.length
      ? await prisma.supportThread.findMany({ where: { id: { in: porHilo.map((p) => p.threadId) }, userId: cuenta.id }, select: { id: true, code: true, groupName: true, contactId: true } })
      : [];
    const contactos = hilos.some((h) => h.contactId)
      ? await prisma.contact.findMany({ where: { id: { in: hilos.map((h) => h.contactId).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true, phone: true } })
      : [];
    const nombreContacto = new Map(contactos.map((c) => [c.id, c.name || (c.phone ? `+${c.phone.replace(/\D/g, "")}` : `#`)]));
    const movimiento: Movimiento[] = hilos.map((h) => ({
      nombre: h.groupName ?? (h.contactId ? nombreContacto.get(h.contactId) ?? `#${h.code}` : `#${h.code}`),
      mensajes: porHilo.find((p) => p.threadId === h.id)?._count._all ?? 0,
    }));
    const texto = textoResumen({ ahora, jobs: resumirJobs(jobs, inicio), esperando, movimiento });
    if (await enviarASoporte(cuenta, texto)) mandados++;
  }
  return mandados;
}
