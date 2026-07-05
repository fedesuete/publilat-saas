// Automatizaciones/secuencias (tipo ManyChat) — CRUD + stats. Bajo requireAuth.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";

export const flowsRouter = Router();

// Pasos recursivos: un menú tiene opciones y cada opción su propia rama de pasos.
type StepInput = {
  id: string;
  type: "message" | "delay" | "wait_reply" | "menu";
  text?: string;
  minutes?: number;
  options?: Array<{ id: string; label: string; keywords?: string[]; steps: StepInput[] }>;
};

const stepSchema: z.ZodType<StepInput> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    type: z.enum(["message", "delay", "wait_reply", "menu"]),
    text: z.string().max(2000).optional(),
    minutes: z.number().min(0).max(10080).optional(),
    options: z
      .array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1).max(80),
          keywords: z.array(z.string().max(40)).max(10).optional(),
          steps: z.array(stepSchema).max(30),
        }),
      )
      .max(9) // el menú numerado soporta 1-9
      .optional(),
  }),
);

const flowSchema = z.object({
  name: z.string().min(1).max(80),
  enabled: z.boolean().optional(),
  trigger: z.enum(["first_message", "keyword"]),
  keyword: z.string().max(60).optional(),
  steps: z.array(stepSchema).max(50),
});

flowsRouter.get("/", async (req, res) => {
  const flows = await prisma.flow.findMany({ where: { userId: req.userId! }, orderBy: { createdAt: "desc" } });
  // Stats: cuántos contactos entraron y cuántos terminaron cada secuencia.
  const ids = flows.map((f) => f.id);
  const grouped = ids.length
    ? await prisma.flowRun.groupBy({ by: ["flowId", "status"], where: { flowId: { in: ids } }, _count: { _all: true } })
    : [];
  const stats: Record<string, { total: number; done: number; active: number }> = {};
  for (const g of grouped) {
    const s = (stats[g.flowId] ??= { total: 0, done: 0, active: 0 });
    s.total += g._count._all;
    if (g.status === "done") s.done += g._count._all;
    else s.active += g._count._all;
  }
  return res.json({ flows: flows.map((f) => ({ ...f, stats: stats[f.id] ?? { total: 0, done: 0, active: 0 } })) });
});

flowsRouter.post("/", async (req, res) => {
  const parsed = flowSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido", details: parsed.error.flatten() });
  const d = parsed.data;
  const flow = await prisma.flow.create({
    data: { userId: req.userId!, name: d.name, enabled: d.enabled ?? false, trigger: d.trigger, keyword: d.keyword ?? null, steps: d.steps as object },
  });
  return res.status(201).json({ flow });
});

flowsRouter.put("/:id", async (req, res) => {
  const parsed = flowSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido", details: parsed.error.flatten() });
  const existing = await prisma.flow.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!existing) return res.status(404).json({ error: "No encontrado" });
  const d = parsed.data;
  const flow = await prisma.flow.update({
    where: { id: existing.id },
    data: { name: d.name, enabled: d.enabled ?? existing.enabled, trigger: d.trigger, keyword: d.keyword ?? null, steps: d.steps as object },
  });
  return res.json({ flow });
});

flowsRouter.post("/:id/toggle", async (req, res) => {
  const existing = await prisma.flow.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!existing) return res.status(404).json({ error: "No encontrado" });
  const flow = await prisma.flow.update({ where: { id: existing.id }, data: { enabled: !existing.enabled } });
  return res.json({ flow });
});

flowsRouter.delete("/:id", async (req, res) => {
  const existing = await prisma.flow.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!existing) return res.status(404).json({ error: "No encontrado" });
  await prisma.flow.delete({ where: { id: existing.id } });
  return res.json({ ok: true });
});
