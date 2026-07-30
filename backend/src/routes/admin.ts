// Panel maestro (super-admin). Todas las rutas van bajo requireAuth + requireAdmin.
// Vista global por encima de todas las cuentas (multi-tenant). Acciones auditadas en AdminLog.
// No expone secretos (CAPI token, access token) ni el contenido de Inbox de los clientes.
import { Router } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { emitToUser } from "../lib/io.js";
import { retryFailedCapi, enqueueProxyRecover } from "../lib/queue.js";
import { hashPassword } from "../lib/auth.js";
import { encryptSecret } from "../lib/crypto.js";
import { assignProxy, rotateProxy, applyLineProxy, logProxyEvent } from "../lib/proxy-pool.js";
import { getEngine } from "../lib/wa-engine.js";
import { uniqueSlug } from "./auth.js";

export const adminRouter = Router();

// ---- helpers ----
// Genera una contraseña legible (sin caracteres ambiguos 0/O/1/l/I) para pasarle al cliente.
function genPassword(len = 10): string {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length];
  return out;
}

async function adminLog(adminId: string, action: string, targetUserId?: string, meta?: unknown) {
  await prisma.adminLog
    .create({ data: { adminId, action, targetUserId, meta: (meta ?? undefined) as object } })
    .catch(() => undefined);
}

async function emitToAdmins(event: string, payload: unknown) {
  const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
  for (const a of admins) emitToUser(a.id, event, payload);
}

const now = () => new Date();
const monthStart = () => {
  const d = now();
  return new Date(d.getFullYear(), d.getMonth(), 1);
};
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

// Estado legible de una cuenta.
function accountStatus(u: { suspended: boolean; isDemo: boolean; demoExpiresAt: Date | null }, days: number, activeLines: number): string {
  if (u.suspended) return "suspendido";
  if (u.isDemo && u.demoExpiresAt && u.demoExpiresAt > now()) return "demo";
  if (u.isDemo && u.demoExpiresAt && u.demoExpiresAt <= now()) return "demo_vencida";
  if (activeLines > 0 || days > 0) return "activo";
  return "inactivo";
}

