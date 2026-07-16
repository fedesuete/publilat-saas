// Tutoriales en video del panel.
//  - tutorialsRouter (cliente, requireAuth): lista los tutoriales ACTIVOS para /tutoriales.
//  - tutorialsAdminRouter (admin, requireAdmin): ABM de tutoriales desde el panel maestro.
// El video no se aloja acá: se guarda la URL (YouTube/Vimeo/mp4) y el front arma el embed.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";

export const tutorialsRouter = Router();
export const tutorialsAdminRouter = Router();

// ---- Cliente: sólo los activos, ordenados ----
tutorialsRouter.get("/", async (_req, res) => {
  const tutorials = await prisma.tutorial.findMany({
    where: { active: true },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { id: true, title: true, description: true, videoUrl: true },
  });
  return res.json({ tutorials });
});

// ---- Admin: ABM completo ----
const upsertSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(2000).optional().nullable(),
  videoUrl: z.string().url("El link del video no es válido").max(500),
  order: z.number().int().optional(),
  active: z.boolean().optional(),
});

// GET /api/admin/tutorials — todos (incluye inactivos), ordenados.
tutorialsAdminRouter.get("/", async (_req, res) => {
  const tutorials = await prisma.tutorial.findMany({
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
  return res.json({ tutorials });
});

// POST /api/admin/tutorials — crea. Si no mandan orden, lo pone al final.
tutorialsAdminRouter.post("/", async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido", details: parsed.error.flatten() });
  const { title, description, videoUrl, order, active } = parsed.data;
  const nextOrder = order ?? (((await prisma.tutorial.aggregate({ _max: { order: true } }))._max.order ?? 0) + 1);
  const tutorial = await prisma.tutorial.create({
    data: { title, description: description ?? null, videoUrl, order: nextOrder, active: active ?? true },
  });
  return res.status(201).json({ tutorial });
});

// PUT /api/admin/tutorials/:id — actualiza campos.
tutorialsAdminRouter.put("/:id", async (req, res) => {
  const parsed = upsertSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido", details: parsed.error.flatten() });
  const existing = await prisma.tutorial.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Tutorial no encontrado" });
  const d = parsed.data;
  const tutorial = await prisma.tutorial.update({
    where: { id: existing.id },
    data: {
      ...(d.title !== undefined ? { title: d.title } : {}),
      ...(d.description !== undefined ? { description: d.description ?? null } : {}),
      ...(d.videoUrl !== undefined ? { videoUrl: d.videoUrl } : {}),
      ...(d.order !== undefined ? { order: d.order } : {}),
      ...(d.active !== undefined ? { active: d.active } : {}),
    },
  });
  return res.json({ tutorial });
});

// DELETE /api/admin/tutorials/:id
tutorialsAdminRouter.delete("/:id", async (req, res) => {
  const existing = await prisma.tutorial.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Tutorial no encontrado" });
  await prisma.tutorial.delete({ where: { id: existing.id } });
  return res.json({ ok: true });
});
