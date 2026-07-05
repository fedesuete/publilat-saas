// Redirector de links rastreados de automatizaciones (público): GET /r/:code
// registra el clic (quién y cuándo) y redirige al destino. Estilo tracking de ManyChat.
import { Router } from "express";
import { prisma } from "../lib/prisma.js";

export const trackRouter = Router();

trackRouter.get("/r/:code", async (req, res) => {
  const code = req.params.code;
  if (!code || code.length > 40) return res.status(404).send("Link inválido");
  const link = await prisma.trackedLink.findUnique({ where: { id: code } });
  if (!link) return res.status(404).send("Link no encontrado");
  // El destino se validó al crear el paso (zod .url() y http/https).
  await prisma.trackedLink
    .update({ where: { id: link.id }, data: { clicks: { increment: 1 }, lastClickAt: new Date() } })
    .catch(() => undefined);
  return res.redirect(302, link.url);
});