// ============================ 4A. RESUMEN ============================
adminRouter.get("/overview", async (_req, res) => {
  const t = now();
  const [
    totalClients,
    suspended,
    demoActive,
    totalLines,
    activeLines,
    revByCurrency,
    revMonthByCurrency,
    grantedAgg,
    consumedAgg,
    leadsTotal,
    comprasAgg,
    eventsByStatus,
    demosTotal,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { suspended: true } }),
    prisma.user.count({ where: { isDemo: true, demoExpiresAt: { gt: t } } }),
    prisma.waLine.count(),
    prisma.waLine.count({ where: { connected: true, status: "active", OR: [{ expiresAt: null }, { expiresAt: { gt: t } }] } }),
    prisma.payment.groupBy({ by: ["currency"], where: { status: "approved" }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.payment.groupBy({ by: ["currency"], where: { status: "approved", createdAt: { gte: monthStart() } }, _sum: { amount: true } }),
    prisma.creditLedger.aggregate({ where: { delta: { gt: 0 } }, _sum: { delta: true } }),
    prisma.creditLedger.aggregate({ where: { delta: { lt: 0 } }, _sum: { delta: true } }),
    prisma.contact.count(),
    prisma.contact.aggregate({ where: { stage: "COMPRO" }, _count: { _all: true }, _sum: { amount: true } }),
    prisma.metaEvent.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.user.count({ where: { OR: [{ isDemo: true }, { demoExpiresAt: { not: null } }] } }),
  ]);

  // Ingresos por mes (últimos 6) y nuevos clientes por semana (8) — reduce en JS.
  const [paysRecent, usersRecent] = await Promise.all([
    prisma.payment.findMany({ where: { status: "approved", createdAt: { gte: daysAgo(186) } }, select: { amount: true, currency: true, createdAt: true } }),
    prisma.user.findMany({ where: { createdAt: { gte: daysAgo(56) } }, select: { createdAt: true } }),
  ]);
  const revByMonth: Record<string, number> = {};
  for (const p of paysRecent) {
    const k = `${p.createdAt.getFullYear()}-${String(p.createdAt.getMonth() + 1).padStart(2, "0")}`;
    revByMonth[k] = (revByMonth[k] ?? 0) + (p.amount ?? 0) / 100;
  }
  const newByWeek: Record<string, number> = {};
  for (const u of usersRecent) {
    const d = u.createdAt;
    const onejan = new Date(d.getFullYear(), 0, 1);
    const week = Math.ceil(((d.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7);
    const k = `${d.getFullYear()}-S${week}`;
    newByWeek[k] = (newByWeek[k] ?? 0) + 1;
  }

  // Conversión de demos a pago.
  const demoUserIds = (await prisma.user.findMany({ where: { OR: [{ isDemo: true }, { demoExpiresAt: { not: null } }] }, select: { id: true } })).map((x) => x.id);
  const demoConverted = demoUserIds.length
    ? await prisma.payment.findMany({ where: { userId: { in: demoUserIds }, status: "approved" }, distinct: ["userId"], select: { userId: true } })
    : [];

  return res.json({
    clients: { total: totalClients, suspended, demo: demoActive, active: totalClients - suspended - demoActive },
    lines: { total: totalLines, active: activeLines },
    revenue: {
      total: revByCurrency.map((r) => ({ currency: r.currency, amount: (r._sum.amount ?? 0) / 100, count: r._count._all })),
      month: revMonthByCurrency.map((r) => ({ currency: r.currency, amount: (r._sum.amount ?? 0) / 100 })),
      byMonth: revByMonth,
    },
    days: { granted: grantedAgg._sum.delta ?? 0, consumed: Math.abs(consumedAgg._sum.delta ?? 0) },
    attribution: {
      leads: leadsTotal,
      compras: comprasAgg._count._all,
      facturacion: (comprasAgg._sum.amount ?? 0) / 100,
    },
    capi: Object.fromEntries(eventsByStatus.map((e) => [e.status, e._count._all])),
    growth: { newByWeek },
    demos: { total: demosTotal, converted: demoConverted.length },
  });
});

// ============================ 4B. CLIENTES ============================
adminRouter.get("/clients", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const perPage = 20;

  const where: any = {};
  if (q) where.OR = [{ email: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }];
  if (status === "suspended") where.suspended = true;
  if (status === "demo") where.isDemo = true;

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
      select: { id: true, email: true, name: true, suspended: true, isDemo: true, demoExpiresAt: true, lastLoginAt: true, createdAt: true, role: true },
    }),
  ]);

  const ids = users.map((u) => u.id);
  const [credits, linesAll, linesActive, leadsBy, comprasBy] = await Promise.all([
    prisma.credit.findMany({ where: { userId: { in: ids } }, select: { userId: true, days: true } }),
    prisma.waLine.groupBy({ by: ["userId"], where: { userId: { in: ids } }, _count: { _all: true } }),
    prisma.waLine.groupBy({ by: ["userId"], where: { userId: { in: ids }, connected: true }, _count: { _all: true } }),
    prisma.contact.groupBy({ by: ["userId"], where: { userId: { in: ids } }, _count: { _all: true } }),
    prisma.contact.groupBy({ by: ["userId"], where: { userId: { in: ids }, stage: "COMPRO" }, _count: { _all: true }, _sum: { amount: true } }),
  ]);
  const m = <T extends { userId: string }>(arr: T[]) => Object.fromEntries(arr.map((x) => [x.userId, x]));
  const cM = m(credits), laM = m(linesAll), lcM = m(linesActive), ldM = m(leadsBy), cpM = m(comprasBy);

  const clients = users.map((u) => {
    const days = cM[u.id]?.days ?? 0;
    const linesTotal = laM[u.id]?._count._all ?? 0;
    const conn = lcM[u.id]?._count._all ?? 0;
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      status: accountStatus(u, days, conn),
      days,
      lines: { connected: conn, total: linesTotal },
      leads: ldM[u.id]?._count._all ?? 0,
      compras: cpM[u.id]?._count._all ?? 0,
      facturacion: (cpM[u.id]?._sum.amount ?? 0) / 100,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
      demoExpiresAt: u.demoExpiresAt,
    };
  });

  return res.json({ clients, total, page, perPage, pages: Math.ceil(total / perPage) });
});

