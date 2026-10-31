// POST /api/soporte/portal/mensaje — el PORTAL de clientes de Lucky Soft avisa de un ticket nuevo o de un mensaje
// del cliente (2026-10-23). Se reenvía al grupo SOPORTE como un hilo más del relay; el equipo responde con "B-"
// citándolo y la respuesta vuelve al ticket (ver lib/soporte-portal.ts y lib/soporte-relay.ts).
// Firmado con HMAC-SHA256 (header X-Firma) sobre el cuerpo crudo. Idempotente por eventoId: si el portal reintenta,
// no se reenvía dos veces. Si no se pudo dejar en SOPORTE responde 503 para que el portal lo reintente.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { firmaValida, textoDesdePortal, resolverDestino } from "../lib/soporte-portal.js";
import { hiloDePortal, enviarTexto, gruposDeSesion } from "../lib/soporte-relay.js";

export const soportePortalRouter = Router();

const mensajeSchema = z.object({
  ticketId: z.union([z.string().trim().min(1).max(40), z.number().int()]).transform(String),
  cliente: z.string().trim().max(120).default(""),
  email: z.string().trim().max(200).default(""),
  asunto: z.string().trim().max(200).default(""),
  mensaje: z.string().max(6000),
  adjuntos: z.array(z.unknown()).max(20).optional(), // el portal todavía no acepta capturas
  eventoId: z.string().trim().min(1).max(120),
  url: z.string().trim().max(500).optional(),
  categoria: z.string().trim().max(60).optional(),
  prioridad: z.string().trim().max(30).optional(),
});

/** La cuenta del número de soporte (relay prendido + grupo SOPORTE) y la sesión de WhatsApp desde la que se escribe. */
async function cuentaSoporte(): Promise<{ userId: string; groupId: string; session: string } | null> {
  const u = await prisma.user.findFirst({
    where: { supportRelayEnabled: true, supportGroupId: { not: null } },
    select: { id: true, supportGroupId: true },
    orderBy: { createdAt: "asc" },
  });
  if (!u?.supportGroupId) return null;
  const l = await prisma.waLine.findFirst({
    where: { userId: u.id, connected: true, status: "active", provider: { not: "cloud" } },
    select: { id: true, sessionId: true },
    orderBy: { createdAt: "asc" },
  });
  if (!l) return null;
  return { userId: u.id, groupId: u.supportGroupId, session: l.sessionId ?? `line_${l.id}` };
}

soportePortalRouter.post("/mensaje", async (req, res) => {
  const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
  if (!firmaValida(raw, req.get("x-firma"))) return res.status(401).json({ ok: false, error: "firma inválida" });
  const parsed = mensajeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "cuerpo inválido" });
  const d = parsed.data;

  const cuenta = await cuentaSoporte();
  if (!cuenta) return res.status(503).json({ ok: false, error: "soporte no disponible (línea de soporte desconectada)" });

  const hilo = await hiloDePortal(cuenta.userId, d.ticketId, d.email);
  if (d.email) await prisma.supportThread.update({ where: { id: hilo.id }, data: { portalEmail: d.email } }).catch(() => undefined);

  // Candado de idempotencia: el mismo eventoId del portal se reenvía UNA sola vez.
  const messageId = `portal:${d.eventoId}`;
  try {
    await prisma.supportRelayMsg.create({ data: { messageId, threadId: hilo.id } });
  } catch {
    return res.json({ ok: true, codigo: hilo.code, repetido: true });
  }

  try {
    const groupMsgId = await enviarTexto(cuenta.session, cuenta.groupId, textoDesdePortal({
      code: hilo.code, ticketId: d.ticketId, cliente: d.cliente, email: d.email, asunto: d.asunto,
      mensaje: d.mensaje, categoria: d.categoria, prioridad: d.prioridad, url: d.url,
    }));
    if (groupMsgId) await prisma.supportRelayMsg.update({ where: { messageId }, data: { groupMsgId } });
    return res.json({ ok: true, codigo: hilo.code });
  } catch (e) {
    await prisma.supportRelayMsg.deleteMany({ where: { messageId } }); // que el reintento del portal lo vuelva a traer
    console.error("[soporte-portal] no se pudo dejar en SOPORTE:", e instanceof Error ? e.message : String(e));
    return res.status(503).json({ ok: false, error: "no se pudo reenviar a soporte, reintentá" });
  }
});

// POST /api/soporte/portal/enviar — el portal manda un WhatsApp DESDE el número de soporte (2026-10-31: facturas)
// al grupo del cliente o, si no tiene grupo, a su 1 a 1. Misma firma que /mensaje. Contesta antes de los 15 s
// del portal: 2xx = enviado; cualquier otra cosa = no enviado (el equipo lo reenvía con el mismo eventoId).
const enviarSchema = z.object({
  grupo: z.string().max(200).default(""),
  to: z.string().max(40).default(""),
  text: z.string().min(1).max(6000),
  link: z.string().max(500).optional(), // informativo: ya viene dentro de text
  eventoId: z.string().trim().min(1).max(120),
});
const PLAZO_MS = 12_000;

