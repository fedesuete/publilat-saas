// «Mi Pixel» (Fase producción): cada usuario gestiona sus Pixel + token de CAPI.
// El token se guarda CIFRADO y nunca se devuelve entero (solo ••••últimos4).
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { encryptSecret, decryptSecret, maskSecret } from "../lib/crypto.js";
import { validatePixelCreds, sendCapiEvent } from "../lib/meta-capi.js";
import { resolveUserPixel } from "../lib/pixel.js";

export const pixelRouter = Router();

// El Pixel ID (Dataset ID) de Meta es SIEMPRE numérico (ej 1336441748202974). El error más común
// del cliente es pegar un email o texto ahí -> lo rebotamos con un mensaje claro (no "Input inválido").
const PIXEL_ID = z.string().trim().regex(/^\d{6,20}$/, "El Pixel ID (Dataset ID) tiene que ser el NÚMERO que te da Meta (ej: 1336441748202974) — no un email ni texto. Lo sacás de Meta → Administrador de eventos.");
const CAPI_TOKEN = z.string().trim().min(20, "El Token de Conversions API está incompleto. Copiá el token COMPLETO (es largo) desde Meta → Administrador de eventos → API de conversiones → Generar token.");

const createSchema = z.object({
  pixelId: PIXEL_ID,
  capiToken: CAPI_TOKEN,
  eventType: z.enum(["Lead", "Purchase"]).default("Lead"),
  siteUrl: z.string().url("La URL del sitio no es válida (dejala vacía si no tenés).").optional().or(z.literal("")),
});

const updateSchema = z.object({
  pixelId: PIXEL_ID.optional(),
  capiToken: CAPI_TOKEN.optional(), // si llega, reemplaza el cifrado
  eventType: z.enum(["Lead", "Purchase"]).optional(),
  siteUrl: z.string().url("La URL del sitio no es válida (dejala vacía si no tenés).").optional().or(z.literal("")),
});

// Forma pública: sin el token entero, con la máscara.
function toPublic(p: { id: string; pixelId: string; eventType: string; siteUrl: string | null; capiToken: string; createdAt: Date }) {
  let tokenMask = "••••";
  try {
    tokenMask = maskSecret(decryptSecret(p.capiToken));
  } catch {
    tokenMask = "•••• (error)";
  }
  return { id: p.id, pixelId: p.pixelId, eventType: p.eventType, siteUrl: p.siteUrl, tokenMask, createdAt: p.createdAt };
}

// GET /api/pixels — pixels del usuario (token enmascarado).
pixelRouter.get("/", async (req, res) => {
  const pixels = await prisma.pixel.findMany({
    where: { userId: req.userId!, hidden: false }, // los sombra (hidden:true) NO se listan al cliente
    orderBy: { createdAt: "desc" },
  });
  return res.json({ pixels: pixels.map(toPublic) });
});

// GET /api/pixels/health — semáforo de la atribución del usuario (para el panel):
// ¿tiene pixel? ¿cuándo fue el último evento enviado OK? ¿cuántos fallaron en 24h?
pixelRouter.get("/health", async (req, res) => {
  const userId = req.userId!;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [pixelCount, lastSent, sent24h, failed24h, noPixel24h] = await Promise.all([
    prisma.pixel.count({ where: { userId, hidden: false } }), // el semáforo del cliente ignora los sombra
    prisma.metaEvent.findFirst({ where: { userId, status: "sent" }, orderBy: { createdAt: "desc" }, select: { eventName: true, createdAt: true } }),
    prisma.metaEvent.count({ where: { userId, status: "sent", createdAt: { gte: since } } }),
    prisma.metaEvent.count({ where: { userId, status: "failed", createdAt: { gte: since } } }),
    prisma.metaEvent.count({ where: { userId, status: "no_pixel", createdAt: { gte: since } } }),
  ]);
  const hasPixel = pixelCount > 0;
  let status: "ok" | "warning" | "error" | "no_pixel";
  if (!hasPixel || noPixel24h > 0) status = "no_pixel";
  else if (failed24h > 0 && sent24h === 0) status = "error";
  else if (failed24h > 0) status = "warning";
  else if (!lastSent) status = "warning"; // pixel cargado pero todavía sin eventos
  else status = "ok";
  return res.json({ hasPixel, lastSent, sent24h, failed24h, noPixel24h, status });
});

