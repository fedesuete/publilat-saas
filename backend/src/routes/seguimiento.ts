// SEGUIMIENTO AUTOMÁTICO: configurar los pasos de recontacto, el primer mensaje de las listas
// importadas y los límites (tope diario, horario); importar una lista; ver qué se mandó. El envío lo
// hace el job "seguimiento" de la cola (lib/seguimiento.ts). Mismo gate que Envíos masivos.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { leadsFrios, parsePasos, parsearLista, pasoQueToca } from "../lib/seguimiento.js";

export const seguimientoRouter = Router();

const ALLOWED = (process.env.BULK_ALLOWED_EMAILS ?? "federicobogado1997@gmail.com")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

seguimientoRouter.use(async (req, res, next) => {
  const u = await prisma.user.findUnique({ where: { id: req.userId! }, select: { email: true } });
  if (!u || !ALLOWED.includes(u.email.toLowerCase())) return res.status(403).json({ error: "Sección no disponible para esta cuenta." });
  next();
});

async function ensureConfig(userId: string) {
  return (await prisma.followUpConfig.findUnique({ where: { userId } })) ?? prisma.followUpConfig.create({ data: { userId } });
}

// GET /api/seguimiento — config + cuántos esperan + últimos envíos.
seguimientoRouter.get("/", async (req, res) => {
  const userId = req.userId!;
  const cfg = await ensureConfig(userId);
  const pasos = parsePasos(cfg.steps);
  const frios = pasos.length ? await leadsFrios(userId, cfg.maxAgeDays) : [];
  const listos = frios.filter((f) => pasoQueToca(pasos, f.hechos, new Date(f.lastAt)) != null).length;
  const listaPendiente = await prisma.contact.count({ where: { userId, source: "lista", stage: "NUEVO", phone: { not: null }, messages: { none: {} } } });
  const desde = new Date(Date.now() - 24 * 3600 * 1000);
  const hoy = await prisma.followUpTouch.count({ where: { userId, createdAt: { gte: desde } } });
  const ultimos = await prisma.followUpTouch.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 30 });
  const contactos = await prisma.contact.findMany({
    where: { id: { in: ultimos.map((t) => t.contactId) } },
    select: { id: true, name: true, phone: true, stage: true, messages: { where: { direction: "in" }, orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } } },
  });
  const porId = new Map(contactos.map((c) => [c.id, c]));
  return res.json({
    config: {
      enabled: cfg.enabled, steps: cfg.steps, listVariants: cfg.listVariants, dailyCap: cfg.dailyCap,
      hourFrom: cfg.hourFrom, hourTo: cfg.hourTo, tz: cfg.tz, minGapMin: cfg.minGapMin, maxAgeDays: cfg.maxAgeDays,
      lineId: cfg.lineId, lastError: cfg.lastError,
    },
    stats: { enviadosHoy: hoy, friosEsperando: frios.length, friosListos: listos, listaPendiente },
    ultimos: ultimos.map((t) => {
      const c = porId.get(t.contactId);
      const respondio = !!c?.messages[0] && c.messages[0].createdAt > t.createdAt;
      return { id: t.id, kind: t.kind, step: t.step, ok: t.ok, createdAt: t.createdAt, contactId: t.contactId, name: c?.name ?? null, phone: c?.phone ?? null, stage: c?.stage ?? null, respondio };
    }),
  });
});

const variantSchema = z.union([
  z.object({ kind: z.literal("text"), body: z.string().min(1).max(1000) }),
  z.object({ kind: z.literal("audio"), clipId: z.string().min(1).max(40) }),
]);
const cfgSchema = z.object({
  enabled: z.boolean().optional(),
  steps: z.array(z.object({ afterDays: z.number().min(0.5).max(60), variants: z.array(variantSchema).max(10) })).max(6).optional(),
  listVariants: z.array(variantSchema).max(10).optional(),
  dailyCap: z.number().int().min(1).max(300).optional(),
  hourFrom: z.number().int().min(0).max(23).optional(),
  hourTo: z.number().int().min(1).max(24).optional(),
  minGapMin: z.number().int().min(2).max(240).optional(),
  maxAgeDays: z.number().int().min(1).max(365).optional(),
  lineId: z.string().max(40).nullable().optional(),
});

// PUT /api/seguimiento — guarda la config (prender/apagar incluido).
seguimientoRouter.put("/", async (req, res) => {
  const parsed = cfgSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido", details: parsed.error.flatten() });
  await ensureConfig(req.userId!);
  const data = { ...parsed.data };
  if (data.enabled) {
    const actual = await prisma.followUpConfig.findUnique({ where: { userId: req.userId! } });
    const pasos = parsePasos(data.steps ?? actual?.steps);
    const lista = (data.listVariants ?? (actual?.listVariants as unknown[] | undefined) ?? []).length;
    if (!pasos.length && !lista) return res.status(400).json({ error: "Cargá al menos un mensaje antes de prenderlo." });
  }
  await prisma.followUpConfig.update({ where: { userId: req.userId! }, data: { ...data, ...(data.enabled !== undefined ? { lastError: null } : {}) } });
  return res.json({ ok: true });
});

// POST /api/seguimiento/importar — { texto } una persona por línea ("Nombre, 5959…" o solo el número).
// Crea contactos en el CRM con origen "lista"; los que ya existen se saltean (no se les escribe de nuevo).
const importSchema = z.object({ texto: z.string().min(1).max(500_000) });
seguimientoRouter.post("/importar", async (req, res) => {
  const parsed = importSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Pegá o subí la lista." });
  const userId = req.userId!;
  const { filas, invalidas } = parsearLista(parsed.data.texto);
  if (filas.length > 5000) return res.status(400).json({ error: "Máximo 5.000 números por vez." });
  // Mismo número con o sin el 9 de Argentina (54 vs 549) cuenta como repetido.
  const variantes = (p: string) => [p, p.startsWith("549") ? "54" + p.slice(3) : p.startsWith("54") ? "549" + p.slice(2) : p];
  const existentes = new Set(
    (await prisma.contact.findMany({ where: { userId, phone: { in: filas.flatMap((f) => variantes(f.phone)) } }, select: { phone: true } }))
      .map((c) => c.phone!),
  );
  let creados = 0, repetidos = 0;
  for (const f of filas) {
    if (variantes(f.phone).some((p) => existentes.has(p))) { repetidos++; continue; }
    await prisma.contact.create({ data: { userId, externalId: crypto.randomUUID(), phone: f.phone, name: f.name, source: "lista", stage: "NUEVO" } });
    existentes.add(f.phone);
    creados++;
  }
  return res.json({ creados, repetidos, invalidas });
});