soportePortalRouter.post("/enviar", async (req, res) => {
  const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
  if (!firmaValida(raw, req.get("x-firma"))) return res.status(401).json({ ok: false, error: "firma inválida" });
  const parsed = enviarSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "cuerpo inválido" });
  const d = parsed.data;

  const previo = await prisma.portalEnvio.findUnique({ where: { eventoId: d.eventoId }, select: { estado: true } });
  if (previo?.estado === "enviado") return res.json({ ok: true, duplicado: true });
  if (previo) return res.status(409).json({ ok: false, error: "ese envío todavía está en curso; revisá el chat antes de reenviarlo" });

  const cuenta = await cuentaSoporte();
  if (!cuenta) return res.status(502).json({ ok: false, error: "el número de soporte está desconectado" });

  let grupos: { jid: string; nombre: string }[] = [];
  if (d.grupo.trim() && !/@g\.us$/i.test(d.grupo.trim())) {
    try {
      grupos = await gruposDeSesion(cuenta.session);
    } catch (e) {
      console.error(`[portal-enviar] ${d.eventoId}: no pude leer los grupos:`, e instanceof Error ? e.message : String(e));
      return res.status(502).json({ ok: false, error: "no se pudo leer la lista de grupos del número de soporte" });
    }
  }
  const destino = resolverDestino(d.grupo, d.to, grupos);
  if (!destino.ok) {
    console.warn(`[portal-enviar] ${d.eventoId}: ${destino.error}`);
    return res.status(destino.status).json({ ok: false, error: destino.error });
  }

  // Candado: si dos pedidos con el mismo eventoId llegan juntos, el segundo choca acá.
  try {
    await prisma.portalEnvio.create({ data: { eventoId: d.eventoId, destino: destino.log } });
  } catch {
    return res.status(409).json({ ok: false, error: "ese envío todavía está en curso; revisá el chat antes de reenviarlo" });
  }

  // El envío sigue aunque pase el plazo: el resultado final queda en la tabla (enviado, o se borra si falló).
  const envio = enviarTexto(cuenta.session, destino.chatId, d.text).then(
    async (waMsgId) => {
      await prisma.portalEnvio.update({ where: { eventoId: d.eventoId }, data: { estado: "enviado", waMsgId: waMsgId ?? null } });
      return { ok: true as const };
    },
    async (e: unknown) => {
      await prisma.portalEnvio.deleteMany({ where: { eventoId: d.eventoId } }); // que se pueda reintentar
      const ax = e as { response?: { status?: number } };
      return { ok: false as const, error: ax?.response?.status ? `WhatsApp respondió ${ax.response.status}` : e instanceof Error ? e.message : String(e) };
    },
  ).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) })); // nunca un rechazo suelto
  const plazo = new Promise<"plazo">((z) => setTimeout(() => z("plazo"), PLAZO_MS));
  const r = await Promise.race([envio, plazo]);

  if (r === "plazo") {
    await prisma.portalEnvio.updateMany({ where: { eventoId: d.eventoId, estado: "enviando" }, data: { estado: "incierto" } });
    console.warn(`[portal-enviar] ${d.eventoId} → ${destino.log}: tardó más de ${PLAZO_MS / 1000} s, sigue en curso`);
    return res.status(504).json({ ok: false, error: "WhatsApp está tardando; reintentá en un minuto con el mismo eventoId" });
  }
  if (!r.ok) {
    console.error(`[portal-enviar] ${d.eventoId} → ${destino.log}: falló (${r.error})`);
    return res.status(502).json({ ok: false, error: r.error });
  }
  console.log(`[portal-enviar] ${d.eventoId} → ${destino.log}: enviado`);
  return res.json({ ok: true });
});

// POST /api/soporte/portal/grupos — nombres EXACTOS (y JID) de los grupos donde está el número de soporte, para
// cargarlos en el portal. Firmado igual (cuerpo "{}"). Es POST porque la firma va sobre el cuerpo.
soportePortalRouter.post("/grupos", async (req, res) => {
  const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
  if (!firmaValida(raw, req.get("x-firma"))) return res.status(401).json({ ok: false, error: "firma inválida" });
  const cuenta = await cuentaSoporte();
  if (!cuenta) return res.status(502).json({ ok: false, error: "el número de soporte está desconectado" });
  try {
    const grupos = await gruposDeSesion(cuenta.session);
    return res.json({ ok: true, grupos: grupos.sort((a, b) => a.nombre.localeCompare(b.nombre)) });
  } catch (e) {
    return res.status(502).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
