// Redirector de atribución — EL CORAZÓN DEL MVP (Fase 1).
// Flujo: resuelve usuario -> persiste Contact con atribución -> dispara Lead (CAPI)
//        -> loguea MetaEvent -> redirige a wa.me con el código.
import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { sendCapiEvent } from "../lib/meta-capi.js";
import { resolveUserPixel } from "../lib/pixel.js";
import { prisma } from "../lib/prisma.js";
import { fireIntegration } from "../lib/integrations.js";

export const goRouter = Router();

// Código corto para incrustar en el mensaje de WhatsApp (re-identifica al contacto).
const shortCode = () => crypto.randomBytes(4).toString("hex").toUpperCase();

// Construye la cookie _fbc a partir del fbclid si no vino ya como cookie.
function buildFbc(fbclid?: string, existing?: string) {
  if (existing) return existing;
  if (!fbclid) return undefined;
  return `fb.1.${Date.now()}.${fbclid}`;
}

// Elige la línea de WhatsApp a usar, repartiendo los clics entre las líneas elegibles
// (rotación LRU: la menos usada primero). Elegible = conectada, status active y con
// tiempo (expiresAt nulo o futuro). Fallback a cualquiera con número y luego a DEMO.
async function pickLine(userId: string) {
  const now = new Date();
  const eligible = await prisma.waLine.findFirst({
    where: {
      userId,
      connected: true,
      status: "active",
      NOT: { phone: "" },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { lastUsedAt: { sort: "asc", nulls: "first" } }, // la menos reciente primero
  });

  if (eligible?.phone) {
    // Marcamos uso para que el próximo clic vaya a otra línea (round-robin natural).
    await prisma.waLine.update({ where: { id: eligible.id }, data: { lastUsedAt: now } });
    return { phone: eligible.phone, lineId: eligible.id as string | undefined };
  }

  // Sin líneas elegibles: cualquiera con número (para no perder el lead) o DEMO.
  const anyLine = await prisma.waLine.findFirst({
    where: { userId, NOT: { phone: "" } },
    orderBy: { createdAt: "asc" },
  });
  if (anyLine?.phone) return { phone: anyLine.phone, lineId: anyLine.id as string | undefined };
  return { phone: process.env.DEMO_LINE_PHONE ?? "5492944684573", lineId: anyLine?.id };
}

// Envía el Lead por CAPI y registra el MetaEvent. No bloquea la redirección.
async function fireLead(params: {
  userId: string;
  contactId: string;
  externalId: string;
  eventId: string;
  fbp?: string;
  fbc?: string;
  clientIp?: string;
  userAgent?: string;
  eventSourceUrl?: string;
}) {
  const creds = await resolveUserPixel(params.userId, "Lead");
  const metaEvent = await prisma.metaEvent.create({
    data: {
      userId: params.userId,
      contactId: params.contactId,
      eventName: "Lead",
      pixelId: creds?.pixelId ?? process.env.META_PIXEL_ID ?? "",
      payload: {},
      status: "pending",
    },
  });

  try {
    const result = await sendCapiEvent({
      eventName: "Lead",
      externalId: params.externalId,
      fbp: params.fbp,
      fbc: params.fbc,
      clientIp: params.clientIp,
      userAgent: params.userAgent,
      eventId: params.eventId, // mismo eventID que el Pixel del navegador -> dedup
      eventSourceUrl: params.eventSourceUrl,
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
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[CAPI Lead] error:", message);
    await prisma.metaEvent.update({
      where: { id: metaEvent.id },
      data: { status: "failed", response: { error: message } },
    });
  }
}

goRouter.get("/go", async (req: Request, res: Response) => {
  try {
    const u = String(req.query.u ?? "");
    const pixelHint = req.query.pixel ? String(req.query.pixel) : undefined;
    const msg = String(req.query.msg ?? "Hola");
    const fbclid = req.query.fbclid ? String(req.query.fbclid) : undefined;
    const campaignId = req.query.campaign ? String(req.query.campaign) : undefined;
    const adId = req.query.ad ? String(req.query.ad) : undefined;
    const source = req.query.src ? String(req.query.src) : undefined;
    // Compartidos por la landing (pixel del navegador) para deduplicar:
    const eid = req.query.eid ? String(req.query.eid) : undefined;
    const fbpQuery = req.query.fbp ? String(req.query.fbp) : undefined;
    const fbcQuery = req.query.fbc ? String(req.query.fbc) : undefined;

    if (!u) return res.status(400).send("Falta el parámetro u");

    const user = await prisma.user.findUnique({ where: { slug: u } });
    if (!user) return res.status(404).send("Usuario no encontrado");

    // Preferimos lo que mande la landing (cross-domain); si no, las cookies del backend.
    const fbp = fbpQuery ?? (req.cookies?._fbp as string | undefined);
    const fbc = fbcQuery ?? buildFbc(fbclid, req.cookies?._fbc as string | undefined);

    const externalId = crypto.randomUUID();
    const code = shortCode();
    // eventId compartido con el Lead del navegador (si vino eid); si no, uno propio.
    const eventId = eid ?? externalId;

    const { phone: linePhone, lineId } = await pickLine(user.id);

    // Persistir el contacto con TODA la atribución (clave para que el Purchase matchee).
    const contact = await prisma.contact.create({
      data: {
        userId: user.id,
        externalId,
        fbp,
        fbc,
        fbclid,
        campaignId,
        adId,
        source,
        pixelId: pixelHint,
        code,
        landingUrl: req.get("referer") ?? undefined,
        lineId,
        stage: "NUEVO",
      },
    });

    // Webhook saliente al CRM externo (si está configurado). Best-effort.
    void fireIntegration(user.id, "lead", {
      contactId: contact.id,
      externalId,
      code,
      campaignId,
      adId,
      source,
      fbclid,
      createdAt: contact.createdAt,
    });

    // Dispara Lead + loguea MetaEvent en background; no demora la redirección.
    void fireLead({
      userId: user.id,
      contactId: contact.id,
      externalId,
      eventId,
      fbp,
      fbc,
      clientIp: req.ip,
      userAgent: req.get("user-agent") ?? undefined,
      eventSourceUrl: req.get("referer") ?? undefined,
    });

    // Mensaje con el código incrustado para re-identificar al contacto.
    const text = encodeURIComponent(`${msg} (ref: ${code})`);
    const waUrl = `https://wa.me/${linePhone}?text=${text}`;

    return res.redirect(302, waUrl);
  } catch (err) {
    console.error("[/go] error:", err);
    return res.status(500).send("Error en el redirector");
  }
});