// Crear una cuenta de cliente a mano (onboarding manual desde el panel maestro).
// Genera el slug único, hashea la contraseña y, opcionalmente, acredita días iniciales
// y fija el límite de líneas. No inicia sesión: el cliente entra con su email+contraseña.
const createClientSchema = z.object({
  email: z.string().email("Email inválido"),
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres"),
  name: z.string().min(1).max(120).optional(),
  phone: z.string().max(30).optional(),
  days: z.number().int().min(0).max(3650).optional(),   // crédito de días inicial
  maxLines: z.number().int().min(0).max(100).optional(), // líneas permitidas del plan
});
adminRouter.post("/clients", async (req, res) => {
  const parsed = createClientSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido", details: parsed.error.flatten() });
  const { email, password, name, phone, days, maxLines } = parsed.data;
  try {
    const slug = await uniqueSlug(name ?? email.split("@")[0]);
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase().trim(),
        slug,
        name,
        phone,
        password: await hashPassword(password),
        ...(maxLines !== undefined ? { maxLines } : {}),
        source: "admin", // cómo se dio de alta la cuenta
      },
      select: { id: true, email: true, slug: true, name: true },
    });
    // Crédito inicial opcional (queda registrado en el ledger).
    if (days && days > 0) {
      const credit = await prisma.credit.create({ data: { userId: user.id, days } });
      await prisma.creditLedger.create({ data: { creditId: credit.id, delta: days, reason: `admin: alta con ${days}d` } });
    }
    await adminLog(req.userId!, "create_client", user.id, { email: user.email, days: days ?? 0, maxLines });
    return res.status(201).json({ ok: true, client: user });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return res.status(409).json({ error: "Ya existe una cuenta con ese email" });
    }
    console.error("[admin/clients create] error:", e);
    return res.status(500).json({ error: "No se pudo crear el cliente" });
  }
});

// Detalle de una cuenta.
adminRouter.get("/clients/:id", async (req, res) => {
  const id = req.params.id;
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, name: true, phone: true, slug: true, role: true, suspended: true, isDemo: true, demoExpiresAt: true, source: true, lastLoginAt: true, createdAt: true, maxLines: true, maxLandings: true },
  });
  if (!user) return res.status(404).json({ error: "Cliente no encontrado" });

  const [credit, lines, payments, leads, compras] = await Promise.all([
    prisma.credit.findUnique({ where: { userId: id }, select: { days: true } }),
    prisma.waLine.findMany({ where: { userId: id }, select: { id: true, label: true, phone: true, provider: true, status: true, connected: true, expiresAt: true, lastUsedAt: true }, orderBy: { createdAt: "asc" } }),
    prisma.payment.findMany({ where: { userId: id }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, provider: true, days: true, amount: true, currency: true, status: true, createdAt: true } }),
    prisma.contact.count({ where: { userId: id } }),
    prisma.contact.aggregate({ where: { userId: id, stage: "COMPRO" }, _count: { _all: true }, _sum: { amount: true } }),
  ]);

  return res.json({
    user,
    days: credit?.days ?? 0,
    lines,
    payments: payments.map((p) => ({ ...p, amount: (p.amount ?? 0) / 100 })),
    leads,
    compras: compras._count._all,
    facturacion: (compras._sum.amount ?? 0) / 100,
  });
});

// Sumar/restar días.
const creditsSchema = z.object({ days: z.number().int(), note: z.string().max(200).optional() });
adminRouter.post("/clients/:id/credits", async (req, res) => {
  const parsed = creditsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido" });
  const { days, note } = parsed.data;
  const userId = req.params.id;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) return res.status(404).json({ error: "Cliente no encontrado" });

  const credit = (await prisma.credit.findUnique({ where: { userId } })) ?? (await prisma.credit.create({ data: { userId, days: 0 } }));
  const updated = await prisma.credit.update({
    where: { id: credit.id },
    data: { days: { increment: days }, ledger: { create: { delta: days, reason: `admin: ${days > 0 ? "+" : ""}${days}d${note ? ` (${note})` : ""}` } } },
  });
  await adminLog(req.userId!, "credits", userId, { days, note });
  return res.json({ ok: true, days: updated.days });
});

// Cambiar / resetear la contraseña de un cliente. Devuelve la nueva EN TEXTO PLANO una vez para
// que el admin se la pase (las contraseñas se guardan hasheadas, no se pueden recuperar). Si no
// mandan `password`, se genera una aleatoria. No se permite sobre otro ADMIN.
const passwordSchema = z.object({ password: z.string().min(6).max(100).optional() });
adminRouter.post("/clients/:id/password", async (req, res) => {
  const parsed = passwordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres." });
  const userId = req.params.id;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, name: true, role: true } });
  if (!user) return res.status(404).json({ error: "Cliente no encontrado" });
  if (user.role === "ADMIN") return res.status(403).json({ error: "No se puede cambiar la contraseña de un administrador desde acá." });
  const password = parsed.data.password ?? genPassword();
  await prisma.user.update({ where: { id: userId }, data: { password: await hashPassword(password) } });
  await adminLog(req.userId!, "reset_password", userId, { email: user.email });
  return res.json({ email: user.email, name: user.name, password });
});

