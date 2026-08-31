// ENVÍOS MASIVOS: configurar la campaña (variantes texto/audio, ritmo, audiencia), verla en un
// tablero tipo "clientes potenciales" de Meta y dispararla. Protegido por requireAuth + gate de
// acceso (por ahora solo el dueño; se abre a clientes cuando esté probado).
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { audienceFor, startCampaign, stopCampaign, isRunning } from "../lib/bulk-sender.js";

export const bulkRouter = Router();

// Gate de acceso: durante la prueba, solo las cuentas de esta lista ven la sección. Configurable por
// .env (BULK_ALLOWED_EMAILS="a@x.com,b@y.com"); por defecto, solo el dueño.
const ALLOWED = (process.env.BULK_ALLOWED_EMAILS ?? "federicobogado1997@gmail.com")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

async function allowed(userId: string): Promise<boolean> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  return Boolean(u && ALLOWED.includes(u.email.toLowerCase()));
}

bulkRouter.use(async (req, res, next) => {
  if (!(await allowed(req.userId!))) return res.status(403).json({ error: "Sección no disponible para esta cuenta." });
  next();
});

// Crea la campaña de la cuenta si todavía no existe (una por cuenta).
async function ensureCampaign(userId: string) {
  const found = await prisma.bulkCampaign.findUnique({ where: { userId } });
  return found ?? prisma.bulkCampaign.create({ data: { userId } });
}

// GET /api/bulk — configuración + progreso + tamaño de la audiencia.
bulkRouter.get("/", async (req, res) => {
  const c = await ensureCampaign(req.userId!);
  const aud = await audienceFor(c);
  return res.json({
    campaign: {
      variants: c.variants ?? [], pauseMinS: c.pauseMinS, pauseMaxS: c.pauseMaxS, lineId: c.lineId,
      audSource: c.audSource, audStage: c.audStage, audMaxDays: c.audMaxDays, audLimit: c.audLimit,
      status: isRunning(req.userId!) ? "running" : c.status,
      sent: c.sent, failed: c.failed, lastRunAt: c.lastRunAt, lastError: c.lastError,
    },
    audience: aud,
  });
});

const cfgSchema = z.object({
  variants: z.array(z.union([
    z.object({ kind: z.literal("text"), body: z.string().min(1).max(1000) }),
    z.object({ kind: z.literal("audio"), clipId: z.string().min(1).max(40) }),
  ])).max(10).optional(),
  pauseMinS: z.number().int().min(5).max(3600).optional(),
  pauseMaxS: z.number().int().min(5).max(3600).optional(),
  lineId: z.string().max(40).nullable().optional(),
  audSource: z.string().max(30).nullable().optional(),
  audStage: z.enum(["NUEVO", "CONTACTADO", "INTERESADO", "COMPRO", "PERDIDO"]).optional(),
  audMaxDays: z.number().int().min(1).max(3650).nullable().optional(),
  audLimit: z.number().int().min(1).max(500).optional(),
});

// PUT /api/bulk — guarda la configuración.
bulkRouter.put("/", async (req, res) => {
  const parsed = cfgSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido", details: parsed.error.flatten() });
  await ensureCampaign(req.userId!);
  const data = { ...parsed.data };
  // La pausa mínima nunca puede superar a la máxima (si no, el intervalo sale negativo).
  if (data.pauseMinS && data.pauseMaxS && data.pauseMinS > data.pauseMaxS) data.pauseMaxS = data.pauseMinS;
  const c = await prisma.bulkCampaign.update({ where: { userId: req.userId! }, data });
  const aud = await audienceFor(c);
  return res.json({ ok: true, audience: aud });
});

// POST /api/bulk/start — arranca el envío (asíncrono; el progreso llega por socket y por GET /).
bulkRouter.post("/start", async (req, res) => {
  const err = await startCampaign(req.userId!);
  if (err) return res.status(400).json({ error: err });
  return res.json({ ok: true, status: "running" });
});

// POST /api/bulk/stop — corta el envío en curso (lo ya enviado no se deshace).
bulkRouter.post("/stop", async (req, res) => {
  await stopCampaign(req.userId!);
  return res.json({ ok: true, status: "paused" });
});

// GET /api/bulk/board — tablero tipo "clientes potenciales" de Meta: los leads del formulario
// agrupados por etapa. Registrado=NUEVO · Contactado=CONTACTADO · Cumple requisitos=INTERESADO ·
// Convertido=COMPRO. Reusa los stages que ya maneja el CRM (no inventa estados nuevos).
bulkRouter.get("/board", async (req, res) => {
  const userId = req.userId!;
  const contacts = await prisma.contact.findMany({
    where: { userId, source: "leadform" },
    orderBy: { createdAt: "desc" },
    take: 400,
    select: { id: true, name: true, phone: true, stage: true, createdAt: true },
  });
  const forms = await prisma.leadForm.findMany({
    where: { userId, contactId: { in: contacts.map((c) => c.id) } },
    select: { contactId: true, answers: true },
  });
  const byContact = new Map(forms.map((f) => [f.contactId, f.answers]));
  return res.json({
    leads: contacts.map((c) => ({
      id: c.id, name: c.name, phone: c.phone, stage: c.stage, createdAt: c.createdAt,
      answers: byContact.get(c.id) ?? [],
    })),
  });
});
