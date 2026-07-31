// Motor del POOL de proxies (anti-ban de líneas Baileys). GESTIÓN 100% ADMIN, oculto al cliente.
// - Asignación least-loaded: el proxy active+healthy con MENOS líneas (respeta maxLines por proxy).
// - Sesión sticky ÚNICA por línea → una IP fija por línea (DataImpulse: sessid en el username).
// - rotateProxy: nueva sesión (nueva IP), mismo proxy o re-asigna otro si el actual no sirve.
// - releaseProxy: libera el cupo (al banear un número).
// Best-effort: los errores se tragan, NUNCA frenan la conexión de una línea. Cloud API NO usa proxy.
import crypto from "node:crypto";
import type { Proxy } from "@prisma/client";
import { prisma } from "./prisma.js";
import { decryptSecret } from "./crypto.js";
import { parseProxyUrl, type ProxyConfig } from "./evolution.js";
import { getEngine } from "./wa-engine.js";
import { ensureLocalProxy } from "./proxy-local.js";
import { notify } from "./notifications.js";
import { emitToUser } from "./io.js";

// Sesión sticky nueva. Cualquier string sirve para el `sessid` de DataImpulse; cambiarla = nueva IP.
function newSession(): string {
  return crypto.randomBytes(6).toString("hex");
}

// Arma el ProxyConfig para el motor (Evolution/WAHA), con el username sticky del proveedor.
// DataImpulse: LOGIN__cr.<país>;sessid.<sesión>;sesstime.<min> → misma IP mientras dure la sesión.
export function buildProxyConfig(proxy: Proxy, session: string | null): ProxyConfig {
  let username = proxy.username;
  const sess = session ?? "";
  if (proxy.provider === "dataimpulse") {
    if (proxy.country) username += `__cr.${proxy.country.toLowerCase()}`;
    if (proxy.sticky && sess) username += `;sessid.${sess};sesstime.${proxy.sessTime}`;
  } else if (proxy.sticky && sess) {
    // Genérico: la mayoría de los proveedores usan un sufijo de sesión en el usuario.
    username += `-session-${sess}`;
  }
  return {
    host: proxy.host,
    port: String(proxy.port),
    protocol: proxy.protocol,
    username,
    password: decryptSecret(proxy.password),
  };
}

// ProxyConfig VIGENTE de una línea (para conectarla por su proxy), o null si no tiene / es Cloud.
// Lo usa el wiring al motor (Fase 3). NUNCA se expone a un endpoint del cliente.
export async function resolveLineProxy(lineId: string): Promise<ProxyConfig | null> {
  const line = await prisma.waLine.findUnique({
    where: { id: lineId },
    select: { proxyId: true, proxySession: true, provider: true },
  });
  if (!line || line.provider === "cloud" || !line.proxyId) return null;
  const proxy = await prisma.proxy.findUnique({ where: { id: line.proxyId } });
  if (!proxy || !proxy.active) return null;
  try {
    return buildProxyConfig(proxy, line.proxySession);
  } catch {
    return null; // clave indescifrable: mejor conectar sin proxy que trabar la línea
  }
}

// Auditoría (best-effort).
export async function logProxyEvent(
  lineId: string,
  proxyId: string | null | undefined,
  type: string,
  detail?: string,
): Promise<void> {
  await prisma.proxyEvent
    .create({ data: { lineId, proxyId: proxyId ?? null, type, ...(detail ? { detail } : {}) } })
    .catch(() => undefined);
}

// Aviso en vivo a TODOS los admins (campana + socket).
export async function alertAdminProxy(
  title: string,
  body: string,
  kind: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
  for (const a of admins) {
    void notify(a.id, "system", title, body).catch(() => undefined);
    emitToUser(a.id, "admin:proxy", { kind, ...payload });
  }
}

// Asigna a la línea el proxy active+healthy con MENOS líneas (least-loaded, respeta maxLines) y le
// genera su sesión sticky única. Si el pool está lleno, avisa al admin y devuelve pool_full.
export async function assignProxy(lineId: string, excludeProxyId?: string): Promise<{ ok: boolean; proxyId?: string; reason?: string }> {
  const line = await prisma.waLine.findUnique({ where: { id: lineId }, select: { id: true, provider: true, label: true } });
  if (!line) return { ok: false, reason: "line_not_found" };
  if (line.provider === "cloud") return { ok: false, reason: "cloud_no_proxy" };

  const proxies = await prisma.proxy.findMany({
    where: { active: true, healthy: true, ...(excludeProxyId ? { id: { not: excludeProxyId } } : {}) },
    select: { id: true, maxLines: true, _count: { select: { lines: true } } },
  });
  const withCap = proxies
    .filter((p) => p._count.lines < p.maxLines)
    .sort((a, b) => a._count.lines - b._count.lines);
  if (withCap.length === 0) {
    await alertAdminProxy(
      "Pool de proxies lleno",
      `No hay proxy con cupo para asignar a la línea ${line.label ?? lineId}. Sumá proxies al pool.`,
      "pool_full",
      { lineId },
    );
    await logProxyEvent(lineId, null, "proxy_unhealthy", "pool_full: sin cupo en el pool");
    return { ok: false, reason: "pool_full" };
  }
  const chosen = withCap[0];
  const session = newSession();
  await prisma.waLine.update({
    where: { id: lineId },
    data: { proxyId: chosen.id, proxySession: session, proxyAssignedAt: new Date() },
  });
  await logProxyEvent(lineId, chosen.id, "assigned", `sessid=${session}`);
  return { ok: true, proxyId: chosen.id };
}

