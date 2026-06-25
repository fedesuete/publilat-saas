// Auth: registro y login con JWT. Validación de input con zod.
import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { hashPassword, verifyPassword, signToken, slugify } from "../lib/auth.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().email("Email inválido"),
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres"),
  name: z.string().min(1).optional(),
  phone: z.string().max(30).optional(), // WhatsApp del usuario (opcional)
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Genera un slug único a partir del nombre/email, agregando sufijo si choca.
async function uniqueSlug(base: string): Promise<string> {
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
  const { email, password, name, phone } = parsed.data;

  try {
    const slug = await uniqueSlug(name ?? email.split("@")[0]);
    const user = await prisma.user.create({
      data: {
        email,
        slug,
        name,
        phone,
        password: await hashPassword(password),
      },
      select: { id: true, email: true, slug: true, name: true, role: true },
    });

    const token = signToken({ userId: user.id });
    return res.status(201).json({ token, user });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return res.status(409).json({ error: "El email ya está registrado" });
    }
    console.error("[auth/register] error:", e);
    return res.status(500).json({ error: "Error al registrar" });
  }
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

  const token = signToken({ userId: user.id });
  return res.json({
    token,
    user: { id: user.id, email: user.email, slug: user.slug, name: user.name, role: user.role },
  });
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
