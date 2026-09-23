// SUB-CUENTAS ("sub agentes"): un cliente padre puede tener cuentas hijas —cada una con SUS líneas,
// landings, contactos y pixel— y entrar a manejarlas desde su propio panel, sin compartir contraseñas.
//
// Reglas de seguridad (esto entrega una sesión de OTRA cuenta, así que van explícitas):
//   1. Solo se entra a una hija cuya `parentUserId` sea el PADRE REAL del que pide. Nada más.
//   2. Una hija NO puede entrar a la cuenta del padre ni crear cuentas propias (sin cadenas): el
//      "volver" solo funciona con el sello `parentId` del token, que lo firma el server al entrar.
//   3. Nunca sobre una cuenta ADMIN.
//   4. Crear está apagado por default para todos (`maxSubAccounts = 0`): lo habilita el admin por cliente.
import { Router, type Request } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { hashPassword, signToken, verifyToken, slugify, type JwtPayload } from "../lib/auth.js";
import { AUTH_COOKIE } from "../middleware/requireAuth.js";

export const subAccountsRouter = Router();

const COOKIE = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: "/",
};

// Lee el token de ESTA request para saber si es una sesión "prestada" (sello parentId). No toca
// requireAuth (que ya validó todo): solo necesitamos ese dato extra del payload.
function selloPadre(req: Request): string | null {
  const cookie = (req as unknown as { cookies?: Record<string, string> }).cookies?.[AUTH_COOKIE];
  const [scheme, bearer] = (req.get("authorization") ?? "").split(" ");
  const token = cookie || (scheme === "Bearer" ? bearer : "");
  if (!token) return null;
  try {
    const p = verifyToken(token) as JwtPayload & { parentId?: string };
    return typeof p.parentId === "string" ? p.parentId : null;
  } catch {
    return null;
  }
}

// Quién manda de verdad en esta sesión: si está prestada, el padre; si no, el usuario logueado.
function dueñoReal(req: Request): string {
  return selloPadre(req) ?? req.userId!;
}

async function uniqueSlug(base: string): Promise<string> {
  const raw = slugify(base) || "cuenta";
  for (let i = 0; i < 50; i++) {
    const slug = i === 0 ? raw : `${raw}-${i + 1}`;
    if (!(await prisma.user.findFirst({ where: { slug }, select: { id: true } }))) return slug;
  }
  return `${raw}-${Date.now().toString(36)}`;
}

// GET /api/subaccounts — qué cuentas manejo, en cuál estoy parado y si puedo crear más.
subAccountsRouter.get("/", async (req, res) => {
  const padreId = dueñoReal(req);
  const prestada = selloPadre(req) !== null;
  const padre = await prisma.user.findUnique({
    where: { id: padreId },
    select: { id: true, email: true, name: true, maxSubAccounts: true, parentUserId: true },
  });
  if (!padre) return res.status(404).json({ error: "Cuenta no encontrada" });

  const hijas = await prisma.user.findMany({
    where: { parentUserId: padre.id },
    select: { id: true, email: true, name: true, slug: true, createdAt: true, suspended: true, maxLines: true, _count: { select: { lines: true } } },
    orderBy: { createdAt: "asc" },
  });
  return res.json({
    // Una cuenta que ES hija no maneja nada: ve la función apagada.
    habilitado: !padre.parentUserId && (padre.maxSubAccounts > 0 || hijas.length > 0),
    max: padre.maxSubAccounts,
    puedeCrear: !padre.parentUserId && hijas.length < padre.maxSubAccounts,
    principal: { id: padre.id, email: padre.email, name: padre.name },
    // En qué cuenta está parado ahora mismo quien pregunta.
    actual: prestada ? req.userId! : padre.id,
    prestada,
    cuentas: hijas.map((h) => ({
      id: h.id,
      email: h.email,
      name: h.name,
      slug: h.slug,
      suspended: h.suspended,
      maxLines: h.maxLines,
      lineas: h._count.lines,
      createdAt: h.createdAt,
    })),
  });
});

