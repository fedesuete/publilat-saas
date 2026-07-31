// Motor del POOL de proxies (anti-ban de líneas Baileys). GESTIÓN 100% ADMIN, oculto al cliente.
// - Asignación least-loaded: el proxy active+healthy con MENOS líneas (respeta maxLines por proxy).
// - Sesión sticky ÚNICA por línea → una IP fija por línea (DataImpulse: sessid en el username).
// - rotateProxy: nueva sesión (nueva IP), mismo proxy o re-asigna otro si el actual no sirve.
// - releaseProxy: libera el cupo (al banear un número).
// Best-effort: los errores se tragan, NUNCA frenan la conexión de una línea. Cloud API NO usa proxy.
import crypto from "node:crypto";
import http from "node:http";
import tls from "node:tls";
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
// DataImpulse (confirmado en docs.dataimpulse.com): LOGIN__cr.<país>;sessid.<sesión> en el puerto
// 823 → la MISMA IP ~30 min por sesión. Separador ';'. OJO: NO existe 'sesstime' (la duración es
// fija; mandarlo rompe la auth). Una sesión ÚNICA por línea ⇒ una IP única por línea.
export function buildProxyConfig(proxy: Proxy, session: string | null): ProxyConfig {
  let username = proxy.username;
  const sess = session ?? "";
  if (proxy.provider === "dataimpulse") {
    if (proxy.country) username += `__cr.${proxy.country.toLowerCase()}`;
    if (proxy.sticky && sess) username += `;sessid.${sess}`;
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

// ¿Auto-asignar proxy a las líneas NUEVAS? (Fase 3). Flag env, apagado por default: con el flag OFF
// el flujo de creación de líneas es idéntico al de siempre (no se asigna proxy).
export function autoAssignEnabled(): boolean {
  return ["on", "1", "true", "yes"].includes((process.env.AUTO_ASSIGN_PROXY ?? "").trim().toLowerCase());
}
// Proveedor PRIMARIO preferido para el auto-asignar (el resto queda como contingencia). Env, default webshare.
export function primaryProvider(): string {
  return (process.env.PROXY_PRIMARY_PROVIDER ?? "webshare").trim().toLowerCase();
}

export interface AssignOpts { excludeProxyId?: string; provider?: string; excludeProvider?: string }

// Asigna a la línea el proxy active+healthy con MENOS líneas (least-loaded, respeta maxLines) y le
// genera su sesión sticky única. Filtros opcionales: excluir un proxy, exigir/excluir un proveedor
// (para la jerarquía de fallback: mismo proveedor → contingencia). Si no hay cupo, avisa y da pool_full.
export async function assignProxy(lineId: string, opts: AssignOpts = {}): Promise<{ ok: boolean; proxyId?: string; reason?: string }> {
  const line = await prisma.waLine.findUnique({ where: { id: lineId }, select: { id: true, provider: true, label: true } });
  if (!line) return { ok: false, reason: "line_not_found" };
  if (line.provider === "cloud") return { ok: false, reason: "cloud_no_proxy" };

  const proxies = await prisma.proxy.findMany({
    where: {
      active: true,
      healthy: true,
      ...(opts.excludeProxyId ? { id: { not: opts.excludeProxyId } } : {}),
      ...(opts.provider ? { provider: opts.provider } : {}),
      ...(opts.excludeProvider ? { provider: { not: opts.excludeProvider } } : {}),
    },
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

// Auto-asigna prefiriendo el proveedor PRIMARIO (Webshare); si no hay cupo sano ahí, cae a cualquier
// sano (contingencia, ej. DataImpulse). Para el alta de líneas nuevas (Fase 3).
export async function assignProxyPreferred(lineId: string): Promise<{ ok: boolean; proxyId?: string; reason?: string }> {
  const primary = await assignProxy(lineId, { provider: primaryProvider() });
  if (primary.ok) return primary;
  return assignProxy(lineId); // cualquier sano (otro proveedor)
}

// Fallback JERÁRQUICO (watchdog, Fase 4): 1) otra IP del MISMO proveedor, 2) proveedor de CONTINGENCIA
// (distinto), 3) cualquier sano excluyendo el actual. NUNCA cae a "sin proxy" (eso lo decide el caller
// como waiting_proxy). Devuelve ok:false solo si no hay NINGÚN proxy sano con cupo.
export async function assignFallback(lineId: string, curProxyId: string | null): Promise<{ ok: boolean; proxyId?: string; reason?: string }> {
  let curProvider: string | undefined;
  if (curProxyId) {
    const cur = await prisma.proxy.findUnique({ where: { id: curProxyId }, select: { provider: true } });
    curProvider = cur?.provider ?? undefined;
  }
  if (curProvider) {
    const same = await assignProxy(lineId, { excludeProxyId: curProxyId ?? undefined, provider: curProvider });
    if (same.ok) return same;
    const other = await assignProxy(lineId, { excludeProvider: curProvider });
    if (other.ok) return other;
  }
  return assignProxy(lineId, { excludeProxyId: curProxyId ?? undefined });
}

// Marca una línea "esperando proxy": sin proxy sano NO conecta (NUNCA por la IP del VPS). Libera el
// proxy actual y avisa al admin. Un job (queue.ts) la conecta cuando el pool se recupere.
export async function setLineWaitingProxy(lineId: string, reason: string): Promise<void> {
  await prisma.waLine.update({ where: { id: lineId }, data: { proxyWait: true, proxyId: null, proxySession: null } }).catch(() => undefined);
  await logProxyEvent(lineId, null, "proxy_unhealthy", `waiting_proxy: ${reason}`);
  const line = await prisma.waLine.findUnique({ where: { id: lineId }, select: { label: true, phone: true } });
  await alertAdminProxy(
    "Línea esperando proxy",
    `La línea "${line?.label ?? line?.phone ?? lineId}" no tiene proxy sano; NO se conectó por la IP del VPS. Se reconecta sola cuando el pool se recupere.`,
    "waiting_proxy",
    { lineId },
  );
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
    const r = await assignProxy(lineId, { excludeProxyId: keepProxyId }); // excluye el proxy actual
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
// URL del upstream CON auth (scheme://user:pass@host:port) para envolver en el proxy local.
function upstreamUrlFor(p: ProxyConfig): string {
  const scheme = p.protocol === "https" ? "https" : p.protocol === "socks5" ? "socks5" : p.protocol === "socks4" ? "socks4" : "http";
  return `${scheme}://${encodeURIComponent(p.username ?? "")}:${encodeURIComponent(p.password ?? "")}@${p.host}:${p.port}`;
}

// Adapta un ProxyConfig al motor antes de aplicarlo. WAHA/Chromium NO autentica proxies con
// usuario/clave (ERR_TUNNEL) → lo envolvemos en un proxy LOCAL sin auth (proxy-local.ts) que le
// agrega la auth y reenvía al upstream. Evolution/Baileys SÍ autentica (como curl) → va directo.
// Proxy sin credenciales (ej. IP whitelist) → directo en cualquier motor.
async function toEngineProxy(p: ProxyConfig): Promise<ProxyConfig | null> {
  if (getEngine().name !== "waha" || !p.username) return p;
  const local = await ensureLocalProxy(upstreamUrlFor(p));
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

// PRE-WARMING (Fase 1): al bootear, deja un proxy LOCAL escuchando por CADA proxy activo del pool,
// para que asignar uno a una línea sea instantáneo (sin cold-start del túnel). Solo con WAHA
// (Chromium necesita el local sin auth); Evolution/Baileys autentica directo y no lo precisa.
// - Webshare (IP fija en el username): el túnel pre-warmeado es EXACTAMENTE el que usa la línea.
// - DataImpulse (sesión única por línea): esto calienta el endpoint base y valida que el server
//   local levanta; el túnel por-sesión se crea al asignar (arranque de ~ms).
// La VALIDACIÓN real del upstream (CONNECT contra un checker) la hace el health-check (Fase 2).
// Best-effort: nunca frena el arranque ni lanza.
export async function prewarmProxyPool(): Promise<{ warmed: number; failed: number; total: number }> {
  if (getEngine().name !== "waha") return { warmed: 0, failed: 0, total: 0 };
  const proxies = await prisma.proxy.findMany({ where: { active: true } }).catch(() => [] as Proxy[]);
  let warmed = 0;
  let failed = 0;
  for (const proxy of proxies) {
    try {
      if (!proxy.username) continue; // sin credenciales: no necesita proxy local
      const local = await ensureLocalProxy(upstreamUrlFor(buildProxyConfig(proxy, null)));
      if (local) warmed++;
      else failed++;
    } catch {
      failed++;
    }
  }
  if (proxies.length) {
    console.log(`[proxy] pre-warming: ${warmed}/${proxies.length} túneles locales listos${failed ? ` (${failed} fallaron)` : ""}`);
  }
  return { warmed, failed, total: proxies.length };
}

// CONNECT HTTPS a un checker de IP a través de un proxy HTTP local sin auth (host:port). Devuelve la
// IP pública vista (la del proxy residencial) o null si el túnel no sale a internet. Timeout duro.
function connectAndGetIp(host: string, port: number, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v: string | null) => { if (!settled) { settled = true; resolve(v); } };
    const req = http.request({ host, port, method: "CONNECT", path: "api.ipify.org:443", timeout: timeoutMs });
    const timer = setTimeout(() => { try { req.destroy(); } catch { /* noop */ } finish(null); }, timeoutMs);
    req.on("connect", (res, socket) => {
      if (res.statusCode !== 200) { clearTimeout(timer); try { socket.destroy(); } catch { /* noop */ } return finish(null); }
      const t = tls.connect({ socket, servername: "api.ipify.org" }, () => {
        t.write("GET /?format=json HTTP/1.1\r\nHost: api.ipify.org\r\nConnection: close\r\n\r\n");
      });
      let data = "";
      t.on("data", (d) => (data += d.toString()));
      t.on("end", () => { clearTimeout(timer); const body = data.split("\r\n\r\n")[1] ?? ""; const m = body.match(/"ip"\s*:\s*"([^"]+)"/); finish(m ? m[1] : null); });
      t.on("error", () => { clearTimeout(timer); finish(null); });
    });
    req.on("timeout", () => { try { req.destroy(); } catch { /* noop */ } finish(null); });
    req.on("error", () => { clearTimeout(timer); finish(null); });
    req.end();
  });
}

// PRUEBA REAL de un proxy (Fase 2): hace un CONNECT HTTPS a un checker por el MISMO camino que usa
// la línea. Con WAHA (todos nuestros proxies tienen auth) es por el proxy LOCAL sin auth (proxy-chain
// agrega la auth y reenvía) → valida auth + upstream + SALIDA a internet, no solo que el gateway
// responda TCP. Devuelve { ok, ip }. Best-effort: cualquier fallo = { ok:false }.
export async function probeProxy(proxy: Proxy, timeoutMs = 9_000): Promise<{ ok: boolean; ip?: string }> {
  try {
    // Sesión de validación ESTABLE (no random): así el túnel local del probe es único por proxy y se
    // reutiliza en cada chequeo (sin fuga de servers). Valida la cuenta/salida, no la IP de una línea.
    const cfg = buildProxyConfig(proxy, "healthcheck");
    if (!cfg.username) return { ok: false }; // sin auth (IP whitelist): no lo usamos hoy; lo deja unhealthy
    const local = await ensureLocalProxy(upstreamUrlFor(cfg));
    if (!local) return { ok: false };
    const ip = await connectAndGetIp("127.0.0.1", local.port, timeoutMs); // el server local escucha en 0.0.0.0
    return ip ? { ok: true, ip } : { ok: false };
  } catch {
    return { ok: false };
  }
}

// Libera el proxy de una línea (al banear el número): el cupo queda para otra línea.
export async function releaseProxy(lineId: string): Promise<void> {
  const line = await prisma.waLine.findUnique({ where: { id: lineId }, select: { proxyId: true } });
  await prisma.waLine.update({ where: { id: lineId }, data: { proxyId: null, proxySession: null } }).catch(() => undefined);
  if (line?.proxyId) await logProxyEvent(lineId, line.proxyId, "line_down", "cupo de proxy liberado (número baneado)");
}