// Editar límites del plan (líneas / landings) por cliente.
const limitsSchema = z.object({ maxLines: z.number().int().min(0).max(100).optional(), maxLandings: z.number().int().min(0).max(1000).optional() });
adminRouter.post("/clients/:id/limits", async (req, res) => {
  const parsed = limitsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido" });
  const userId = req.params.id;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) return res.status(404).json({ error: "Cliente no encontrado" });
  const data: { maxLines?: number; maxLandings?: number } = {};
  if (parsed.data.maxLines !== undefined) data.maxLines = parsed.data.maxLines;
  if (parsed.data.maxLandings !== undefined) data.maxLandings = parsed.data.maxLandings;
  const updated = await prisma.user.update({ where: { id: userId }, data, select: { maxLines: true, maxLandings: true } });
  await adminLog(req.userId!, "limits", userId, data);
  return res.json({ ok: true, ...updated });
});

// Activar demo de N días (default 5).
const demoSchema = z.object({ days: z.number().int().positive().max(60).optional() });
adminRouter.post("/clients/:id/demo", async (req, res) => {
  const parsed = demoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido" });
  const days = parsed.data.days ?? 5;
  const userId = req.params.id;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) return res.status(404).json({ error: "Cliente no encontrado" });

  const demoExpiresAt = daysAgo(-days); // ahora + days
  const credit = (await prisma.credit.findUnique({ where: { userId } })) ?? (await prisma.credit.create({ data: { userId, days: 0 } }));
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { isDemo: true, demoExpiresAt, source: "demo" } }),
    prisma.credit.update({ where: { id: credit.id }, data: { days: { increment: days }, ledger: { create: { delta: days, reason: `demo ${days}d` } } } }),
  ]);
  await adminLog(req.userId!, "demo", userId, { days });
  return res.json({ ok: true, days, demoExpiresAt });
});

// Suspender / reactivar.
const suspendSchema = z.object({ suspended: z.boolean() });
adminRouter.post("/clients/:id/suspend", async (req, res) => {
  const parsed = suspendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido" });
  const userId = req.params.id;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) return res.status(404).json({ error: "Cliente no encontrado" });
  await prisma.user.update({
    where: { id: userId },
    // Al suspender, incrementamos tokenVersion para revocar sus sesiones activas al instante.
    data: { suspended: parsed.data.suspended, ...(parsed.data.suspended ? { tokenVersion: { increment: 1 } } : {}) },
  });
  await adminLog(req.userId!, parsed.data.suspended ? "suspend" : "reactivate", userId);
  return res.json({ ok: true, suspended: parsed.data.suspended });
});

// ============================ 4C. LÍNEAS (global) ============================
adminRouter.get("/lines", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const where: any = {};
  if (status === "connected") where.connected = true;
  if (status === "disconnected") where.connected = false;
  const lines = await prisma.waLine.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: { id: true, label: true, phone: true, provider: true, status: true, connected: true, expiresAt: true, lastUsedAt: true, warmupEnabled: true, user: { select: { email: true, name: true } } },
  });
  return res.json({ lines });
});

// POST /api/admin/lines/:id/warmup — prende/apaga el calentamiento de CUALQUIER línea (admin).
// Apagado = envíos sin límite (más riesgo de baneo si se manda mucho en frío).
adminRouter.post("/lines/:id/warmup", async (req, res) => {
  const enabled = req.body?.enabled === true;
  const line = await prisma.waLine.findUnique({ where: { id: req.params.id }, select: { id: true, userId: true } });
  if (!line) return res.status(404).json({ error: "Línea no encontrada" });
  const updated = await prisma.waLine.update({ where: { id: line.id }, data: { warmupEnabled: enabled }, select: { warmupEnabled: true } });
  await adminLog(req.userId!, "warmup_toggle", line.userId, { lineId: line.id, enabled });
  return res.json({ ok: true, warmupEnabled: updated.warmupEnabled });
});

