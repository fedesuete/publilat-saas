// Analytics: overview de ROAS (etapas, campaña, fuente) + métricas por tiempo y serie.
// Calcula sobre los contactos del usuario; amount está en centavos.
import { Router } from "express";
import { prisma } from "../lib/prisma.js";

export const analyticsRouter = Router();

type Stage = "NUEVO" | "CONTACTADO" | "INTERESADO" | "COMPRO" | "PERDIDO";

interface Bucket {
  key: string;
  leads: number;
  contactados: number;
  compras: number;
  revenue: number; // centavos
}
const emptyBucket = (key: string): Bucket => ({ key, leads: 0, contactados: 0, compras: 0, revenue: 0 });

interface ContactRow {
  stage: Stage;
  amount: number | null;
  campaignId: string | null;
  source: string | null;
  createdAt: Date;
  purchasedAt: Date | null;
}

// Métricas de una ventana temporal [since, now].
function windowMetrics(contacts: ContactRow[], since: Date) {
  let clicks = 0, chats = 0, sales = 0, revenue = 0;
  for (const c of contacts) {
    if (c.createdAt >= since) {
      clicks += 1; // todo contacto se crea en /go
      if (c.stage !== "NUEVO") chats += 1; // llegó a chatear
    }
    if (c.stage === "COMPRO" && c.purchasedAt && c.purchasedAt >= since) {
      sales += 1;
      revenue += c.amount ?? 0;
    }
  }
  return {
    clicks,
    chats,
    sales,
    revenue, // centavos
    conversion: clicks ? sales / clicks : 0,
    clickToChat: clicks ? chats / clicks : 0,
  };
}

// GET /api/analytics/overview — totales, ventanas (hoy/semana/mes), líneas activas y desglose.
analyticsRouter.get("/overview", async (req, res) => {
  const userId = req.userId!;
  const contacts = (await prisma.contact.findMany({
    where: { userId },
    select: { stage: true, amount: true, campaignId: true, source: true, createdAt: true, purchasedAt: true },
  })) as ContactRow[];

  const totals = { leads: contacts.length, nuevo: 0, contactado: 0, interesado: 0, compro: 0, perdido: 0, revenue: 0, conversionRate: 0 };
  const byCampaign = new Map<string, Bucket>();
  const bySource = new Map<string, Bucket>();
  const bump = (map: Map<string, Bucket>, key: string, c: ContactRow) => {
    const b = map.get(key) ?? emptyBucket(key);
    b.leads += 1;
    if (c.stage === "CONTACTADO") b.contactados += 1;
    if (c.stage === "COMPRO") { b.compras += 1; b.revenue += c.amount ?? 0; }
    map.set(key, b);
  };

  for (const c of contacts) {
    if (c.stage === "NUEVO") totals.nuevo += 1;
    else if (c.stage === "CONTACTADO") totals.contactado += 1;
    else if (c.stage === "INTERESADO") totals.interesado += 1;
    else if (c.stage === "COMPRO") { totals.compro += 1; totals.revenue += c.amount ?? 0; }
    else if (c.stage === "PERDIDO") totals.perdido += 1;
    bump(byCampaign, c.campaignId ?? "(sin campaña)", c);
    bump(bySource, c.source ?? "(sin fuente)", c);
  }
  totals.conversionRate = totals.leads ? totals.compro / totals.leads : 0;

  // Ventanas de tiempo.
  const now = new Date();
  const startToday = new Date(now); startToday.setHours(0, 0, 0, 0);
  const startWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const startMonth = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const windows = {
    today: windowMetrics(contacts, startToday),
    week: windowMetrics(contacts, startWeek),
    month: windowMetrics(contacts, startMonth),
  };

  // Líneas activas en rotación ahora.
  const activeLines = await prisma.waLine.count({
    where: { userId, connected: true, status: "active", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
  });

  const sortByRevenue = (a: Bucket, b: Bucket) => b.revenue - a.revenue || b.leads - a.leads;
  return res.json({
    totals,
    windows,
    activeLines,
    byCampaign: [...byCampaign.values()].sort(sortByRevenue),
    bySource: [...bySource.values()].sort(sortByRevenue),
  });
});

// GET /api/analytics/timeseries?days=30 — leads (contactos creados) por día.
analyticsRouter.get("/timeseries", async (req, res) => {
  const userId = req.userId!;
  const days = Math.min(Math.max(parseInt(String(req.query.days ?? "30"), 10) || 30, 1), 90);
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - (days - 1));

  const contacts = await prisma.contact.findMany({
    where: { userId, createdAt: { gte: since } },
    select: { createdAt: true },
  });

  // Inicializa todos los días en 0 para que la serie sea continua.
  const fmt = (d: Date) => d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const counts = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const d = new Date(since.getTime() + i * 24 * 60 * 60 * 1000);
    counts.set(fmt(d), 0);
  }
  for (const c of contacts) {
    const key = fmt(c.createdAt);
    if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const series = [...counts.entries()].map(([date, leads]) => ({ date, leads }));
  return res.json({ days, series });
});

// GET /api/analytics/heatmap?days=30&tz=America/Asuncion — a qué DÍAS y HORAS llegan
// los mensajes entrantes. Devuelve una matriz 7x24 (día de semana x hora) + totales.
analyticsRouter.get("/heatmap", async (req, res) => {
  const userId = req.userId!;
  const days = Math.min(Math.max(parseInt(String(req.query.days ?? "30"), 10) || 30, 1), 90);
  // Zona horaria del operador (la manda el frontend); si es inválida, UTC.
  let tz = typeof req.query.tz === "string" ? req.query.tz : "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    tz = "UTC";
  }
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const msgs = await prisma.message.findMany({
    where: { direction: "in", createdAt: { gte: since }, contact: { userId } },
    select: { createdAt: true },
  });

  const matrix: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0)); // [dow][hour]
  const byHour = Array(24).fill(0);
  const byDow = Array(7).fill(0);
  for (const m of msgs) {
    // Convertimos a la hora local del operador para bucketizar bien.
    const local = new Date(m.createdAt.toLocaleString("en-US", { timeZone: tz }));
    const dow = local.getDay(); // 0=Domingo
    const hour = local.getHours();
    if (dow >= 0 && dow < 7 && hour >= 0 && hour < 24) {
      matrix[dow][hour]++;
      byHour[hour]++;
      byDow[dow]++;
    }
  }

  return res.json({ days, tz, total: msgs.length, matrix, byHour, byDow });
});
