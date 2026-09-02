// Alta self-service desde una landing EXTERNA (CloudFront). CORS abierto (cualquier origen), porque la
// landing vive en un dominio descartable distinto del panel. Crea la cuenta de Publi.lat, avisa al dueño
// (WhatsApp + email) y devuelve una URL de auto-login para dejar al cliente logueado en el panel y que
// compre sus días. No usa cookie cross-site (frágil): el token va en la URL de /api/auth/autologin, que
// SÍ setea la cookie same-site en app.publi.lat.
import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { hashPassword, signToken } from "../lib/auth.js";
import { uniqueSlug } from "./auth.js";
import { resolveReferrerByCode } from "../lib/referrals.js";
import { notifyNewSignup } from "../lib/signup-notify.js";
import { fireMarketingEvent } from "../lib/marketing-capi.js";
import { sendCapiEvent } from "../lib/meta-capi.js";
import { resolveUserPixel } from "../lib/pixel.js";
import crypto from "node:crypto";

export const landRouter = Router();

const signupSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(6).max(200),
  phone: z.string().trim().min(5).max(40),
  ref: z.string().optional(),
  interests: z.array(z.string().max(60)).max(8).optional(), // qué le interesó en la landing (para el aviso)
  fbp: z.string().max(255).optional(),     // identificadores del clic de Meta (para el loop del pixel)
  fbc: z.string().max(600).optional(),
  fbclid: z.string().max(600).optional(),
  eventId: z.string().max(120).optional(), // dedup con el CompleteRegistration del navegador
});

// POST /api/land/signup — crea la cuenta y devuelve { ok, autologinUrl }.
landRouter.post("/signup", async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Completá nombre, email, teléfono y una clave (mínimo 6 caracteres)." });
  const { name, email, password, phone, ref, interests, fbp, fbc, fbclid, eventId } = parsed.data;
  try {
    const slug = await uniqueSlug(name || email.split("@")[0]);
    const referredById = ref ? await resolveReferrerByCode(ref) : null;
    const user = await prisma.user.create({
      data: {
        email,
        slug,
        name,
        phone,
        password: await hashPassword(password),
        source: referredById ? "referido" : "landing",
        fbp: fbp ?? null,
        fbc: fbc ?? null,
        fbclid: fbclid ?? null,
        ...(referredById ? { referredById } : {}),
      },
      select: { id: true, email: true, tokenVersion: true },
    });

    // Pixel Clientes-publilat: se registró un cliente (dedup con el CompleteRegistration del navegador).
    void fireMarketingEvent({
      eventName: "CompleteRegistration",
      externalId: user.id, fbp, fbc, phone, firstName: name, eventId,
      clientIp: req.ip, userAgent: req.get("user-agent") ?? undefined,
    });

    void notifyNewSignup({ name, email, phone, interests }); // aviso al dueño con lo que le interesó (best-effort)

    const token = signToken({ userId: user.id, tv: user.tokenVersion });
    const base = (process.env.APP_BASE_URL ?? "https://app.publi.lat").replace(/\/$/, "");
    return res.status(201).json({ ok: true, email: user.email, autologinUrl: `${base}/api/auth/autologin?t=${encodeURIComponent(token)}` });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return res.status(409).json({ error: "Ese email ya tiene una cuenta. Iniciá sesión en el panel." });
    }
    console.error("[land/signup] error:", e instanceof Error ? e.message : String(e));
    return res.status(500).json({ error: "No pudimos crear la cuenta. Probá de nuevo en un momento." });
  }
});

const trackSchema = z.object({
  accountSlug: z.string().min(1).max(60),
  ref: z.string().regex(/^[A-Za-z0-9]{3,20}$/).optional(), // lo genera la landing (gesto móvil: WhatsApp abre YA con este ref)
  fbclid: z.string().max(600).optional(),
  fbp: z.string().max(255).optional(),
  fbc: z.string().max(600).optional(),
  eventId: z.string().max(120).optional(), // dedup con el Lead del pixel del navegador
  // Datos del FORMULARIO de la landing (opcionales): el lead queda con nombre/teléfono en el CRM
  // aunque nunca llegue a mandar el mensaje de WhatsApp.
  nombre: z.string().trim().max(80).optional(),
  telefono: z.string().trim().max(40).optional(),
});