// ============================ 4D. INGRESOS ============================
adminRouter.get("/revenue", async (_req, res) => {
  const periods: Record<string, Date | null> = { today: daysAgo(1), d7: daysAgo(7), d30: daysAgo(30), total: null };
  const byPeriod: Record<string, Array<{ currency: string; amount: number }>> = {};
  for (const [k, since] of Object.entries(periods)) {
    const rows = await prisma.payment.groupBy({
      by: ["currency"],
      where: { status: "approved", ...(since ? { createdAt: { gte: since } } : {}) },
      _sum: { amount: true },
    });
    byPeriod[k] = rows.map((r) => ({ currency: r.currency, amount: (r._sum.amount ?? 0) / 100 }));
  }
  const byGateway = await prisma.payment.groupBy({
    by: ["provider", "currency"],
    where: { status: "approved" },
    _sum: { amount: true },
    _count: { _all: true },
  });
  // Top clientes por facturación atribuida (compras marcadas).
  const topRaw = await prisma.contact.groupBy({ by: ["userId"], where: { stage: "COMPRO" }, _sum: { amount: true }, _count: { _all: true } });
  const top = topRaw
    .map((r) => ({ userId: r.userId, facturacion: (r._sum.amount ?? 0) / 100, compras: r._count._all }))
    .sort((a, b) => b.facturacion - a.facturacion)
    .slice(0, 10);
  const topUsers = await prisma.user.findMany({ where: { id: { in: top.map((t) => t.userId) } }, select: { id: true, email: true, name: true } });
  const um = Object.fromEntries(topUsers.map((u) => [u.id, u]));
  return res.json({
    byPeriod,
    byGateway: byGateway.map((r) => ({ provider: r.provider, currency: r.currency, amount: (r._sum.amount ?? 0) / 100, count: r._count._all })),
    topClients: top.map((t) => ({ ...t, email: um[t.userId]?.email ?? "—", name: um[t.userId]?.name ?? null })),
  });
});

// Pagos recientes (todos los clientes).
adminRouter.get("/payments", async (_req, res) => {
  const payments = await prisma.payment.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, provider: true, days: true, amount: true, currency: true, status: true, createdAt: true, user: { select: { email: true, name: true } } },
  });
  return res.json({ payments: payments.map((p) => ({ ...p, amount: (p.amount ?? 0) / 100 })) });
});

// ============================ 4E. DEMOS ============================
adminRouter.get("/demos", async (_req, res) => {
  const users = await prisma.user.findMany({
    where: { OR: [{ isDemo: true }, { demoExpiresAt: { not: null } }] },
    orderBy: { demoExpiresAt: "desc" },
    select: { id: true, email: true, name: true, demoExpiresAt: true, createdAt: true },
  });
  const ids = users.map((u) => u.id);
  const [linesBy, leadsBy, paysBy] = await Promise.all([
    prisma.waLine.groupBy({ by: ["userId"], where: { userId: { in: ids }, connected: true }, _count: { _all: true } }),
    prisma.contact.groupBy({ by: ["userId"], where: { userId: { in: ids } }, _count: { _all: true } }),
    prisma.payment.findMany({ where: { userId: { in: ids }, status: "approved" }, distinct: ["userId"], select: { userId: true } }),
  ]);
  const lc = Object.fromEntries(linesBy.map((x) => [x.userId, x._count._all]));
  const ld = Object.fromEntries(leadsBy.map((x) => [x.userId, x._count._all]));
  const paid = new Set(paysBy.map((x) => x.userId));
  const t = now();
  const demos = users.map((u) => {
    const expired = u.demoExpiresAt ? u.demoExpiresAt <= t : true;
    const badge = paid.has(u.id) ? "convirtió" : expired ? "demo vencida" : "en demo";
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      demoExpiresAt: u.demoExpiresAt,
      connectedLines: lc[u.id] ?? 0,
      leads: ld[u.id] ?? 0,
      badge,
    };
  });
  return res.json({ demos });
});

// ============================ 4F. SOPORTE ============================
adminRouter.get("/support", async (_req, res) => {
  const msgs = await prisma.supportMessage.findMany({
    orderBy: { createdAt: "desc" },
    include: { user: { select: { email: true, name: true } } },
  });
  // Agrupar por usuario: último mensaje + no leídos (del cliente, sin readAt).
  const map = new Map<string, { userId: string; email: string; name: string | null; last: string; lastAt: Date; unread: number }>();
  for (const m of msgs) {
    const e = map.get(m.userId);
    if (!e) {
      map.set(m.userId, { userId: m.userId, email: m.user.email, name: m.user.name, last: m.body, lastAt: m.createdAt, unread: !m.fromAdmin && !m.readAt ? 1 : 0 });
    } else if (!m.fromAdmin && !m.readAt) {
      e.unread++;
    }
  }
  return res.json({ threads: [...map.values()] });
});

