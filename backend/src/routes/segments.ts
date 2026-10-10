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
import { CATEGORIAS, contentCategory } from "../lib/landing-custom-data.js";

export const segmentsRouter = Router();

// GET /api/segments — los tipos disponibles = pixeles con nombre de la cuenta.
segmentsRouter.get("/", async (req, res) => {
  const pixels = await prisma.pixel.findMany({
    where: { userId: req.userId!, hidden: false, mirror: false, label: { not: null } },
    orderBy: { createdAt: "asc" },
    select: { id: true, label: true, pixelId: true },
  });
  return res.json({ segments: pixels.map((p) => ({ id: p.id, label: p.label, pixelId: p.pixelId })), categorias: CATEGORIAS });
});

// GET /api/segments/contact/:contactId — el tipo marcado de un contacto (o null).
segmentsRouter.get("/contact/:contactId", async (req, res) => {
  const c = await prisma.contact.findFirst({ where: { id: req.params.contactId, userId: req.userId! }, select: { id: true } });
  if (!c) return res.status(404).json({ error: "Contacto no encontrado" });
  const seg = await prisma.contactSegment.findUnique({ where: { contactId: c.id }, select: { pixelRowId: true, categoria: true } });
  const demo = await prisma.metaEvent.findFirst({ where: { contactId: c.id, eventName: "Schedule", status: "sent" }, select: { id: true } });
  return res.json({ pixelRowId: seg?.pixelRowId ?? null, categoria: seg?.categoria ?? null, demo: !!demo });
});

// `categoria`: el producto que le interesa (Plataforma / A medida / Fichas / CRM) → content_category de sus eventos.
const setSchema = z.object({
  pixelRowId: z.string().min(1).max(40).nullable(),
  categoria: z.enum(CATEGORIAS).nullable().optional(),
});

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

  const previo = await prisma.contactSegment.findUnique({ where: { contactId: contact.id }, select: { pixelRowId: true, categoria: true } });
  // Sin `categoria` en el pedido se conserva la que tenía (ej. la que eligió en la landing).
  const categoria = parsed.data.categoria === undefined ? previo?.categoria ?? null : parsed.data.categoria;
  await prisma.contactSegment.upsert({
    where: { contactId: contact.id },
    create: { userId: req.userId!, contactId: contact.id, pixelRowId: px.id, categoria },
    update: { pixelRowId: px.id, categoria },
  });

  // Mismo tipo y mismo producto que ya tenía: no se re-dispara nada.
  const eventos: string[] = [];
  if (previo?.pixelRowId !== px.id || (previo?.categoria ?? null) !== categoria) {
    // event_id con el pixel y el producto adentro: si lo desmarcan y lo vuelven a marcar igual, Meta deduplica;
    // si le cambian el producto, sale un Lead nuevo con ese content_category.
    const cc = contentCategory(categoria);
    const lead = await fireMetaEvent(contact, "Lead", {
      eventId: `${contact.externalId}:lead:${px.pixelId}${cc ? ":" + cc : ""}`,
      calificadoManual: true,
      ...(cc ? { customData: { content_category: cc, origen: "inbox" } } : {}),
    });
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
  return res.json({ pixelRowId: px.id, label: px.label, categoria, eventos });
});

// POST /api/segments/contact/:contactId/schedule — "Demo agendada": evento Schedule a su pixel (el del tipo
// marcado o el principal), con su content_category. Una vez por contacto.
segmentsRouter.post("/contact/:contactId/schedule", async (req, res) => {
  const contact = await prisma.contact.findFirst({ where: { id: req.params.contactId, userId: req.userId! } });
  if (!contact) return res.status(404).json({ error: "Contacto no encontrado" });
  const r = await fireMetaEvent(contact, "Schedule", { eventId: `${contact.externalId}:schedule`, oncePerContact: true });
  if (!r.ok) return res.status(502).json({ error: r.error === "SIN_PIXEL" ? "La cuenta no tiene pixel cargado" : "Meta no aceptó el evento" });
  return res.json({ ok: true, yaEstaba: !!r.skipped });
});
