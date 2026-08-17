// Galería de plantillas server-side: lista para el panel + preview renderizado.
// Protegido por requireAuth (montado en index.ts). El panel trae el preview por fetch
// autenticado y lo mete en un iframe srcdoc — la API es bearer sin cookie, un iframe
// con src directo no autentica.
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { resolveUserPixel } from "../lib/pixel.js";
import { injectInAppEscape } from "../lib/landing-template.js";
import { TEMPLATES, getTemplate, renderTemplate } from "../lib/landing-templates/index.js";

export const landingTemplatesRouter = Router();

// GET /api/landing-templates — lista para la galería (sin HTML).
landingTemplatesRouter.get("/", (_req, res) => {
  res.json({
    templates: TEMPLATES.map(({ id, name, desc, category, fields }) => ({ id, name, desc, category, fields })),
  });
});

// GET /api/landing-templates/:id/preview?brand=...&line=... — HTML con defaults ⊕ query.
landingTemplatesRouter.get("/:id/preview", async (req, res) => {
  const def = getTemplate(req.params.id);
  if (!def) return res.status(404).json({ error: "Plantilla no encontrada" });
  const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { slug: true } });
  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });
  const creds = await resolveUserPixel(req.userId!, "Lead").catch(() => undefined);

  const values: Record<string, string> = {};
  for (const f of def.fields) {
    const v = req.query[f.key];
    if (typeof v === "string" && v) values[f.key] = v;
  }
  const line = typeof req.query.line === "string" && req.query.line ? req.query.line : undefined;

  const html = renderTemplate(def, {
    pixelId: creds?.pixelId ?? "",
    userSlug: user.slug,
    goBase: process.env.APP_BASE_URL ?? "",
    line,
    values,
  });
  return res.type("html").send(injectInAppEscape(html));
});