adminRouter.get("/support/:userId", async (req, res) => {
  const userId = req.params.userId;
  const messages = await prisma.supportMessage.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  await prisma.supportMessage.updateMany({ where: { userId, fromAdmin: false, readAt: null }, data: { readAt: new Date() } });
  return res.json({ messages });
});

const replySchema = z.object({ body: z.string().min(1).max(4000) });
adminRouter.post("/support/:userId/reply", async (req, res) => {
  const parsed = replySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido" });
  const userId = req.params.userId;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) return res.status(404).json({ error: "Cliente no encontrado" });
  const msg = await prisma.supportMessage.create({ data: { userId, fromAdmin: true, body: parsed.data.body, readAt: new Date() } });
  emitToUser(userId, "support:message", msg);
  void adminLog(req.userId!, "support_reply", userId);
  return res.status(201).json({ message: msg });
});

// ============================ 4G. EXPORTAR CSV ============================
function csv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
}

adminRouter.get("/export/:type", async (req, res) => {
  const type = req.params.type;
  let rows: Array<Record<string, unknown>> = [];
  if (type === "clients") {
    const users = await prisma.user.findMany({ select: { email: true, name: true, suspended: true, isDemo: true, lastLoginAt: true, createdAt: true } });
    rows = users.map((u) => ({ email: u.email, nombre: u.name ?? "", suspendido: u.suspended, demo: u.isDemo, ultimo_acceso: u.lastLoginAt?.toISOString() ?? "", alta: u.createdAt.toISOString() }));
  } else if (type === "revenue") {
    const pays = await prisma.payment.findMany({ where: { status: "approved" }, include: { user: { select: { email: true } } }, orderBy: { createdAt: "desc" } });
    rows = pays.map((p) => ({ fecha: p.createdAt.toISOString(), cliente: p.user.email, proveedor: p.provider, dias: p.days, monto: (p.amount ?? 0) / 100, moneda: p.currency, estado: p.status }));
  } else if (type === "leads") {
    const leads = await prisma.contact.findMany({ select: { externalId: true, source: true, campaignId: true, stage: true, amount: true, createdAt: true, user: { select: { email: true } } }, orderBy: { createdAt: "desc" }, take: 5000 });
    rows = leads.map((l) => ({ fecha: l.createdAt.toISOString(), cliente: l.user.email, externalId: l.externalId, fuente: l.source ?? "", campaña: l.campaignId ?? "", etapa: l.stage, monto: l.amount != null ? l.amount / 100 : "" }));
  } else {
    return res.status(400).json({ error: "Tipo inválido (clients|revenue|leads)" });
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${type}-${Date.now()}.csv"`);
  return res.send(csv(rows));
});

// ============================ LANDINGS (global) ============================
// GET /api/admin/landings — todas las landings de los clientes con su URL pública,
// para verificar que funcionan sin entrar al panel de cada cliente.
adminRouter.get("/landings", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const where: any = {};
  if (status === "published") where.published = true;
  if (status === "draft") where.published = false;
  if (q) where.OR = [{ name: { contains: q, mode: "insensitive" } }, { slug: { contains: q, mode: "insensitive" } }, { user: { email: { contains: q, mode: "insensitive" } } }];

  const base = (process.env.APP_BASE_URL ?? "").replace(/\/$/, "");
  const landings = await prisma.landing.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, slug: true, isPrimary: true, published: true, publishedUrl: true, createdAt: true, user: { select: { email: true, name: true } } },
  });
  return res.json({
    landings: landings.map((l) => ({
      id: l.id,
      name: l.name,
      slug: l.slug,
      isPrimary: l.isPrimary,
      published: l.published,
      createdAt: l.createdAt,
      email: l.user.email,
      ownerName: l.user.name,
      url: l.publishedUrl ?? (base ? `${base}/p/${l.slug}` : `/p/${l.slug}`),
    })),
  });
});

