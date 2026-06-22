// Onboarding: estado real de los 3 pasos clave para que el loop funcione.
import { Router } from "express";
import { prisma } from "../lib/prisma.js";

export const setupRouter = Router();

// GET /api/setup/status — { pixel, landing, whatsapp } según el estado real del usuario.
setupRouter.get("/status", async (req, res) => {
  const userId = req.userId!;
  const [pixel, landing, whatsapp] = await Promise.all([
    prisma.pixel.count({ where: { userId } }),
    prisma.landing.count({ where: { userId, published: true } }),
    prisma.waLine.count({ where: { userId, connected: true } }),
  ]);
  return res.json({
    pixel: pixel > 0,
    landing: landing > 0,
    whatsapp: whatsapp > 0,
  });
});
