// Notificaciones del usuario: listar + marcar leídas. Bajo requireAuth.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";

export const notificationsRouter = Router();

// GET /api/notifications — últimas 30 + cantidad de no leídas.
notificationsRouter.get("/", async (req, res) => {
  const userId = req.userId!;
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.notification.count({ where: { userId, read: false } }),
  ]);
  return res.json({ items, unread });
});

const readSchema = z.object({ id: z.string().optional(), all: z.boolean().optional() });

// POST /api/notifications/read — marca una (id) o todas (all) como leídas.
notificationsRouter.post("/read", async (req, res) => {
  const userId = req.userId!;
  const parsed = readSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Input inválido" });
  if (parsed.data.id) {
    await prisma.notification.updateMany({ where: { id: parsed.data.id, userId }, data: { read: true } });
  } else {
    await prisma.notification.updateMany({ where: { userId, read: false }, data: { read: true } });
  }
  const unread = await prisma.notification.count({ where: { userId, read: false } });
  return res.json({ ok: true, unread });
});
