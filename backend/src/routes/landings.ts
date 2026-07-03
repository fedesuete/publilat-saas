// CRUD de landings del editor (Fase 5). Protegido por requireAuth.
// Genera el HTML rastreado (pixel + CTA dedup) y lo guarda; publica en S3 o local.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { resolveUserPixel } from "../lib/pixel.js";
import { renderTrackedLanding, type LandingConfig } from "../lib/landing-template.js";
import { publishToS3 } from "../lib/s3.js";
import { slugify } from "../lib/auth.js";
import { getAvailableDays } from "../lib/access.js";

export const landingsRouter = Router();

const configSchema = z.object({
  title: z.string().max(80).optional(),
  headline: z.string().max(120).optional(),
  subtitle: z.string().max(240).optional(),
  buttonText: z.string().max(40).optional(),
  msg: z.string().max(400).optional(),
  autoRedirect: z.boolean().optional(), // pasa 1 seg por la landing y redirige a WhatsApp
});
type Cfg = z.infer<typeof configSchema>;

// Slug único para la Landing a partir del nombre.
async function uniqueLandingSlug(base: string): Promise<string> {
  const root = slugify(base) || "landing";
  let candidate = root;
  let n = 1;
  while (await prisma.landing.findUnique({ where: { slug: candidate } })) {
    candidate = `${root}-${n++}`;
  }
  return candidate;
}

// Construye el HTML a partir de la config + datos del usuario.
async function buildHtml(userId: string, userSlug: string, cfg: Cfg): Promise<string> {
  const creds = await resolveUserPixel(userId, "Lead");
  const full: LandingConfig = {
    pixelId: creds?.pixelId ?? process.env.META_PIXEL_ID ?? "",
    userSlug,
    goBase: process.env.APP_BASE_URL ?? "",
    title: cfg.title ?? "Publi.lat",
    headline: cfg.headline ?? cfg.title ?? "Hablá con nosotros",
    subtitle: cfg.subtitle ?? "Escribinos por WhatsApp y te atendemos al toque.",
    buttonText: cfg.buttonText ?? "Hablar por WhatsApp",
    msg: cfg.msg ?? "Hola, quiero info",
    autoRedirect: cfg.autoRedirect ?? false,
  };
  return renderTrackedLanding(full);
}

// GET /api/landings — lista las landings del usuario.
landingsRouter.get("/", async (req, res) => {
  const landings = await prisma.landing.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, name: true, slug: true, config: true,
      isPrimary: true, published: true, publishedUrl: true, createdAt: true,
    },
  });
  return res.json({ landings });
});

// html: HTML libre (anula el editor por campos). config: editor por campos.
const createSchema = z.object({
  name: z.string().min(1).max(80),
  config: configSchema.optional(),
  html: z.string().min(1).max(200000).optional(),
});

// POST /api/landings — crea la landing (genera slug + html, o usa el HTML libre).
landingsRouter.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Input inválido", details: parsed.error.flatten() });
  }
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });

  // Tope de landings del plan (configurable por cliente desde el panel).
  const landingCount = await prisma.landing.count({ where: { userId: user.id } });
  if (landingCount >= user.maxLandings) {
    return res.status(403).json({
      error: `Alcanzaste el límite de landings de tu plan (${user.maxLandings}). Escribinos para ampliarlo.`,
      code: "LANDING_LIMIT",
    });
  }

  const cfg = parsed.data.config ?? {};
  const slug = await uniqueLandingSlug(parsed.data.name);
  const raw = Boolean(parsed.data.html);
  const html = raw ? parsed.data.html! : await buildHtml(user.id, user.slug, cfg);
  const landing = await prisma.landing.create({
    data: { userId: user.id, name: parsed.data.name, slug, html, config: raw ? { raw: true } : cfg },
    select: { id: true, name: true, slug: true, config: true, isPrimary: true, published: true, publishedUrl: true, createdAt: true },
  });
  return res.status(201).json({ landing });
});

const updateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  config: configSchema.optional(),
  html: z.string().min(1).max(200000).optional(),
  isPrimary: z.boolean().optional(),
});

// PUT /api/landings/:id — actualiza nombre/config (regenera html) o marca primaria.
landingsRouter.put("/:id", async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Input inválido", details: parsed.error.flatten() });
  }
  const existing = await prisma.landing.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!existing) return res.status(404).json({ error: "Landing no encontrada" });
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });

  const data: Record<string, unknown> = {};
  if (parsed.data.name) data.name = parsed.data.name;
  if (parsed.data.html) {
    // HTML libre: lo guardamos tal cual.
    data.html = parsed.data.html;
    data.config = { raw: true };
  } else if (parsed.data.config) {
    const merged = { ...(existing.config as Cfg | null ?? {}), ...parsed.data.config };
    data.config = merged;
    data.html = await buildHtml(req.userId!, user!.slug, merged);
  }
  if (parsed.data.isPrimary !== undefined) {
    if (parsed.data.isPrimary) {
      // Sólo una primaria por usuario.
      await prisma.landing.updateMany({ where: { userId: req.userId! }, data: { isPrimary: false } });
    }
    data.isPrimary = parsed.data.isPrimary;
  }

  const landing = await prisma.landing.update({
    where: { id: existing.id },
    data,
    select: { id: true, name: true, slug: true, config: true, isPrimary: true, published: true, publishedUrl: true, createdAt: true },
  });
  return res.json({ landing });
});

// POST /api/landings/:id/publish — publica en S3/CloudFront o, si no hay creds, local (/p/:slug).
landingsRouter.post("/:id/publish", async (req, res) => {
  const landing = await prisma.landing.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!landing) return res.status(404).json({ error: "Landing no encontrada" });

  // Paywall: publicar requiere días. Sin crédito, le pedimos pagar.
  const days = await getAvailableDays(req.userId!);
  if (days < 1) {
    return res.status(402).json({
      error: "Necesitás días para publicar. Comprá días en Créditos y volvé a publicar tu landing.",
      code: "NEEDS_CREDITS",
    });
  }

  const s3Url = await publishToS3(landing.slug, landing.html);
  const publishedUrl = s3Url ?? `${process.env.APP_BASE_URL ?? ""}/p/${landing.slug}`;
  const updated = await prisma.landing.update({
    where: { id: landing.id },
    data: { published: true, publishedUrl },
    select: { id: true, slug: true, published: true, publishedUrl: true },
  });
  return res.json({ landing: updated, host: s3Url ? "s3" : "local" });
});

// DELETE /api/landings/:id
landingsRouter.delete("/:id", async (req, res) => {
  const landing = await prisma.landing.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!landing) return res.status(404).json({ error: "Landing no encontrada" });
  await prisma.landing.delete({ where: { id: landing.id } });
  return res.json({ ok: true });
});