// ============================ CAPI: eventos fallidos ============================
// GET /api/admin/capi/failed — resumen de eventos CAPI fallidos (para monitoreo).
adminRouter.get("/capi/failed", async (_req, res) => {
  const [total, deadLetter, noPixel, recent] = await Promise.all([
    prisma.metaEvent.count({ where: { status: "failed" } }),
    prisma.metaEvent.count({ where: { status: "failed", attempts: { gte: 2 } } }),
    prisma.metaEvent.count({ where: { status: "no_pixel" } }), // eventos muertos por falta de pixel del cliente
    prisma.metaEvent.findMany({
      where: { status: { in: ["failed", "no_pixel"] } },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, userId: true, eventName: true, status: true, attempts: true, createdAt: true, response: true },
    }),
  ]);
  return res.json({ total, deadLetter, noPixel, recent });
});

// POST /api/admin/capi/retry — reintenta los eventos fallidos (incluye dead-letter).
adminRouter.post("/capi/retry", async (req, res) => {
  const retried = await retryFailedCapi({ includeDead: true, max: 200 });
  await adminLog(req.userId!, "capi_retry", undefined, { retried });
  return res.json({ ok: true, retried });
});

// ============================ PROXIES (pool anti-ban, SOLO admin) ============================
// Vista de un proxy para el ADMIN (el admin gestiona el pool): NUNCA la password en claro.
function toAdminProxy(p: {
  id: string; label: string; provider: string; host: string; port: number; username: string;
  protocol: string; country: string | null; sticky: boolean; sessTime: number; maxLines: number;
  active: boolean; healthy: boolean; lastCheckAt: Date | null; createdAt: Date; _count?: { lines: number };
}) {
  return {
    id: p.id, label: p.label, provider: p.provider, host: p.host, port: p.port, username: p.username,
    protocol: p.protocol, country: p.country, sticky: p.sticky, sessTime: p.sessTime, maxLines: p.maxLines,
    active: p.active, healthy: p.healthy, lastCheckAt: p.lastCheckAt, createdAt: p.createdAt,
    lineCount: p._count?.lines ?? 0,
  };
}

const proxyCreateSchema = z.object({
  label: z.string().min(1).max(80),
  provider: z.string().max(40).default("dataimpulse"),
  host: z.string().min(1).max(200),
  port: z.number().int().min(1).max(65535),
  username: z.string().min(1).max(200),
  password: z.string().min(1).max(400),
  protocol: z.enum(["http", "socks5"]).default("http"),
  country: z.string().max(8).optional(),
  sticky: z.boolean().default(true),
  sessTime: z.number().int().min(1).max(1440).default(120),
  maxLines: z.number().int().min(1).max(100).default(4),
  active: z.boolean().default(true),
});

// GET /api/admin/proxies — pool con conteo de líneas y salud.
adminRouter.get("/proxies", async (_req, res) => {
  const proxies = await prisma.proxy.findMany({ orderBy: { createdAt: "asc" }, include: { _count: { select: { lines: true } } } });
  return res.json({ proxies: proxies.map(toAdminProxy) });
});

// POST /api/admin/proxies — crea un proxy (password cifrada en reposo).
adminRouter.post("/proxies", async (req, res) => {
  const parsed = proxyCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido", details: parsed.error.flatten() });
  const d = parsed.data;
  const p = await prisma.proxy.create({ data: { ...d, password: encryptSecret(d.password), country: d.country ?? null } });
  await adminLog(req.userId!, "proxy_create", undefined, { proxyId: p.id, label: p.label });
  return res.status(201).json({ proxy: toAdminProxy({ ...p, _count: { lines: 0 } }) });
});

// PATCH /api/admin/proxies/:id — edita (si viene password, se re-cifra).
adminRouter.patch("/proxies/:id", async (req, res) => {
  const parsed = proxyCreateSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido" });
  const d = parsed.data;
  const data: Record<string, unknown> = { ...d };
  if (d.password) data.password = encryptSecret(d.password);
  if ("country" in d) data.country = d.country ?? null;
  const p = await prisma.proxy
    .update({ where: { id: req.params.id }, data, include: { _count: { select: { lines: true } } } })
    .catch(() => null);
  if (!p) return res.status(404).json({ error: "Proxy no encontrado" });
  await adminLog(req.userId!, "proxy_update", undefined, { proxyId: p.id });
  return res.json({ proxy: toAdminProxy(p) });
});

// DELETE /api/admin/proxies/:id — las líneas asignadas quedan sin proxy (onDelete SetNull).
adminRouter.delete("/proxies/:id", async (req, res) => {
  await prisma.proxy.delete({ where: { id: req.params.id } }).catch(() => undefined);
  await adminLog(req.userId!, "proxy_delete", undefined, { proxyId: req.params.id });
  return res.json({ ok: true });
});

