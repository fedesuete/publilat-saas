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

export const landRouter = Router();

const signupSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(6).max(200),
  phone: z.string().trim().min(5).max(40),
  ref: z.string().optional(),
});

// POST /api/land/signup — crea la cuenta y devuelve { ok, autologinUrl }.
landRouter.post("/signup", async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Completá nombre, email, teléfono y una clave (mínimo 6 caracteres)." });
  const { name, email, password, phone, ref } = parsed.data;
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
        ...(referredById ? { referredById } : {}),
      },
      select: { id: true, email: true, tokenVersion: true },
    });

    void notifyNewSignup({ name, email, phone }); // aviso al dueño (best-effort)

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
