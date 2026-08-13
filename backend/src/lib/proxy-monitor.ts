// Monitor de estabilidad IPRoyal (Fase 4). Cada 5 min, por cada línea de PRUEBA (proxy IPRoyal): sondea
// la IP de salida por su proxy + estado de la sesión + errores + flaps desde el sample anterior, y guarda
// un ProxyHealthSample. Con eso se mide en 24h cuántas veces cambia/cae la IP por línea. Aislado (solo
// mira líneas IPRoyal) y best-effort: nunca frena nada ni toca otras líneas.
import { prisma } from "./prisma.js";
import { getEngine } from "./wa-engine.js";
import { probeLineExitIp, IPROYAL_PROVIDER } from "./proxy-pool.js";
import { takeMonitorFlaps } from "./proxy-flap.js";
import { lineRawStatus, lineRestrictedUntil } from "./line-alert.js";

export async function sampleProxyHealth(): Promise<void> {
  // Solo las líneas de prueba: proxy IPRoyal, no cloud. (Si no hay ninguna, no hace nada.)
  const lines = await prisma.waLine
    .findMany({
      where: { provider: { not: "cloud" }, proxy: { is: { provider: IPROYAL_PROVIDER } } },
      select: { id: true, proxyId: true, sessionId: true },
    })
    .catch(() => [] as { id: string; proxyId: string | null; sessionId: string | null }[]);
  if (lines.length === 0) return;

  for (const line of lines) {
    try {
      const inst = line.sessionId ?? `line_${line.id}`;
      const [probe, rawStatus, connState, restrictedUntil, prev] = await Promise.all([
        probeLineExitIp(line.id),
        lineRawStatus(inst).catch(() => null),
        getEngine().connectionState(inst).catch(() => "unknown"),
        lineRestrictedUntil(inst).catch(() => null),
        prisma.proxyHealthSample.findFirst({ where: { lineId: line.id }, orderBy: { createdAt: "desc" }, select: { ip: true } }),
      ]);
      const ip = probe.ok ? probe.ip ?? null : null;
      const ipChanged = Boolean(ip && prev?.ip && ip !== prev.ip);
      const sessionState = rawStatus ?? connState ?? "unknown";
      const errorCode = restrictedUntil
        ? "515_restricted"
        : !probe.ok
          ? "probe_fail"
          : connState !== "open" && rawStatus !== "WORKING"
            ? "disconnected"
            : "none";
      const flaps = takeMonitorFlaps(line.id);
      await prisma.proxyHealthSample.create({
        data: { lineId: line.id, proxyId: line.proxyId, ip, country: probe.country ?? null, ipChanged, sessionState, errorCode, flaps },
      });
    } catch (e) {
      console.warn("[proxy-monitor] sample falló", line.id, e instanceof Error ? e.message : String(e));
    }
  }
}