// GET /api/admin/proxies/lines — todas las líneas Baileys con su proxy asignado y estado.
adminRouter.get("/proxies/lines", async (_req, res) => {
  const lines = await prisma.waLine.findMany({
    where: { provider: { not: "cloud" } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, phone: true, label: true, status: true, connected: true, banned: true,
      proxyId: true, proxySession: true, lastProxyRotateAt: true,
      user: { select: { slug: true, email: true } },
      proxy: { select: { id: true, label: true, host: true, port: true, country: true, healthy: true } },
    },
  });
  return res.json({ lines });
});

// GET /api/admin/proxies/events — auditoría (últimos 100 eventos).
adminRouter.get("/proxies/events", async (_req, res) => {
  const events = await prisma.proxyEvent.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  return res.json({ events });
});

// POST /api/admin/lines/:id/proxy — asigna/cambia el proxy. body { proxyId? } (sin proxyId = auto
// least-loaded). Aplica al motor y reinicia para salir por la IP nueva.
adminRouter.post("/lines/:id/proxy", async (req, res) => {
  const id = req.params.id;
  const line = await prisma.waLine.findUnique({ where: { id }, select: { id: true, provider: true, sessionId: true } });
  if (!line) return res.status(404).json({ error: "Línea no encontrada" });
  if (line.provider === "cloud") return res.status(400).json({ error: "Las líneas Cloud API no usan proxy" });
  const proxyId = typeof req.body?.proxyId === "string" ? req.body.proxyId : null;
  let result: { ok: boolean; proxyId?: string; reason?: string };
  if (proxyId) {
    const proxy = await prisma.proxy.findUnique({ where: { id: proxyId }, select: { active: true } });
    if (!proxy || !proxy.active) return res.status(400).json({ error: "Proxy inexistente o inactivo" });
    const session = crypto.randomBytes(6).toString("hex");
    await prisma.waLine.update({ where: { id }, data: { proxyId, proxySession: session, proxyAssignedAt: new Date() } });
    await logProxyEvent(id, proxyId, "assigned", "asignado por admin");
    result = { ok: true, proxyId };
  } else {
    result = await assignProxy(id);
  }
  if (result.ok) {
    const inst = line.sessionId ?? `line_${id}`;
    await applyLineProxy(inst, id);
    await getEngine().restartInstance(inst).catch(() => undefined);
  }
  await adminLog(req.userId!, "proxy_assign", undefined, { lineId: id, ...result });
  return res.json(result);
});

// POST /api/admin/lines/:id/rotate — rota la IP (nueva sesión sticky) y reinicia.
adminRouter.post("/lines/:id/rotate", async (req, res) => {
  const id = req.params.id;
  const line = await prisma.waLine.findUnique({ where: { id }, select: { sessionId: true, provider: true } });
  if (!line) return res.status(404).json({ error: "Línea no encontrada" });
  const r = await rotateProxy(id);
  if (r.ok) {
    const inst = line.sessionId ?? `line_${id}`;
    await applyLineProxy(inst, id);
    await getEngine().restartInstance(inst).catch(() => undefined);
  }
  await adminLog(req.userId!, "proxy_rotate", undefined, { lineId: id, ...r });
  return res.json(r);
});

// POST /api/admin/lines/:id/retry — reintenta reconectar (limpia banned, re-asigna si hace falta,
// reinicia y lanza la recuperación con backoff).
adminRouter.post("/lines/:id/retry", async (req, res) => {
  const id = req.params.id;
  const line = await prisma.waLine.findUnique({ where: { id }, select: { id: true, sessionId: true, provider: true, proxyId: true } });
  if (!line) return res.status(404).json({ error: "Línea no encontrada" });
  if (line.provider === "cloud") return res.status(400).json({ error: "No aplica a Cloud API" });
  await prisma.waLine.update({ where: { id }, data: { banned: false } });
  if (!line.proxyId) await assignProxy(id);
  const inst = line.sessionId ?? `line_${id}`;
  await applyLineProxy(inst, id);
  await getEngine().restartInstance(inst).catch(() => undefined);
  enqueueProxyRecover(id);
  await adminLog(req.userId!, "proxy_retry", undefined, { lineId: id });
  return res.json({ ok: true });
});

export { emitToAdmins };