const shortRef = () => crypto.randomBytes(4).toString("hex").toUpperCase().slice(0, 7);

// POST /api/land/track — registra el clic de una landing EXTERNA de un cliente que responde por SU PROPIO
// WhatsApp (conectado a Kommo, NO una línea de Publi.lat). Crea un Contact con los IDs del clic + un `ref:`
// corto y dispara el Lead por CAPI. Devuelve el `ref` para que la landing lo meta en el mensaje de WhatsApp
// → Kommo lee el `ref:` → linkea el lead → el Purchase (etapa ganada) matchea el anuncio. Es el /go para
// clientes SIN línea propia. CORS abierto (la landing vive en el CloudFront descartable del cliente).
landRouter.post("/track", async (req, res) => {
  const parsed = trackSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido" });
  const { accountSlug, fbclid, fbp, fbc, eventId } = parsed.data;
  const acc = await prisma.user.findUnique({ where: { slug: accountSlug }, select: { id: true } });
  if (!acc) return res.status(404).json({ error: "Cuenta no encontrada" });
  const ref = (parsed.data.ref ?? shortRef()).toUpperCase();
  // Teléfono del formulario: solo dígitos y con un largo creíble; si no, se descarta (el match
  // fuerte del inbound es por el `ref:` — el teléfono es un extra para el CRM/contacto manual).
  // Y si YA existe un contacto con ese teléfono en la cuenta, NO lo guardamos acá: dos contactos
  // con el mismo phone hacen que el inbound matchee al más nuevo (vacío) y la charla se parta.
  const formPhone = (parsed.data.telefono ?? "").replace(/\D/g, "");
  let phoneOk = formPhone.length >= 8 && formPhone.length <= 15 ? formPhone : null;
  if (phoneOk) {
    const dupPhone = await prisma.contact.findFirst({ where: { userId: acc.id, phone: phoneOk }, select: { id: true } });
    if (dupPhone) phoneOk = null;
  }
  const formName = parsed.data.nombre?.slice(0, 80) || null;
  try {
    const externalId = crypto.randomUUID();
    const eid = eventId || externalId;
    // Contact con `ref:` (el que ya abrió en el WhatsApp). source="an" = anuncio.
    let contact: { id: string; createdAt: Date };
    try {
      contact = await prisma.contact.create({
        data: { userId: acc.id, externalId, code: ref, fbclid: fbclid ?? null, fbp: fbp ?? null, fbc: fbc ?? null, source: "an", stage: "NUEVO", clientIp: req.ip ?? null, clientUserAgent: req.get("user-agent") ?? null, ...(formName ? { name: formName } : {}), ...(phoneOk ? { phone: phoneOk } : {}) },
        select: { id: true, createdAt: true },
      });
    } catch (e) {
      // ref ya usado (rarísimo con random): devolvemos ok — el ref ya vive en el sistema.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return res.json({ ref, eventId: eid });
      throw e;
    }
    // Lead por CAPI (best-effort, mismo eventId que el pixel del navegador → dedup). fbc derivado del fbclid
    // si no vino la cookie _fbc (formato de Meta). Sin pixel del cliente, es no-op silencioso.
    const fbcEff = fbc || (fbclid ? `fb.1.${contact.createdAt.getTime()}.${fbclid}` : undefined);
    const creds = await resolveUserPixel(acc.id, "Lead");
    if (creds) {
      void sendCapiEvent({
        eventName: "Lead", externalId, fbp, fbc: fbcEff, eventId: eid,
        clientIp: req.ip, userAgent: req.get("user-agent") ?? undefined,
        pixelId: creds.pixelId, capiToken: creds.capiToken,
      }).catch(() => undefined);
    }
    return res.json({ ref, eventId: eid, pixel: creds?.pixelId ?? null });
  } catch (e) {
    console.error("[land/track] error:", e instanceof Error ? e.message : String(e));
    return res.status(500).json({ error: "Error interno" });
  }
});
