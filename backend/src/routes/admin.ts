// Panel maestro (super-admin). Todas las rutas van bajo requireAuth + requireAdmin.
// Vista global por encima de todas las cuentas (multi-tenant). Acciones auditadas en AdminLog.
// No expone secretos (CAPI token, access token) ni el contenido de Inbox de los clientes.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { emitToUser } from "../lib/io.js";

export const adminRouter = Router();

// ---- helpers ----
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

// Detalle de una cuenta.
adminRouter.get("/clients/:id", async (req, res) => {
  const id = req.params.id;
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, name: true, phone: true, slug: true, role: true, suspended: true, isDemo: true, demoExpiresAt: true, source: true, lastLoginAt: true, createdAt: true },
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
  await prisma.user.update({ where: { id: userId }, data: { suspended: parsed.data.suspended } });
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
    select: { id: true, label: true, phone: true, provider: true, status: true, connected: true, expiresAt: true, lastUsedAt: true, user: { select: { email: true, name: true } } },
  });
  return res.json({ lines });
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

export { emitToAdmins };
