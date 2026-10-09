// Tipo de cliente marcado a mano en el Inbox → a qué pixel van SUS eventos (2026-10-09).
//
// Pedido del dueño: en una misma cuenta llegan clientes que quieren comprar fichas, otros que quieren
// su propia plataforma y otros que solo quieren el CRM. Con un solo pixel, Meta aprende un "comprador"
// que es una mezcla de los tres. Ahora el operador marca arriba del chat qué es cada cliente y:
//   - al marcarlo, el pixel de ese tipo recibe el Lead del cliente (aprende SUS interesados);
//   - al marcarlo "Compró", el Purchase va a ese pixel (resolveContactPixel, lib/pixel.ts);
//   - si ya había comprado antes de marcarlo, el Purchase también se le manda a ese pixel.
// Sin marca, todo va al pixel principal como siempre.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { fireMetaEvent } from "../lib/meta-events.js";

export const segmentsRouter = Router();

// GET /api/segments — los tipos disponibles = pixeles con nombre de la cuenta.
segmentsRouter.get("/", async (req, res) => {
  const pixels = await prisma.pixel.findMany({
    where: { userId: req.userId!, hidden: false, mirror: false, label: { not: null } },
    orderBy: { createdAt: "asc" },
    select: { id: true, label: true, pixelId: true },
  });
  return res.json({ segments: pixels.map((p) => ({ id: p.id, label: p.label, pixelId: p.pixelId })) });
});

// GET /api/segments/contact/:contactId — el tipo marcado de un contacto (o null).
segmentsRouter.get("/contact/:contactId", async (req, res) => {
  const c = await prisma.contact.findFirst({ where: { id: req.params.contactId, userId: req.userId! }, select: { id: true } });
  if (!c) return res.status(404).json({ error: "Contacto no encontrado" });
  const seg = await prisma.contactSegment.findUnique({ where: { contactId: c.id }, select: { pixelRowId: true } });
  return res.json({ pixelRowId: seg?.pixelRowId ?? null });
});

const setSchema = z.object({ pixelRowId: z.string().min(1).max(40).nullable() });

// PUT /api/segments/contact/:contactId — marca (o desmarca con null) el tipo de cliente.
segmentsRouter.put("/contact/:contactId", async (req, res) => {
  const parsed = setSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido" });
  const contact = await prisma.contact.findFirst({ where: { id: req.params.contactId, userId: req.userId! } });
  if (!contact) return res.status(404).json({ error: "Contacto no encontrado" });

  if (parsed.data.pixelRowId === null) {
    await prisma.contactSegment.deleteMany({ where: { contactId: contact.id } });
    return res.json({ pixelRowId: null });
  }

  // Solo un pixel de segmento de ESTA cuenta (con nombre, ni sombra ni espejo).
  const px = await prisma.pixel.findFirst({
    where: { id: parsed.data.pixelRowId, userId: req.userId!, hidden: false, mirror: false, label: { not: null } },
    select: { id: true, pixelId: true, label: true },
  });
  if (!px) return res.status(400).json({ error: "Ese tipo de cliente no existe. Cargalo en Mi Pixel con un nombre." });

  const previo = await prisma.contactSegment.findUnique({ where: { contactId: contact.id }, select: { pixelRowId: true } });
  await prisma.contactSegment.upsert({
    where: { contactId: contact.id },
    create: { userId: req.userId!, contactId: contact.id, pixelRowId: px.id },
    update: { pixelRowId: px.id },
  });

  // Mismo tipo que ya tenía: no se re-dispara nada.
  const eventos: string[] = [];
  if (previo?.pixelRowId !== px.id) {
    // event_id con el pixel adentro: si lo desmarcan y lo vuelven a marcar, Meta deduplica en vez de contar dos.
    const lead = await fireMetaEvent(contact, "Lead", { eventId: `${contact.externalId}:lead:${px.pixelId}` });
    if (lead.ok) eventos.push("Lead");
    // Si ya había comprado, ese pixel también tiene que aprender la compra.
    if (contact.stage === "COMPRO" && contact.amount) {
      const u = await prisma.user.findUnique({ where: { id: req.userId! }, select: { purchaseCurrency: true } });
      const pur = await fireMetaEvent(contact, "Purchase", {
        value: contact.amount / 100,
        currency: u?.purchaseCurrency || "ARS",
        eventId: `${contact.externalId}:purchase`,
        eventTime: contact.purchasedAt ?? undefined,
      });
      if (pur.ok) eventos.push("Purchase");
    }
  }
  return res.json({ pixelRowId: px.id, label: px.label, eventos });
});
