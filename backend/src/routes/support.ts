// Soporte del lado del cliente: hilo 1-a-1 con el dueño (admin). Bajo requireAuth.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { emitToUser } from "../lib/io.js";
import { emitToAdmins } from "./admin.js";
import { sendAdminMail } from "../lib/mailer.js";
import { enqueueSupportTriage } from "../lib/queue.js";

export const supportRouter = Router();

// GET /api/support — mi hilo. Marca como leídos los mensajes del admin.
supportRouter.get("/", async (req, res) => {
  const userId = req.userId!;
  const messages = await prisma.supportMessage.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  await prisma.supportMessage.updateMany({ where: { userId, fromAdmin: true, readAt: null }, data: { readAt: new Date() } });
  return res.json({ messages });
});

const sendSchema = z.object({ body: z.string().min(1).max(4000) });

// POST /api/support — el cliente escribe al soporte.
supportRouter.post("/", async (req, res) => {
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido" });
  const userId = req.userId!;
  const msg = await prisma.supportMessage.create({ data: { userId, fromAdmin: false, body: parsed.data.body } });
  emitToUser(userId, "support:message", msg); // eco para otras pestañas del cliente
  void emitToAdmins("support:incoming", { userId, message: msg });

  // ACUSE AUTOMÁTICO (pedido del dueño 2026-09-16): el cliente sabe al instante que su reclamo fue
  // derivado. Una vez por "episodio": no si un humano respondió en las últimas 2 h ni si ya se mandó un
  // acuse en las últimas 6 h (si escribe 5 mensajes seguidos, recibe UN acuse).
  void (async () => {
    const h2 = new Date(Date.now() - 2 * 3_600_000), h6 = new Date(Date.now() - 6 * 3_600_000);
    const [humano, acuse] = await Promise.all([
      prisma.supportMessage.findFirst({ where: { userId, fromAdmin: true, createdAt: { gte: h2 }, NOT: { body: { startsWith: "🤖" } } } }),
      prisma.supportMessage.findFirst({ where: { userId, fromAdmin: true, createdAt: { gte: h6 }, body: { startsWith: "🤖" } } }),
    ]);
    if (humano || acuse) return;
    const ack = await prisma.supportMessage.create({
      data: {
        userId,
        fromAdmin: true,
        // Marca DURA de "esto lo mandó el robot". Antes se distinguía por el emoji del texto, y un
        // acuse hacía parecer atendido un ticket que nadie había contestado (25/09: una clienta
        // esperó 35 h y preguntó dos veces, invisible en el tablero).
        auto: true,
        readAt: new Date(),
        body:
          "🤖 Mensaje automático: recibimos su mensaje y ya lo derivamos al área correspondiente. " +
          "Estamos trabajando para resolverlo lo antes posible y le respondemos por este mismo medio.",
      },
    });
    emitToUser(userId, "support:message", ack);
  })().catch(() => undefined);

  // REVISIÓN POR IA (solo propone; el admin aprueba en el panel). Debounce de 2 min por cliente para
  // revisar el hilo completo y no cada mensaje suelto.
  enqueueSupportTriage(userId);
  // Aviso por email al equipo (ADMIN_ALERT_EMAIL). Best-effort, no frena la respuesta.
  void (async () => {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { slug: true, email: true } });
    await sendAdminMail(
      `📩 Soporte — nuevo mensaje de ${u?.slug ?? userId}`,
      `Cliente: ${u?.slug ?? ""} (${u?.email ?? ""})\n\nMensaje:\n${parsed.data.body}`,
    );
  })().catch(() => undefined);
  return res.status(201).json({ message: msg });
});
