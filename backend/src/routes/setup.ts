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

// ---- Sonido de notificación del panel (operador): al llegar un mensaje nuevo. ----
// Se guarda como BrandingAsset (audio) y se sirve por /api/chat/branding/asset/:id (público + CORP).
const soundSchema = z.object({ dataUrl: z.string().regex(/^data:audio\/(mpeg|mp3|ogg|wav|webm|x-m4a|mp4|aac);base64,/, "Audio inválido") });

// GET /api/setup/notif-sound — URL del sonido custom actual (null = usa el "ding" por defecto).
setupRouter.get("/notif-sound", async (req, res) => {
  const u = await prisma.user.findUnique({ where: { id: req.userId! }, select: { notifSoundUrl: true } });
  return res.json({ url: u?.notifSoundUrl ?? null });
});

// POST /api/setup/notif-sound — sube un audio (base64) y lo deja como sonido del panel.
setupRouter.post("/notif-sound", async (req, res) => {
  const parsed = soundSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enviá un audio MP3/OGG/WAV corto." });
  const { dataUrl } = parsed.data;
  const comma = dataUrl.indexOf(",");
  const mime = dataUrl.slice(5, dataUrl.indexOf(";"));
  const buffer = Buffer.from(dataUrl.slice(comma + 1), "base64");
  if (buffer.length > 500 * 1024) return res.status(413).json({ error: "El sonido supera 500 KB. Usá uno más corto/liviano." });
  const asset = await prisma.brandingAsset.create({ data: { userId: req.userId!, contentType: mime, data: buffer }, select: { id: true } });
  const base = (process.env.APP_BASE_URL ?? "http://localhost:4000").replace(/\/$/, "");
  const url = `${base}/api/chat/branding/asset/${asset.id}`;
  await prisma.user.update({ where: { id: req.userId! }, data: { notifSoundUrl: url } });
  return res.json({ url });
});

// DELETE /api/setup/notif-sound — vuelve al "ding" por defecto.
setupRouter.delete("/notif-sound", async (req, res) => {
  await prisma.user.update({ where: { id: req.userId! }, data: { notifSoundUrl: null } });
  return res.json({ ok: true });
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