// POST /api/subaccounts — crear una sub-cuenta. Solo el padre real y hasta su límite.
const crearSchema = z.object({
  email: z.string().email("Email inválido"),
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres"),
  name: z.string().min(1, "Poné un nombre").max(80),
  maxLines: z.number().int().min(0).max(100).optional(),
});
subAccountsRouter.post("/", async (req, res) => {
  if (selloPadre(req)) return res.status(403).json({ error: "Volvé a tu cuenta principal para crear sub-cuentas." });
  const parsed = crearSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido", details: parsed.error.flatten() });

  const padre = await prisma.user.findUnique({
    where: { id: req.userId! },
    select: { id: true, maxSubAccounts: true, parentUserId: true, maxLines: true },
  });
  if (!padre) return res.status(404).json({ error: "Cuenta no encontrada" });
  if (padre.parentUserId) return res.status(403).json({ error: "Una sub-cuenta no puede crear otras sub-cuentas." });

  const cuantas = await prisma.user.count({ where: { parentUserId: padre.id } });
  if (cuantas >= padre.maxSubAccounts) {
    return res.status(403).json({
      error: padre.maxSubAccounts === 0
        ? "Tu plan no incluye sub-cuentas todavía. Escribinos y te las habilitamos."
        : `Llegaste al máximo de sub-cuentas de tu plan (${padre.maxSubAccounts}).`,
    });
  }

  const email = parsed.data.email.toLowerCase().trim();
  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
    return res.status(409).json({ error: "Ya existe una cuenta con ese email." });
  }
  const hija = await prisma.user.create({
    data: {
      email,
      name: parsed.data.name.trim(),
      slug: await uniqueSlug(parsed.data.name || email.split("@")[0]),
      password: await hashPassword(parsed.data.password),
      parentUserId: padre.id,
      maxSubAccounts: 0, // sin cadenas: una hija no arma su propia red
      // Nunca más números que los del padre: si no, se podría esquivar el límite del plan propio
      // creando una hija con 100 líneas.
      maxLines: Math.min(parsed.data.maxLines ?? 5, padre.maxLines),
    },
    select: { id: true, email: true, name: true, slug: true, maxLines: true },
  });
  console.log(`[subcuentas] ${padre.id} creó la sub-cuenta ${hija.id} (${hija.email})`);
  return res.status(201).json({ cuenta: hija });
});

// POST /api/subaccounts/:id/entrar — pasa la sesión a esa sub-cuenta (cookie sellada con el padre).
subAccountsRouter.post("/:id/entrar", async (req, res) => {
  const padreId = dueñoReal(req);
  const hija = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: { id: true, email: true, name: true, slug: true, role: true, tokenVersion: true, parentUserId: true, suspended: true },
  });
  // Mismo mensaje para "no existe" y "no es tuya": no confirmamos cuentas ajenas.
  if (!hija || hija.parentUserId !== padreId) return res.status(404).json({ error: "Sub-cuenta no encontrada" });
  if (hija.role === "ADMIN") return res.status(403).json({ error: "No se puede entrar a una cuenta de administrador." });
  if (hija.suspended) return res.status(403).json({ error: "Esa sub-cuenta está suspendida." });

  const token = signToken({ userId: hija.id, tv: hija.tokenVersion, parentId: padreId });
  res.cookie(AUTH_COOKIE, token, COOKIE);
  console.log(`[subcuentas] ${padreId} entró a la sub-cuenta ${hija.id}`);
  return res.json({ ok: true, token, cuenta: { id: hija.id, email: hija.email, name: hija.name, slug: hija.slug } });
});

// POST /api/subaccounts/volver — vuelve a la cuenta principal. Solo con el sello del token.
subAccountsRouter.post("/volver", async (req, res) => {
  const padreId = selloPadre(req);
  if (!padreId) return res.status(400).json({ error: "No estás dentro de una sub-cuenta." });
  // Doble chequeo contra la DB: la sesión actual tiene que seguir siendo hija de ese padre.
  const yo = await prisma.user.findUnique({ where: { id: req.userId! }, select: { parentUserId: true } });
  if (!yo || yo.parentUserId !== padreId) return res.status(403).json({ error: "Esta cuenta ya no depende de la principal." });
  const padre = await prisma.user.findUnique({
    where: { id: padreId },
    select: { id: true, email: true, name: true, slug: true, tokenVersion: true, suspended: true },
  });
  if (!padre || padre.suspended) return res.status(404).json({ error: "Cuenta principal no disponible" });

  const token = signToken({ userId: padre.id, tv: padre.tokenVersion });
  res.cookie(AUTH_COOKIE, token, COOKIE);
  return res.json({ ok: true, token, cuenta: { id: padre.id, email: padre.email, name: padre.name, slug: padre.slug } });
});
