// Relay de soporte: toda consulta que entra por WhatsApp se reenvía a UN grupo del equipo.
//
// Por qué así (2026-09-29): el pedido era "que no se nos pase nada" — unificar en un solo lugar las
// consultas que hoy quedan repartidas en el teléfono de cada uno. La forma obvia sería engancharse al
// webhook de WhatsApp, pero ese archivo está en la lista de NO TOCAR (§9.6) y el dueño pidió
// explícitamente no meter mano ahí.
//
// No hace falta: el webhook YA guarda cada mensaje entrante en la tabla Message. Este módulo lee de
// ahí. Es un lector, no un interceptor: si algo de acá falla, el camino de WhatsApp, el Inbox y la
// atribución siguen intactos, porque nunca están en el medio.
//
// Lo que hace, cada vez que corre el job:
//   1. Busca mensajes entrantes nuevos de las cuentas con el relay prendido.
//   2. Le avisa al cliente que su consulta está en camino (UNA vez, no en cada mensaje).
//   3. Deja la consulta en el grupo, con el nombre, el teléfono y un código corto del cliente.
import { prisma } from "./prisma.js";
import { getEngine } from "./wa-engine.js";
import { sendToContact } from "./wa-send.js";

/** Cada cuánto se le puede repetir el acuse al MISMO cliente. Si escribe 5 veces seguidas recibe uno. */
const ACK_MS = Number(process.env.SOPORTE_ACK_HORAS ?? "6") * 3600_000;
/** Hasta qué antigüedad se reenvía. Evita que al prender el relay se vuelque el historial al grupo. */
const VENTANA_MIN = Number(process.env.SOPORTE_RELAY_VENTANA_MIN ?? "30");
/** Tope por corrida: si entra una avalancha, se reparte entre vueltas en vez de inundar el grupo. */
const MAX_POR_VUELTA = Number(process.env.SOPORTE_RELAY_MAX ?? "20");

export const ACK_POR_DEFECTO = "👋 ¡Hola! Recibimos tu consulta y ya la estamos viendo. En un momento te responde alguien del equipo.";

/** Código corto y legible por teléfono. Sin vocales: no salen palabras raras. */
const ALFABETO = "ACDEFGHJKLMNPQRSTUVWXYZ23456789";
function codigoNuevo(): string {
  let s = "";
  for (let i = 0; i < 3; i++) s += ALFABETO[Math.floor(Math.random() * ALFABETO.length)];
  return s;
}

/** El hilo de soporte del contacto (lo crea si es la primera vez). El código es estable. */
export async function hiloDe(userId: string, contactId: string): Promise<{ id: string; code: string; lastAckAt: Date | null }> {
  const existente = await prisma.supportThread.findUnique({ where: { contactId }, select: { id: true, code: true, lastAckAt: true } });
  if (existente) return existente;
  for (let i = 0; i < 12; i++) {
    try {
      return await prisma.supportThread.create({
        data: { userId, contactId, code: codigoNuevo() },
        select: { id: true, code: true, lastAckAt: true },
      });
    } catch {
      // código repetido: reintenta con otro. Si fue otra cosa, la última vuelta lo deja salir.
      const yaEsta = await prisma.supportThread.findUnique({ where: { contactId }, select: { id: true, code: true, lastAckAt: true } });
      if (yaEsta) return yaEsta; // carrera: lo creó otra corrida
    }
  }
  throw new Error("no se pudo crear el hilo de soporte");
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

/** Lo que se deja en el grupo. Aparte para poder testearlo sin red ni base. */
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

/** Sesión de WAHA de la línea por la que entró la consulta (para mandar al grupo desde ese número). */
async function sesionDe(lineId: string | null): Promise<string | null> {
  if (!lineId) return null;
  const l = await prisma.waLine.findUnique({ where: { id: lineId }, select: { id: true, sessionId: true } });
  return l ? (l.sessionId ?? `line_${l.id}`) : null;
}

/**
 * Reenvía al grupo las consultas nuevas y le avisa al cliente. Devuelve cuántas movió.
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

      // CANDADO: si este mensaje ya se reenvió, el unique choca y seguimos de largo. Es lo que
      // garantiza que el grupo no reciba la misma consulta dos veces.
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
        const enviado = await getEngine().sendText(sesion, cuenta.supportGroupId!, texto);
        const groupMsgId: string | undefined = enviado?.key?.id;
        if (groupMsgId) {
          await prisma.supportRelayMsg.update({ where: { messageId: m.id }, data: { groupMsgId } });
        }
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