// Rota la IP de una línea: nueva sesión sticky. Si el proxy actual está inactive/unhealthy o sin cupo,
// re-asigna otro del pool. Registra "rotated".
export async function rotateProxy(lineId: string): Promise<{ ok: boolean; proxyId?: string; reason?: string }> {
  const line = await prisma.waLine.findUnique({ where: { id: lineId }, select: { id: true, provider: true, proxyId: true } });
  if (!line) return { ok: false, reason: "line_not_found" };
  if (line.provider === "cloud") return { ok: false, reason: "cloud_no_proxy" };

  let keepProxyId = line.proxyId;
  let curSticky = false;
  if (keepProxyId) {
    const cur = await prisma.proxy.findUnique({
      where: { id: keepProxyId },
      select: { active: true, healthy: true, sticky: true, maxLines: true, _count: { select: { lines: true } } },
    });
    curSticky = cur?.sticky ?? false;
    // El actual sirve si está activo, sano y con cupo (se cuenta a sí mismo → usamos >).
    if (!cur || !cur.active || !cur.healthy || cur._count.lines > cur.maxLines) keepProxyId = null;
  }
  // Proxy de IP FIJA por entrada (sticky=false, ej. Webshare: la IP está en el username): rotar la
  // "sesión" no cambia la IP → hay que MOVER la línea a OTRA entrada del pool (otra IP).
  if (keepProxyId && !curSticky) {
    const r = await assignProxy(lineId, keepProxyId); // excluye el proxy actual
    if (r.ok) { await logProxyEvent(lineId, r.proxyId, "rotated", "movido a otra IP (proxy de IP fija)"); return r; }
    return { ok: true, proxyId: keepProxyId }; // no hay otro con cupo: se queda con el actual
  }
  if (!keepProxyId) {
    const r = await assignProxy(lineId);
    if (r.ok) await logProxyEvent(lineId, r.proxyId, "rotated", "re-asignado a proxy sano");
    return r;
  }
  // Proxy sticky (DataImpulse): nueva sesión = nueva IP de la misma cuenta.
  const session = newSession();
  await prisma.waLine.update({ where: { id: lineId }, data: { proxySession: session, lastProxyRotateAt: new Date() } });
  await logProxyEvent(lineId, keepProxyId, "rotated", `sessid=${session} (nueva IP)`);
  return { ok: true, proxyId: keepProxyId };
}

// Aplica el proxy de una línea a su instancia del motor (Evolution/WAHA) ANTES de conectar.
// Prioridad: proxy del POOL gestionado > proxyUrl manual (compat) > sin proxy (conecta como hoy).
// Cloud API: nunca (resolveLineProxy devuelve null). Best-effort: si falla, la línea conecta SIN
// proxy en vez de trabarse. Se llama al crear/conectar/reiniciar la instancia y tras rotar.
// Adapta un ProxyConfig al motor antes de aplicarlo. WAHA/Chromium NO autentica proxies con
// usuario/clave (ERR_TUNNEL) → lo envolvemos en un proxy LOCAL sin auth (proxy-local.ts) que le
// agrega la auth y reenvía al upstream. Evolution/Baileys SÍ autentica (como curl) → va directo.
// Proxy sin credenciales (ej. IP whitelist) → directo en cualquier motor.
async function toEngineProxy(p: ProxyConfig): Promise<ProxyConfig | null> {
  if (getEngine().name !== "waha" || !p.username) return p;
  const scheme = p.protocol === "https" ? "https" : p.protocol === "socks5" ? "socks5" : p.protocol === "socks4" ? "socks4" : "http";
  const upstream = `${scheme}://${encodeURIComponent(p.username)}:${encodeURIComponent(p.password ?? "")}@${p.host}:${p.port}`;
  const local = await ensureLocalProxy(upstream);
  if (!local) return null; // no se pudo levantar el local: mejor conectar SIN proxy que trabar la línea
  return { host: local.host, port: String(local.port), protocol: "http" }; // local, SIN auth
}

export async function applyLineProxy(instanceName: string, lineId: string): Promise<void> {
  try {
    const managed = await resolveLineProxy(lineId);
    if (managed) {
      const cfg = await toEngineProxy(managed);
      if (cfg) await getEngine().setProxy(instanceName, cfg);
      return;
    }
    // Compat: proxy manual viejo (proxyUrl cifrado en la línea).
    const line = await prisma.waLine.findUnique({ where: { id: lineId }, select: { proxyUrl: true, provider: true } });
    if (line && line.provider !== "cloud" && line.proxyUrl) {
      const p = parseProxyUrl(decryptSecret(line.proxyUrl));
      if (p) {
        const cfg = await toEngineProxy(p);
        if (cfg) await getEngine().setProxy(instanceName, cfg);
      }
    }
  } catch (e) {
    console.warn("[proxy] applyLineProxy falló (conecta sin proxy):", e instanceof Error ? e.message : String(e));
  }
}

// Libera el proxy de una línea (al banear el número): el cupo queda para otra línea.
export async function releaseProxy(lineId: string): Promise<void> {
  const line = await prisma.waLine.findUnique({ where: { id: lineId }, select: { proxyId: true } });
  await prisma.waLine.update({ where: { id: lineId }, data: { proxyId: null, proxySession: null } }).catch(() => undefined);
  if (line?.proxyId) await logProxyEvent(lineId, line.proxyId, "line_down", "cupo de proxy liberado (número baneado)");
}
