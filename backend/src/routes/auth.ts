// Auth: registro y login con JWT. Validación de input con zod.
import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { hashPassword, verifyPassword, signToken, slugify } from "../lib/auth.js";

export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Mínimo 8 caracteres"),
  name: z.string().min(1).optional(),
  // Pixel propio del usuario (opcional en el registro, requerido para que el loop matchee).
  pixelId: z.string().min(1).optional(),
  capiToken: z.string().min(1).optional(),
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
  const { email, password, name, pixelId, capiToken } = parsed.data;

  try {
    const slug = await uniqueSlug(name ?? email.split("@")[0]);
    const user = await prisma.user.create({
      data: {
        email,
        slug,
        name,
        password: await hashPassword(password),
        // Si vienen ambos, creamos el Pixel del usuario (se usa en /go y purchase).
        ...(pixelId && capiToken
          ? { pixels: { create: { pixelId, capiToken, eventType: "Lead" } } }
          : {}),
      },
      select: { id: true, email: true, slug: true, name: true },
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

  const token = signToken({ userId: user.id });
  return res.json({
    token,
    user: { id: user.id, email: user.email, slug: user.slug, name: user.name },
  });
});
