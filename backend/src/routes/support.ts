// Soporte del lado del cliente: hilo 1-a-1 con el dueño (admin). Bajo requireAuth.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { emitToUser } from "../lib/io.js";
import { emitToAdmins } from "./admin.js";
import { sendAdminMail } from "../lib/mailer.js";

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
