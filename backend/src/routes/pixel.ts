// «Mi Pixel» (Fase producción): cada usuario gestiona sus Pixel + token de CAPI.
// El token se guarda CIFRADO y nunca se devuelve entero (solo ••••últimos4).
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { encryptSecret, decryptSecret, maskSecret } from "../lib/crypto.js";
import { validatePixelCreds } from "../lib/meta-capi.js";

export const pixelRouter = Router();

const createSchema = z.object({
  pixelId: z.string().trim().min(5).max(40),
  capiToken: z.string().trim().min(10),
  eventType: z.enum(["Lead", "Purchase"]).default("Lead"),
  siteUrl: z.string().url().optional().or(z.literal("")),
});

const updateSchema = z.object({
  pixelId: z.string().trim().min(5).max(40).optional(),
  capiToken: z.string().trim().min(10).optional(), // si llega, reemplaza el cifrado
  eventType: z.enum(["Lead", "Purchase"]).optional(),
  siteUrl: z.string().url().optional().or(z.literal("")),
});

// Forma pública: sin el token entero, con la máscara.
function toPublic(p: { id: string; pixelId: string; eventType: string; siteUrl: string | null; capiToken: string; createdAt: Date }) {
  let tokenMask = "••••";
  try {
    tokenMask = maskSecret(decryptSecret(p.capiToken));
  } catch {
    tokenMask = "•••• (error)";
  }
  return { id: p.id, pixelId: p.pixelId, eventType: p.eventType, siteUrl: p.siteUrl, tokenMask, createdAt: p.createdAt };
}

// GET /api/pixels — pixels del usuario (token enmascarado).
pixelRouter.get("/", async (req, res) => {
  const pixels = await prisma.pixel.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: "desc" },
  });
  return res.json({ pixels: pixels.map(toPublic) });
});

// GET /api/pixels/health — semáforo de la atribución del usuario (para el panel):
// ¿tiene pixel? ¿cuándo fue el último evento enviado OK? ¿cuántos fallaron en 24h?
pixelRouter.get("/health", async (req, res) => {
  const userId = req.userId!;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [pixelCount, lastSent, sent24h, failed24h, noPixel24h] = await Promise.all([
    prisma.pixel.count({ where: { userId } }),
    prisma.metaEvent.findFirst({ where: { userId, status: "sent" }, orderBy: { createdAt: "desc" }, select: { eventName: true, createdAt: true } }),
    prisma.metaEvent.count({ where: { userId, status: "sent", createdAt: { gte: since } } }),
    prisma.metaEvent.count({ where: { userId, status: "failed", createdAt: { gte: since } } }),
    prisma.metaEvent.count({ where: { userId, status: "no_pixel", createdAt: { gte: since } } }),
  ]);
  const hasPixel = pixelCount > 0;
  let status: "ok" | "warning" | "error" | "no_pixel";
  if (!hasPixel || noPixel24h > 0) status = "no_pixel";
  else if (failed24h > 0 && sent24h === 0) status = "error";
  else if (failed24h > 0) status = "warning";
  else if (!lastSent) status = "warning"; // pixel cargado pero todavía sin eventos
  else status = "ok";
  return res.json({ hasPixel, lastSent, sent24h, failed24h, noPixel24h, status });
});

// POST /api/pixels — crea un pixel (cifra el token).
pixelRouter.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Input inválido", details: parsed.error.flatten() });
  }
  const { pixelId, capiToken, eventType, siteUrl } = parsed.data;
  // Validar contra Meta ANTES de guardar: si el token/pixel están mal, avisamos en el acto.
  const v = await validatePixelCreds(pixelId, capiToken);
  if (!v.ok) return res.status(400).json({ error: `El Pixel o el token no son válidos según Meta: ${v.error}` });
  const pixel = await prisma.pixel.create({
    data: {
      userId: req.userId!,
      pixelId,
      capiToken: encryptSecret(capiToken),
      eventType,
      siteUrl: siteUrl || null,
    },
  });
  return res.status(201).json({ pixel: toPublic(pixel) });
});

// PUT /api/pixels/:id — edita (si viene capiToken, lo reemplaza cifrado).
pixelRouter.put("/:id", async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Input inválido", details: parsed.error.flatten() });
  }
  const existing = await prisma.pixel.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!existing) return res.status(404).json({ error: "Pixel no encontrado" });

  const data: Record<string, unknown> = {};
  if (parsed.data.pixelId) data.pixelId = parsed.data.pixelId;
  if (parsed.data.eventType) data.eventType = parsed.data.eventType;
  if (parsed.data.siteUrl !== undefined) data.siteUrl = parsed.data.siteUrl || null;
  if (parsed.data.capiToken) data.capiToken = encryptSecret(parsed.data.capiToken);

  // Si cambió el pixel o el token, revalidar contra Meta (token nuevo o el existente descifrado).
  if (parsed.data.pixelId || parsed.data.capiToken) {
    const effPixel = parsed.data.pixelId ?? existing.pixelId;
    const effToken = parsed.data.capiToken ?? decryptSecret(existing.capiToken);
    const v = await validatePixelCreds(effPixel, effToken);
    if (!v.ok) return res.status(400).json({ error: `El Pixel o el token no son válidos según Meta: ${v.error}` });
  }

  const pixel = await prisma.pixel.update({ where: { id: existing.id }, data });
  return res.json({ pixel: toPublic(pixel) });
});

// DELETE /api/pixels/:id
pixelRouter.delete("/:id", async (req, res) => {
  const existing = await prisma.pixel.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!existing) return res.status(404).json({ error: "Pixel no encontrado" });
  await prisma.pixel.delete({ where: { id: existing.id } });
  return res.json({ ok: true });
});
