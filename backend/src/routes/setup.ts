// Onboarding: estado real de los 3 pasos clave para que el loop funcione.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { aiEnabled } from "../lib/ai-receipt.js";

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

// GET /api/setup/payment-detection — modo actual + si la IA de visión está disponible.
setupRouter.get("/payment-detection", async (req, res) => {
  const userId = req.userId!;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { paymentDetection: true },
  });
  return res.json({ mode: user?.paymentDetection ?? "off", aiEnabled: aiEnabled() });
});

const modeSchema = z.object({ mode: z.enum(["off", "assisted", "auto"]) });

// PUT /api/setup/payment-detection — cambia el modo (off | assisted | auto).
setupRouter.put("/payment-detection", async (req, res) => {
  const userId = req.userId!;
  const parsed = modeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Modo inválido" });
  }
  await prisma.user.update({
    where: { id: userId },
    data: { paymentDetection: parsed.data.mode },
  });
  return res.json({ mode: parsed.data.mode, aiEnabled: aiEnabled() });
});
