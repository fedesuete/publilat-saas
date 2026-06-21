// Leads: listado con atribución y marcado de compra (dispara Purchase por CAPI).
// Protegido por requireAuth -> opera sólo sobre los contactos del usuario logueado.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { sendCapiEvent } from "../lib/meta-capi.js";
import { resolveUserPixel } from "../lib/pixel.js";
import { fireIntegration } from "../lib/integrations.js";

export const leadsRouter = Router();

// GET /api/leads — lista los contactos del usuario con su atribución.
leadsRouter.get("/", async (req, res) => {
  const userId = req.userId!;
  const leads = await prisma.contact.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      externalId: true,
      name: true,
      stage: true,
      source: true,
      campaignId: true,
      adId: true,
      pixelId: true,
      fbclid: true,
      code: true,
      landingUrl: true,
      amount: true,
      purchasedAt: true,
      createdAt: true,
      // phone se omite a propósito (PII): no se expone en el listado.
    },
  });
  return res.json({ leads });
});

// amount: monto en unidad mayor (ej 1500.50 ARS). Se guarda en centavos (Int) y se
// envía a Meta como valor decimal (value = amount).
// PATCH /api/leads/:id — mover etapa (kanban) o editar nombre.
// No toca COMPRO acá: la compra se marca por /purchase (dispara el Purchase a Meta).
const patchSchema = z.object({
  stage: z.enum(["NUEVO", "CONTACTADO", "INTERESADO", "PERDIDO"]).optional(),
  name: z.string().min(1).max(120).optional(),
});

leadsRouter.patch("/:id", async (req, res) => {
  const userId = req.userId!;
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Input inválido", details: parsed.error.flatten() });
  }
  const contact = await prisma.contact.findFirst({ where: { id: req.params.id, userId } });
  if (!contact) return res.status(404).json({ error: "Lead no encontrado" });

  const updated = await prisma.contact.update({
    where: { id: contact.id },
    data: { ...parsed.data },
    select: { id: true, stage: true, name: true },
  });
  return res.json({ lead: updated });
});

const purchaseSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().length(3).toUpperCase().default("ARS"),
});

// POST /api/leads/:id/purchase — marca COMPRO y envía Purchase con el MISMO identificador.
leadsRouter.post("/:id/purchase", async (req, res) => {
  const userId = req.userId!;
  const parsed = purchaseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Input inválido", details: parsed.error.flatten() });
  }
  const { amount, currency } = parsed.data;

  const contact = await prisma.contact.findFirst({ where: { id: req.params.id, userId } });
  if (!contact) return res.status(404).json({ error: "Lead no encontrado" });

  // Marca la venta (amount en centavos). El Purchase usa el valor en unidad mayor.
  const updated = await prisma.contact.update({
    where: { id: contact.id },
    data: { stage: "COMPRO", amount: Math.round(amount * 100), purchasedAt: new Date() },
  });

  // Webhook saliente al CRM externo (si está configurado). Best-effort.
  void fireIntegration(userId, "purchase", {
    contactId: contact.id,
    externalId: contact.externalId,
    amount,
    currency,
    code: contact.code,
    campaignId: contact.campaignId,
    source: contact.source,
  });

  // Registra el MetaEvent y envía el Purchase con el MISMO externalId/fbp/fbc + value.
  const creds = await resolveUserPixel(userId, "Purchase");
  const metaEvent = await prisma.metaEvent.create({
    data: {
      userId,
      contactId: contact.id,
      eventName: "Purchase",
      pixelId: creds?.pixelId ?? process.env.META_PIXEL_ID ?? "",
      payload: {},
      status: "pending",
    },
  });

  try {
    const result = await sendCapiEvent({
      eventName: "Purchase",
      externalId: contact.externalId, // <- mismo id que el Lead: habilita el match
      fbp: contact.fbp ?? undefined,
      fbc: contact.fbc ?? undefined,
      phone: contact.phone ?? undefined,
      value: amount,
      currency,
      eventId: `${contact.externalId}:purchase`,
      eventSourceUrl: contact.landingUrl ?? undefined,
      pixelId: creds?.pixelId,
      capiToken: creds?.capiToken,
    });
    await prisma.metaEvent.update({
      where: { id: metaEvent.id },
      data: {
        status: "sent",
        pixelId: result.pixelId,
        payload: result.payload as object,
        response: result.response as object,
      },
    });
    return res.json({
      ok: true,
      lead: { id: updated.id, stage: updated.stage, amount: updated.amount, purchasedAt: updated.purchasedAt },
      capi: result.response,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[CAPI Purchase] error:", message);
    await prisma.metaEvent.update({
      where: { id: metaEvent.id },
      data: { status: "failed", response: { error: message } },
    });
    // La venta queda marcada igual; el Purchase se puede reintentar (Fase 4: BullMQ).
    return res.status(502).json({ ok: false, error: "Falló el envío del Purchase a Meta", detail: message });
  }
});
