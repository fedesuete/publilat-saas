// Reporte de estabilidad IPRoyal (Fase 5). Resume los ProxyHealthSample por línea en una ventana:
// cambios de IP, caídas/reconexiones (flaps), uptime %, IP actual. Lo usa el panel (/admin/proxy-health)
// y el email automático (08:00 ART + a las 24h del test). Sin líneas IPRoyal → no hay nada que reportar.
import { prisma } from "./prisma.js";
import { IPROYAL_PROVIDER } from "./proxy-pool.js";
import { sendMail } from "./mailer.js";

const REPORT_EMAIL = process.env.PROXY_REPORT_EMAIL ?? "federicobogado1997@gmail.com";

export interface ProxyTimelinePoint {
  ts: Date; ip: string | null; state: string | null; err: string | null; ipChanged: boolean; flaps: number;
}
export interface LineHealthSummary {
  lineId: string; label: string | null; phone: string | null;
  currentIp: string | null; currentState: string | null; lastSampleAt: Date | null;
  samples: number; ipChanges: number; flaps: number;
  workingSamples: number; restrictedSamples: number; uptimePct: number;
  timeline?: ProxyTimelinePoint[];
}

export async function buildProxyHealthSummary(windowHours = 24, withTimeline = false): Promise<LineHealthSummary[]> {
  const since = new Date(Date.now() - windowHours * 3600_000);
  const lines = await prisma.waLine.findMany({
    where: { provider: { not: "cloud" }, proxy: { is: { provider: IPROYAL_PROVIDER } } },
    select: { id: true, label: true, phone: true },
  });
  const out: LineHealthSummary[] = [];
  for (const line of lines) {
    const samples = await prisma.proxyHealthSample.findMany({
      where: { lineId: line.id, createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
      select: { ip: true, sessionState: true, errorCode: true, ipChanged: true, flaps: true, createdAt: true },
    });
    const total = samples.length;
    const working = samples.filter((s) => s.sessionState === "WORKING" || s.sessionState === "open").length;
    const restricted = samples.filter((s) => s.errorCode === "515_restricted").length;
    const ipChanges = samples.filter((s) => s.ipChanged).length;
    const flaps = samples.reduce((a, s) => a + (s.flaps ?? 0), 0);
    const last = samples[total - 1];
    out.push({
      lineId: line.id, label: line.label, phone: line.phone,
      currentIp: last?.ip ?? null, currentState: last?.sessionState ?? null, lastSampleAt: last?.createdAt ?? null,
      samples: total, ipChanges, flaps,
      workingSamples: working, restrictedSamples: restricted,
      uptimePct: total ? Math.round((working / total) * 1000) / 10 : 0,
      ...(withTimeline
        ? { timeline: samples.map((s) => ({ ts: s.createdAt, ip: s.ip, state: s.sessionState, err: s.errorCode, ipChanged: s.ipChanged, flaps: s.flaps })) }
        : {}),
    });
  }
  return out;
}

// Envía el reporte por email (no-op si no hay SMTP o no hay líneas IPRoyal). Best-effort.
export async function sendProxyHealthReport(windowHours = 24, tag = ""): Promise<boolean> {
  const rows = await buildProxyHealthSummary(windowHours, false);
  if (rows.length === 0) return false; // sin líneas de prueba, no hay test que reportar
  const body = rows
    .map((r) => {
      const name = r.label || r.phone || r.lineId;
      return (
        `• ${name}\n` +
        `    IP actual: ${r.currentIp ?? "—"} (${r.currentState ?? "?"})\n` +
        `    Cambios de IP: ${r.ipChanges} | Caídas/reconexiones: ${r.flaps} | Uptime: ${r.uptimePct}%` +
        (r.restrictedSamples ? ` | Restringida en ${r.restrictedSamples} muestras` : "") +
        `\n    Muestras (cada 5 min): ${r.samples}`
      );
    })
    .join("\n\n");
  const subject = `📡 Reporte proxies IPRoyal (${windowHours}h)${tag ? ` — ${tag}` : ""}`;
  const text =
    `Test IPRoyal residencial AR (sticky 7d) — últimas ${windowHours}h\n\n${body}\n\n` +
    `Cuantos menos "Cambios de IP" y "Caídas", mejor: IPRoyal sticky debería mantener la MISMA IP AR.\n` +
    `Detalle + timeline por línea en el panel: /admin/proxy-health\n`;
  return sendMail(REPORT_EMAIL, subject, text);
}
