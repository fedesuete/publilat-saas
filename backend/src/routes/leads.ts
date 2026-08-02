// Leads: listado con atribución y marcado de compra (dispara Purchase por CAPI).
// Protegido por requireAuth -> opera sólo sobre los contactos del usuario logueado.
import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { markPurchase } from "../lib/purchase.js";
import { markRegistration } from "../lib/meta-events.js";

export const leadsRouter = Router();

// GET /api/leads?q=&filter=todos|conversiones|leads&real=1 — lista (sin teléfono).
// real=1 -> SÓLO clientes reales: los que escribieron al menos una vez (mensaje entrante)
// o que ya progresaron de etapa. Deja afuera los clic-que-nunca-respondieron y los bots
// viejos (creados antes del filtro de /go). Las vistas Leads y Agenda lo usan por defecto.
leadsRouter.get("/", async (req, res) => {
  const userId = req.userId!;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const filter = String(req.query.filter ?? "todos");
  const onlyReal = req.query.real === "1" || req.query.real === "true";

  const where: Prisma.ContactWhereInput = { userId };
  const and: Prisma.ContactWhereInput[] = [];
  if (filter === "conversiones") where.stage = "COMPRO";
  else if (filter === "leads") where.stage = { not: "COMPRO" };
  if (q) {
    and.push({
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
        { code: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  if (onlyReal) {
    and.push({
      OR: [
        { messages: { some: { direction: "in" } } }, // escribió al menos una vez
        { stage: { not: "NUEVO" } }, // ya lo contactaron / compró
      ],
    });
  }
  if (and.length) where.AND = and;

  const leads = await prisma.contact.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      externalId: true,
      name: true,
      phone: true, // para mostrar al contacto por teléfono cuando no tiene nombre (Kanban/Agenda)
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
      registeredAt: true, // milestone del embudo: se registró (Kanban muestra badge "Registrado")
      paymentDetected: true,
      paymentDetectedAmount: true,
      createdAt: true,
    },
  });
  return res.json({ leads });
});

// GET /api/leads/export — CSV de los leads del cliente (mismos filtros que el listado, con teléfono).
// Scopeado al userId de la sesión (requireAuth). Va ANTES de /:id para no matchear "export" como id.
leadsRouter.get("/export", async (req, res) => {
  const userId = req.userId!;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const filter = String(req.query.filter ?? "todos");
  const onlyReal = req.query.real === "1" || req.query.real === "true";

  const where: Prisma.ContactWhereInput = { userId };
  const and: Prisma.ContactWhereInput[] = [];
  if (filter === "conversiones") where.stage = "COMPRO";
  else if (filter === "leads") where.stage = { not: "COMPRO" };
  if (q) and.push({ OR: [{ name: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }, { code: { contains: q, mode: "insensitive" } }] });
  if (onlyReal) and.push({ OR: [{ messages: { some: { direction: "in" } } }, { stage: { not: "NUEVO" } }] });
  if (and.length) where.AND = and;

  const rows = await prisma.contact.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 20000, // cota de seguridad
    select: { name: true, phone: true, stage: true, source: true, campaignId: true, adId: true, code: true, amount: true, purchasedAt: true, createdAt: true },
  });

  const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`; // RFC 4180
  const fdate = (d: Date | null) => (d ? d.toISOString().slice(0, 16).replace("T", " ") : "");
  const header = ["Nombre", "Teléfono", "Etapa", "Origen", "Campaña", "Anuncio", "Código", "Monto", "Compra", "Alta"];
  const body = rows.map((l) =>
    [l.name, l.phone, l.stage, l.source, l.campaignId, l.adId, l.code,
     l.amount != null ? (l.amount / 100).toFixed(2) : "", fdate(l.purchasedAt), fdate(l.createdAt)]
      .map(cell).join(","),
  );
  const csv = "﻿" + [header.map(cell).join(","), ...body].join("\r\n"); // BOM para Excel

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`);
  return res.send(csv);
});

// GET /api/leads/:id — ficha de atribución completa (incluye teléfono y línea WA).
leadsRouter.get("/:id", async (req, res) => {
  const userId = req.userId!;
  const c = await prisma.contact.findFirst({
    where: { id: req.params.id, userId },
    include: { line: { select: { phone: true, label: true } } },
  });
  if (!c) return res.status(404).json({ error: "Lead no encontrado" });

  // Comprobantes: imágenes que mandó el cliente por WhatsApp (típicamente la transferencia).
  // Se muestran en el drawer del CRM para verificar el pago. Las más recientes primero.
  const imgs = await prisma.message.findMany({
    where: { contactId: c.id, direction: "in", mediaType: { contains: "image" }, mediaData: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 4,
    select: { id: true, mediaType: true, mediaData: true, createdAt: true },
  });
  const comprobantes = imgs.map((m) => ({
    id: m.id,
    url: `data:${m.mediaType};base64,${m.mediaData}`,
    createdAt: m.createdAt,
  }));

  return res.json({
    lead: {
      id: c.id,
      externalId: c.externalId,
      name: c.name,
      phone: c.phone,
      stage: c.stage,
      source: c.source,
      campaignId: c.campaignId,
      adId: c.adId,
      pixelId: c.pixelId,
      fbclid: c.fbclid,
      code: c.code,
      landingUrl: c.landingUrl,
      amount: c.amount,
      purchasedAt: c.purchasedAt,
      paymentDetected: c.paymentDetected,
      paymentDetectedAmount: c.paymentDetectedAmount,
      createdAt: c.createdAt,
      line: c.line ? { phone: c.line.phone, label: c.line.label } : null,
      comprobantes,
    },
  });
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

  // Marca COMPRO + dispara el Purchase (mismo externalId/fbp/fbc + value).
  const result = await markPurchase(userId, req.params.id, amount, currency);
  if (!result) return res.status(404).json({ error: "Lead no encontrado" });

  if (result.ok) {
    return res.json({ ok: true, lead: result.lead, capi: result.capi });
  }
  // La venta queda marcada igual; el Purchase se reintenta (cola CAPI).
  return res
    .status(502)
    .json({ ok: false, error: "Falló el envío del Purchase a Meta", detail: result.error, lead: result.lead });
});

// POST /api/leads/:id/register — override manual del Registro completo (CompleteRegistration).
// Respaldo por si la auto-detección de credenciales no lo agarró. Idempotente (una vez por contacto).
leadsRouter.post("/:id/register", async (req, res) => {
  const result = await markRegistration(req.userId!, req.params.id);
  if (result.error === "not_found") return res.status(404).json({ error: "Lead no encontrado" });
  if (result.ok) return res.json({ ok: true, skipped: result.skipped ?? false });
  return res.status(502).json({ ok: false, error: "No se pudo enviar el registro a Meta", detail: result.error });
});