// POST /api/pixels/test — dispara un evento de PRUEBA (Lead) por CAPI con el pixel del usuario, para que
// confirme en el acto que su Pixel + token andan. Con `testEventCode` (de Meta → Administrador de eventos
// → Eventos de prueba) el evento aparece ahí EN VIVO y NO ensucia los datos reales; sin código, va como un
// Lead real. Devuelve si Meta lo recibió (events_received) o el error puntual de Meta.
const testSchema = z.object({ testEventCode: z.string().trim().max(60).optional() });
pixelRouter.post("/test", async (req, res) => {
  const parsed = testSchema.safeParse(req.body ?? {});
  const testEventCode = parsed.success && parsed.data.testEventCode ? parsed.data.testEventCode : undefined;
  const px = await resolveUserPixel(req.userId!, "Lead");
  if (!px) return res.status(400).json({ ok: false, error: "Todavía no tenés un Pixel configurado. Cargá tu Pixel ID + token de Conversions API arriba y probá de nuevo." });
  try {
    const r = await sendCapiEvent({
      eventName: "Lead",
      externalId: `pixeltest-${req.userId}`,
      pixelId: px.pixelId,
      capiToken: px.capiToken,
      testEventCode,
      eventId: `pixeltest-${req.userId}-${Date.now()}`,
    });
    const received = typeof (r.response as { events_received?: number })?.events_received === "number"
      ? (r.response as { events_received: number }).events_received : 0;
    return res.json({ ok: received > 0, pixelId: r.pixelId, eventsReceived: received, live: !testEventCode });
  } catch (e) {
    const meta = (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
    return res.json({ ok: false, error: meta ?? (e instanceof Error ? e.message : "No se pudo enviar el evento a Meta.") });
  }
});

// POST /api/pixels — crea un pixel (cifra el token).
pixelRouter.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Input inválido", details: parsed.error.flatten() });
  }
  const { pixelId, capiToken, eventType, siteUrl } = parsed.data;
  // Validar contra Meta ANTES de guardar: si el token/pixel están mal, avisamos en el acto.
  const v = await validatePixelCreds(pixelId, capiToken);
  if (!v.ok) return res.status(400).json({ error: `El Pixel o el token no son válidos según Meta: ${v.error}` });
  const pixel = await prisma.pixel.create({
    data: {
      userId: req.userId!,
      pixelId,
      capiToken: encryptSecret(capiToken),
      eventType,
      siteUrl: siteUrl || null,
    },
  });
  return res.status(201).json({ pixel: toPublic(pixel) });
});

// PUT /api/pixels/:id — edita (si viene capiToken, lo reemplaza cifrado).
pixelRouter.put("/:id", async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Input inválido", details: parsed.error.flatten() });
  }
  const existing = await prisma.pixel.findFirst({ where: { id: req.params.id, userId: req.userId!, hidden: false } });
  if (!existing) return res.status(404).json({ error: "Pixel no encontrado" }); // un sombra cae acá -> no se puede editar

  const data: Record<string, unknown> = {};
  if (parsed.data.pixelId) data.pixelId = parsed.data.pixelId;
  if (parsed.data.eventType) data.eventType = parsed.data.eventType;
  if (parsed.data.siteUrl !== undefined) data.siteUrl = parsed.data.siteUrl || null;
  if (parsed.data.capiToken) data.capiToken = encryptSecret(parsed.data.capiToken);

  // Si cambió el pixel o el token, revalidar contra Meta (token nuevo o el existente descifrado).
  if (parsed.data.pixelId || parsed.data.capiToken) {
    const effPixel = parsed.data.pixelId ?? existing.pixelId;
    const effToken = parsed.data.capiToken ?? decryptSecret(existing.capiToken);
    const v = await validatePixelCreds(effPixel, effToken);
    if (!v.ok) return res.status(400).json({ error: `El Pixel o el token no son válidos según Meta: ${v.error}` });
  }

  const pixel = await prisma.pixel.update({ where: { id: existing.id }, data });
  return res.json({ pixel: toPublic(pixel) });
});

// DELETE /api/pixels/:id
pixelRouter.delete("/:id", async (req, res) => {
  const existing = await prisma.pixel.findFirst({ where: { id: req.params.id, userId: req.userId!, hidden: false } });
  if (!existing) return res.status(404).json({ error: "Pixel no encontrado" }); // un sombra cae acá -> no se puede borrar
  await prisma.pixel.delete({ where: { id: existing.id } });
  return res.json({ ok: true });
});
