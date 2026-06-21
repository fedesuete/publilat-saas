// Configuración de la integración con CRM externo (Fase 5). Protegido por requireAuth.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { sendTestIntegration } from "../lib/integrations.js";

export const integrationsRouter = Router();

async function ensureIntegration(userId: string) {
  return (
    (await prisma.integration.findUnique({ where: { userId } })) ??
    (await prisma.integration.create({ data: { userId } }))
  );
}

// GET /api/integrations — configuración actual.
integrationsRouter.get("/", async (req, res) => {
  const i = await ensureIntegration(req.userId!);
  return res.json({
    integration: {
      mode: i.mode,
      webhookUrl: i.webhookUrl,
      secret: i.secret,
      onLead: i.onLead,
      onPurchase: i.onPurchase,
      enabled: i.enabled,
    },
  });
});

const putSchema = z.object({
  mode: z.enum(["nativo", "webhook", "kommo"]).optional(),
  webhookUrl: z.string().url().nullable().optional(),
  secret: z.string().max(200).nullable().optional(),
  onLead: z.boolean().optional(),
  onPurchase: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

// PUT /api/integrations — actualiza la configuración.
integrationsRouter.put("/", async (req, res) => {
  const parsed = putSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Input inválido", details: parsed.error.flatten() });
  }
  await ensureIntegration(req.userId!);
  const i = await prisma.integration.update({
    where: { userId: req.userId! },
    data: parsed.data,
  });
  return res.json({
    integration: {
      mode: i.mode, webhookUrl: i.webhookUrl, secret: i.secret,
      onLead: i.onLead, onPurchase: i.onPurchase, enabled: i.enabled,
    },
  });
});

// POST /api/integrations/test — dispara un webhook de prueba.
integrationsRouter.post("/test", async (req, res) => {
  try {
    const status = await sendTestIntegration(req.userId!);
    return res.json({ ok: status >= 200 && status < 300, status });
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Falló el test" });
  }
});
