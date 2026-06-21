// Servido público de landings rastreadas.
//   GET /l/:slug  -> landing de demo por slug de USUARIO (rápida, sin guardar).
//   GET /p/:slug  -> landing GUARDADA del editor (Fase 5), por slug de Landing.
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { resolveUserPixel } from "../lib/pixel.js";
import { renderTrackedLanding } from "../lib/landing-template.js";

export const landingRouter = Router();

// Demo: arma una landing al vuelo a partir del slug del usuario.
landingRouter.get("/l/:slug", async (req, res) => {
  const user = await prisma.user.findUnique({ where: { slug: req.params.slug } });
  if (!user) return res.status(404).send("Landing no encontrada");

  const creds = await resolveUserPixel(user.id, "Lead");
  const pixelId = creds?.pixelId ?? process.env.META_PIXEL_ID ?? "";
  const msg = req.query.msg ? String(req.query.msg) : "Hola, quiero info";
  const title = req.query.title ? String(req.query.title) : (user.name ?? "Publi.lat");

  res.set("Content-Type", "text/html; charset=utf-8");
  return res.send(
    renderTrackedLanding({
      pixelId,
      userSlug: user.slug,
      goBase: process.env.APP_BASE_URL ?? "",
      title,
      headline: title,
      subtitle: "Escribinos por WhatsApp y te atendemos al toque.",
      buttonText: "Hablar por WhatsApp",
      msg,
    })
  );
});

// Guardada: sirve el HTML almacenado de la Landing (editor). publishedUrl puede apuntar
// acá (fallback) o a S3/CloudFront cuando hay credenciales.
landingRouter.get("/p/:slug", async (req, res) => {
  const landing = await prisma.landing.findUnique({ where: { slug: req.params.slug } });
  if (!landing) return res.status(404).send("Landing no encontrada");
  res.set("Content-Type", "text/html; charset=utf-8");
  return res.send(landing.html);
});
