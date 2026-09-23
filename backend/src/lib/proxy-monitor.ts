// Monitor de estabilidad IPRoyal (Fase 4). El job corre cada 5 min, pero cada SONDEO POR EL PROXY
// gasta tráfico del plan de IPRoyal (~300 KB con reintentos) — y eso, a 288 sondeos/día por línea,
// fue lo que AGOTÓ la cuenta el 2026-09-23 (2.075 sondeos/24h, la mayoría contra sesiones muertas,
// ≈0,6 GB/día; el WhatsApp real consume ~0,08 GB/semana). Regla nueva:
//   · Sólo líneas EN SERVICIO (status active + día pagado + proxy IPRoyal).
//   · El estado de la sesión sale GRATIS de la API local de WAHA (sin pasar por el proxy).
//   · El probe de IP por el proxy: a lo sumo 1 vez/hora por línea, o ANTES si hubo flaps (ahí es
//     cuando importa medir). Sesión muerta = NUNCA se sondea por proxy.
// Aislado y best-effort: nunca frena nada ni toca otras líneas.
import { prisma } from "./prisma.js";
import { getEngine } from "./wa-engine.js";
import { probeLineExitIp, IPROYAL_PROVIDER } from "./proxy-pool.js";
import { takeMonitorFlaps, peekMonitorFlaps } from "./proxy-flap.js";
import { lineRawStatus, lineRestrictedUntil } from "./line-alert.js";

// Cadencia máxima de samples (y de probes por proxy) por línea. 55 min ≈ 1/h con margen del job de 5 min.
const SAMPLE_EVERY_MS = Number(process.env.PROXY_MONITOR_SAMPLE_MIN ?? "55") * 60_000;

export async function sampleProxyHealth(): Promise<void> {
  const now = Date.now();
  const lines = await prisma.waLine
    .findMany({
      // `status: "active"` (2026-09-23): había líneas con día pagado pero FUERA de servicio reteniendo
      // el proxy y sondeándose cada 5 min con probe_fail — puro gasto.
      where: {
        status: "active",
        provider: { not: "cloud" },
        proxy: { is: { provider: IPROYAL_PROVIDER } },
        expiresAt: { gt: new Date() },
      },
      select: { id: true, proxyId: true, sessionId: true },
    })
    .catch(() => [] as { id: string; proxyId: string | null; sessionId: string | null }[]);
  if (lines.length === 0) return;

  for (const line of lines) {
    try {
      const last = await prisma.proxyHealthSample.findFirst({
        where: { lineId: line.id },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      const due = !last || now - last.createdAt.getTime() >= SAMPLE_EVERY_MS;
      const flapping = peekMonitorFlaps(line.id) > 0; // hubo caídas desde el último sample → medir YA
      if (!due && !flapping) continue; // nada que hacer: los flaps se acumulan hasta el próximo sample

      const inst = line.sessionId ?? `line_${line.id}`;
      // Estado de la sesión: GRATIS (WAHA local, no pasa por el proxy).
      const [rawStatus, connState, restrictedUntil] = await Promise.all([
        lineRawStatus(inst).catch(() => null),
        getEngine().connectionState(inst).catch(() => "unknown"),
        lineRestrictedUntil(inst).catch(() => null),
      ]);
      const alive = rawStatus === "WORKING" || connState === "open";

      // Probe de la IP de salida: va POR EL PROXY (gasta plan) → sólo con la sesión viva.
      const probe: { ok: boolean; ip?: string; country?: string } = alive
        ? await probeLineExitIp(line.id)
        : { ok: false };
      const ip = probe.ok ? probe.ip ?? null : null;
      // "Cambió la IP" se compara contra el último sample QUE TUVO IP (los intermedios sin probe no cuentan).
      const prevWithIp = ip
        ? await prisma.proxyHealthSample.findFirst({
            where: { lineId: line.id, ip: { not: null } },
            orderBy: { createdAt: "desc" },
            select: { ip: true },
          })
        : null;
      const ipChanged = Boolean(ip && prevWithIp?.ip && ip !== prevWithIp.ip);
      const sessionState = rawStatus ?? connState ?? "unknown";
      const errorCode = restrictedUntil
        ? "515_restricted"
        : !alive
          ? "disconnected"
          : !probe.ok
            ? "probe_fail"
            : "none";
      const flaps = takeMonitorFlaps(line.id);
      await prisma.proxyHealthSample.create({
        data: { lineId: line.id, proxyId: line.proxyId, ip, country: probe.ok ? probe.country ?? null : null, ipChanged, sessionState, errorCode, flaps },
      });
    } catch (e) {
      console.warn("[proxy-monitor] sample falló", line.id, e instanceof Error ? e.message : String(e));
    }
  }
}
