// Analytics (Fase 3): overview de ROAS por campaña y fuente.
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

function emptyBucket(key: string): Bucket {
  return { key, leads: 0, contactados: 0, compras: 0, revenue: 0 };
}

// GET /api/analytics/overview — totales + desglose por campaña y fuente.
analyticsRouter.get("/overview", async (req, res) => {
  const userId = req.userId!;
  const contacts = await prisma.contact.findMany({
    where: { userId },
    select: { stage: true, amount: true, campaignId: true, source: true },
  });

  const totals = {
    leads: contacts.length,
    nuevo: 0,
    contactado: 0,
    interesado: 0,
    compro: 0,
    perdido: 0,
    revenue: 0, // centavos
    conversionRate: 0, // compras / leads
  };

  const byCampaign = new Map<string, Bucket>();
  const bySource = new Map<string, Bucket>();
  const bump = (map: Map<string, Bucket>, key: string, c: { stage: Stage; amount: number | null }) => {
    const b = map.get(key) ?? emptyBucket(key);
    b.leads += 1;
    if (c.stage === "CONTACTADO") b.contactados += 1;
    if (c.stage === "COMPRO") {
      b.compras += 1;
      b.revenue += c.amount ?? 0;
    }
    map.set(key, b);
  };

  for (const c of contacts) {
    const stage = c.stage as Stage;
    if (stage === "NUEVO") totals.nuevo += 1;
    else if (stage === "CONTACTADO") totals.contactado += 1;
    else if (stage === "INTERESADO") totals.interesado += 1;
    else if (stage === "COMPRO") {
      totals.compro += 1;
      totals.revenue += c.amount ?? 0;
    } else if (stage === "PERDIDO") totals.perdido += 1;

    bump(byCampaign, c.campaignId ?? "(sin campaña)", { stage, amount: c.amount });
    bump(bySource, c.source ?? "(sin fuente)", { stage, amount: c.amount });
  }

  totals.conversionRate = totals.leads ? totals.compro / totals.leads : 0;

  const sortByRevenue = (a: Bucket, b: Bucket) => b.revenue - a.revenue || b.leads - a.leads;
  return res.json({
    totals,
    byCampaign: [...byCampaign.values()].sort(sortByRevenue),
    bySource: [...bySource.values()].sort(sortByRevenue),
  });
});
