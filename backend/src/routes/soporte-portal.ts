// POST /api/soporte/portal/mensaje — el PORTAL de clientes de Lucky Soft avisa de un ticket nuevo o de un mensaje
// del cliente (2026-10-23). Se reenvía al grupo SOPORTE como un hilo más del relay; el equipo responde con "B-"
// citándolo y la respuesta vuelve al ticket (ver lib/soporte-portal.ts y lib/soporte-relay.ts).
// Firmado con HMAC-SHA256 (header X-Firma) sobre el cuerpo crudo. Idempotente por eventoId: si el portal reintenta,
// no se reenvía dos veces. Si no se pudo dejar en SOPORTE responde 503 para que el portal lo reintente.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { firmaValida, textoDesdePortal } from "../lib/soporte-portal.js";
import { hiloDePortal, enviarTexto } from "../lib/soporte-relay.js";

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
