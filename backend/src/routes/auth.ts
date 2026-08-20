// Auth: registro y login con JWT. Validación de input con zod.
import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { hashPassword, verifyPassword, signToken, slugify, verifyToken } from "../lib/auth.js";
import { requireAuth, AUTH_COOKIE } from "../middleware/requireAuth.js";
import { resolveReferrerByCode } from "../lib/referrals.js";
import { notifyNewSignup } from "../lib/signup-notify.js";
import type { Response } from "express";

export const authRouter = Router();

// Cookie httpOnly con el JWT: no accesible desde JS (mitiga robo por XSS).
const isProd = process.env.NODE_ENV === "production";
const COOKIE_OPTS = {
  httpOnly: true,
  secure: isProd, // sólo por HTTPS en producción
  sameSite: "lax" as const,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 días (igual que el JWT)
  path: "/",
};
function setAuthCookie(res: Response, token: string) {
  res.cookie(AUTH_COOKIE, token, COOKIE_OPTS);
}

const registerSchema = z.object({
  email: z.string().email("Email inválido"),
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres"),
  name: z.string().min(1).optional(),
  phone: z.string().max(30).optional(), // WhatsApp del usuario (opcional)
  ref: z.string().max(20).optional(), // código de referido (/register?ref=CODE)
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Genera un slug único a partir del nombre/email, agregando sufijo si choca.
export async function uniqueSlug(base: string): Promise<string> {
  const root = slugify(base) || "user";
  let candidate = root;
  let n = 1;
  // En la práctica son pocas colisiones; el bucle corta apenas encuentra libre.
  while (await prisma.user.findUnique({ where: { slug: candidate } })) {
    candidate = `${root}-${n++}`;
  }
  return candidate;
}

authRouter.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Input inválido", details: parsed.error.flatten() });
  }
  const { email, password, name, phone, ref } = parsed.data;

  try {
    const slug = await uniqueSlug(name ?? email.split("@")[0]);
    // Referido: si vino un ?ref válido, guardamos quién lo refirió. La comisión (10%) recién se
    // liquida cuando ESTA cuenta hace su 1ra compra Y el referidor ya es cliente (ver referrals.ts).
    const referredById = ref ? await resolveReferrerByCode(ref) : null;
    const user = await prisma.user.create({
      data: {
        email,
        slug,
        name,
        phone,
        password: await hashPassword(password),
        ...(referredById ? { referredById, source: "referido" } : {}),
      },
      select: { id: true, email: true, slug: true, name: true, role: true, tokenVersion: true },
    });

    // Aviso al dueño (WhatsApp + email) del cliente nuevo, para contactarlo. Best-effort, no bloquea.
    void notifyNewSignup({ name, email, phone });

    const token = signToken({ userId: user.id, tv: user.tokenVersion });
    setAuthCookie(res, token);
    return res.status(201).json({
      token,
      user: { id: user.id, email: user.email, slug: user.slug, name: user.name, role: user.role },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return res.status(409).json({ error: "El email ya está registrado" });
    }
    console.error("[auth/register] error:", e);
    return res.status(500).json({ error: "Error al registrar" });
  }
});

// GET /api/auth/autologin?t=<jwt> — setea la cookie de sesión (same-site en app.publi.lat) y redirige
// al panel logueado. Lo usa el alta desde la landing EXTERNA (donde no se puede setear la cookie
// cross-site). El token se consume al instante y se limpia de la URL con el redirect.
authRouter.get("/autologin", (req, res) => {
  const t = typeof req.query.t === "string" ? req.query.t : "";
  const panel = (process.env.PANEL_BASE_URL?.split(",")[0] ?? "https://app.publi.lat").replace(/\/$/, "");
  let ok = false;
  try { ok = !!(t && verifyToken(t)); } catch { ok = false; }
  if (!ok) return res.redirect(`${panel}/login`);
  setAuthCookie(res, t);
  // Va DIRECTO a /billing a pagar/activar sus días — el embudo termina en la compra.
  return res.redirect(`${panel}/billing`);
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Input inválido", details: parsed.error.flatten() });
  }
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(password, user.password))) {
    return res.status(401).json({ error: "Credenciales inválidas" });
  }
  if (user.suspended) {
    return res.status(403).json({ error: "Cuenta suspendida. Escribinos para reactivarla." });
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const token = signToken({ userId: user.id, tv: user.tokenVersion });
  setAuthCookie(res, token);
  return res.json({
    token,
    user: { id: user.id, email: user.email, slug: user.slug, name: user.name, role: user.role },
  });
});

// POST /api/auth/logout — cierra la sesión borrando la cookie httpOnly.
authRouter.post("/logout", (_req, res) => {
  res.clearCookie(AUTH_COOKIE, { ...COOKIE_OPTS, maxAge: undefined });
  return res.json({ ok: true });
});

// GET /api/auth/me — usuario actual (incluye role para gatear el panel admin).
authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId! },
    select: { id: true, email: true, slug: true, name: true, role: true },
  });
  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });
  return res.json({ user });
});

// POST /api/auth/change-password — el cliente cambia SU PROPIA contraseña desde el panel.
// Verifica la actual, guarda el hash nuevo y SUBE tokenVersion (revoca las OTRAS sesiones);
// reemite la cookie de ESTA sesión para no desloguear a quien hizo el cambio.
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Ingresá tu contraseña actual"),
  newPassword: z.string().min(6, "La nueva contraseña debe tener al menos 6 caracteres"),
});
authRouter.post("/change-password", requireAuth, async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Input inválido", details: parsed.error.flatten() });
  }
  const { currentPassword, newPassword } = parsed.data;
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });
  if (!(await verifyPassword(currentPassword, user.password))) {
    return res.status(400).json({ error: "La contraseña actual es incorrecta" });
  }
  if (await verifyPassword(newPassword, user.password)) {
    return res.status(400).json({ error: "La nueva contraseña debe ser distinta de la actual" });
  }
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { password: await hashPassword(newPassword), tokenVersion: { increment: 1 } },
    select: { tokenVersion: true },
  });
  // Sesión actual: token nuevo con el tokenVersion nuevo (las demás quedan revocadas).
  const token = signToken({ userId: user.id, tv: updated.tokenVersion });
  setAuthCookie(res, token);
  return res.json({ ok: true });
});
