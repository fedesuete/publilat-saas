// Colas/jobs con BullMQ + Redis. Dos jobs repetibles:
//  - line-expiry: desactiva líneas vencidas (status -> inactive).
//  - capi-retry: reintenta los MetaEvent fallidos (reenvía el evento a Meta).
import net from "node:net";
import { Queue, Worker, type Job } from "bullmq";
import { prisma } from "./prisma.js";
import { emitToUser } from "./io.js";
import { sendCapiEvent } from "./meta-capi.js";
import { resolveUserPixel } from "./pixel.js";
import { consumeDayAndActivate, consumeChatDayAndActivate } from "./access.js";
import { notifyMissingPixel } from "./capi-guard.js";
import { getEngine } from "./wa-engine.js";
import { listSessions as wahaListSessions } from "./waha.js"; // limpieza de sesiones WAHA huérfanas (RAM)
import { getPhoneQuality } from "./wa-cloud.js";
import { decryptSecret } from "./crypto.js";
import { notify } from "./notifications.js";
import { sendAdminMail } from "./mailer.js";
import { checkWaWebVersion } from "./wa-version.js";
import { alertLineDown, alertLowBalance } from "./line-alert.js";
import { alertCapiFailures } from "./capi-guard.js";
import { rotateProxy, releaseProxy, applyLineProxy, logProxyEvent, alertAdminProxy, probeProxy, assignFallback, assignProxyPreferred, setLineWaitingProxy } from "./proxy-pool.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const parsed = new URL(REDIS_URL);
const connection = {
  host: parsed.hostname,
  port: Number(parsed.port || 6379),
  ...(parsed.password ? { password: parsed.password } : {}),
};

const QUEUE_NAME = "line-expiry";

let queue: Queue | null = null;
let worker: Worker | null = null;

// Procesa las líneas vencidas: si el usuario aún tiene días, renueva 24h (consume 1 día);
// si no, la desactiva. Modelo: 1 día = 1 línea activa por 24h. Devuelve cuántas desactivó.
export async function expireLines(): Promise<number> {
  const now = new Date();
  const expired = await prisma.waLine.findMany({
    where: { status: "active", expiresAt: { lt: now } },
    select: { id: true, userId: true, connected: true, label: true },
  });
  let deactivated = 0;
  for (const l of expired) {
    // Solo renueva líneas conectadas (las desconectadas no consumen días).
    if (l.connected) {
      const renewed = await consumeDayAndActivate(l.userId, l.id, l.label);
      if (renewed) {
        emitToUser(l.userId, "wa:status", { lineId: l.id, state: "renewed", connected: true });
        continue;
      }
    }
    await prisma.waLine.update({ where: { id: l.id }, data: { status: "inactive" } });
    emitToUser(l.userId, "wa:status", { lineId: l.id, state: "expired", connected: l.connected });
    deactivated++;
  }
  if (deactivated) console.log(`[line-expiry] desactivadas ${deactivated} línea(s) sin crédito`);
  // Poda de la tabla de idempotencia de webhooks: 2 días alcanzan de sobra (los eventos
  // duplicados llegan en segundos). Mantiene la tabla chica.
  await prisma.inboundDedup
    .deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) } } })
    .catch(() => undefined);
  return deactivated;
}

// Renueva/vence los "días de Chat App" (canal propio, sin WhatsApp): por cada cliente con el día
// prendido y vencido, intenta consumir 1 día (renueva 24h) si hay saldo y no tiene línea WA activa;
// sin saldo queda vencido y el candado se cierra solo. Mismo modelo que expireLines().
export async function expireChatDays(): Promise<void> {
  const now = new Date();
  const users = await prisma.user.findMany({
    where: { chatDayEnabled: true, OR: [{ chatDayExpiresAt: null }, { chatDayExpiresAt: { lt: now } }] },
    select: { id: true },
  });
  for (const u of users) {
    await consumeChatDayAndActivate(u.id).catch(() => undefined);
  }
}

// Reintenta los MetaEvent fallidos (últimas 24h). Reconstruye el evento desde el Contact
// y lo reenvía con el pixel del usuario. Marca "sent" al lograrlo. Idempotente: Meta
// deduplica por event_id, así que reintentar no genera doble conteo.
const CAPI_MAX_ATTEMPTS = 5;

// Reintenta los eventos CAPI fallidos. Por defecto solo los que no superaron el tope de
// intentos (los que sí = "dead-letter", se reprocesan a mano desde el admin con includeDead).
export async function retryFailedCapi(opts?: { includeDead?: boolean; max?: number }): Promise<number> {
  const failed = await prisma.metaEvent.findMany({
    where: {
      status: "failed",
      contactId: { not: null },
      ...(opts?.includeDead ? {} : { attempts: { lt: CAPI_MAX_ATTEMPTS } }),
    },
    orderBy: { createdAt: "asc" },
    take: opts?.max ?? 50,
  });
  let ok = 0;
  for (const ev of failed) {
    const contact = await prisma.contact.findUnique({ where: { id: ev.contactId! } });
    if (!contact) continue;
    const eventName: "Lead" | "Purchase" = ev.eventName === "Purchase" ? "Purchase" : "Lead";
    const creds = await resolveUserPixel(ev.userId, eventName);
    if (!creds) { void notifyMissingPixel(ev.userId); continue; } // sin pixel: avisamos y no gastamos intentos
    try {
      const result = await sendCapiEvent({
        eventName,
        externalId: contact.externalId,
        fbp: contact.fbp ?? undefined,
        fbc: contact.fbc ?? undefined,
        phone: contact.phone ?? undefined,
        firstName: contact.name ?? undefined,
        eventSourceUrl: contact.landingUrl ?? undefined,
        pixelId: creds?.pixelId,
        capiToken: creds?.capiToken,
        ...(eventName === "Purchase"
          ? { value: (contact.amount ?? 0) / 100, currency: "ARS", eventId: `${contact.externalId}:purchase` }
          : { eventId: contact.externalId }),
      });
      await prisma.metaEvent.update({
        where: { id: ev.id },
        data: { status: "sent", attempts: { increment: 1 }, pixelId: result.pixelId, payload: result.payload as object, response: result.response as object },
      });
      ok++;
    } catch (e) {
      // Suma un intento; al llegar al tope queda dead-letter (no se reintenta más solo).
      const msg = e instanceof Error ? e.message : String(e);
      await prisma.metaEvent.update({
        where: { id: ev.id },
        data: { attempts: { increment: 1 }, response: { error: msg } },
      });
    }
  }
  if (ok) console.log(`[capi-retry] reenviados ${ok}/${failed.length} evento(s)`);
  // Avisa al cliente + admin si hay eventos que agotaron los reintentos (token/pixel roto).
  await alertCapiFailures().catch(() => undefined);
  return ok;
}

// Detección de caída SILENCIOSA: WAHA/Baileys a veces reportan la sesión como "conectada"
// (connectionState=open) pero dejan de ENTREGAR los mensajes entrantes. connectionState no lo
// ve, así que una línea muerta puede pasar horas sin alertar (le pasó a redblack: 18 h). Señal
// inequívoca: la línea recibió clics (gente redirigida a WhatsApp) pero CERO mensajes entrantes
// en la ventana. Umbrales por env para poder ajustar sin tocar código.
const SILENT_WINDOW_H = Number(process.env.SILENT_FAIL_WINDOW_HOURS ?? 3); // ventana a mirar
const SILENT_MIN_CLICKS = Number(process.env.SILENT_FAIL_MIN_CLICKS ?? 6); // clics mínimos para concluir

// Chequea la salud de cada línea activa: conexión (Baileys) y calidad (Cloud API).
// Guarda el estado y notifica al dueño si se desconecta o baja la calidad.
export async function checkLineHealth(): Promise<void> {
  // Chequeamos las activas Y las inactivas que siguen CONECTADAS (ej. una línea que se quedó
  // sin días pero su WhatsApp sigue vinculado): si esa se cae, el dueño igual debe enterarse.
  const lines = await prisma.waLine.findMany({
    where: { OR: [{ status: { not: "inactive" } }, { connected: true }] },
  });
  for (const line of lines) {
    // Número externo: no hay sesión propia que monitorear (el WhatsApp vive en otro sistema).
    if (line.provider === "external") continue;
    try {
      let connected = line.connected;
      let quality = line.qualityRating;
      let phone = line.phone;
      if (line.provider === "cloud") {
        if (line.wabaPhoneNumberId && line.accessToken) {
          const q = await getPhoneQuality(line.wabaPhoneNumberId, decryptSecret(line.accessToken));
          if (q?.qualityRating) {
            const prev = line.qualityRating;
            quality = q.qualityRating;
            if (quality !== prev && (quality === "RED" || quality === "YELLOW")) {
              await notify(line.userId, "line_quality", `Calidad de línea ${quality === "RED" ? "ROJA" : "AMARILLA"}`,
                `La calidad de "${line.label ?? line.phone}" bajó a ${quality}. Cuidá la frecuencia/contenido para no perder el número.`);
            }
          }
        }
      } else {
        const inst = line.sessionId ?? `line_${line.id}`;
        const state = await getEngine().connectionState(inst);
        connected = state === "open";
        if (line.connected && !connected) {
          // Auto-recuperación: sesiones que quedan trabadas en close/connecting suelen
          // volver con un restart de la instancia, SIN re-escanear el QR (flapping 428).
          console.log(`[line-health] línea ${line.id} en "${state}": intento restart automático`);
          const restarted = await getEngine().restartInstance(inst);
          if (restarted) {
            await new Promise((r) => setTimeout(r, 15000));
            connected = (await getEngine().connectionState(inst)) === "open";
          }
          if (!connected) {
            // Línea con proxy gestionado (y que el cliente NO pausó): auto-recuperación
            // (backoff → rotar IP → detectar ban → liberar proxy → avisar admin). Las líneas SIN
            // proxy siguen con el aviso al dueño de siempre (backward-compatible).
            if (line.proxyId && line.status !== "paused" && !line.banned) {
              enqueueProxyRecover(line.id);
            } else {
              // Campana + email al dueño y admin (dedupe 6 h en el helper compartido).
              await alertLineDown(line);
            }
          }
        }
        // Caída SILENCIOSA: la sesión reporta "conectada" pero no entrega mensajes (WAHA a veces
        // "miente" sobre su salud). Señal: la línea recibió clics pero CERO entrantes en la ventana.
        // Solo AVISAMOS (no reiniciamos, para no cortar una línea sana ante un falso positivo: 6
        // personas que clickean y todavía no escriben). Dedupe: solo si no se avisó en las últimas 6 h.
        if (connected && line.status === "active") {
          const since = new Date(Date.now() - SILENT_WINDOW_H * 60 * 60 * 1000);
          const [clics, inbound] = await Promise.all([
            prisma.contact.count({ where: { lineId: line.id, createdAt: { gte: since } } }),
            prisma.message.count({ where: { lineId: line.id, direction: "in", createdAt: { gte: since } } }),
          ]);
          if (clics >= SILENT_MIN_CLICKS && inbound === 0) {
            const recentAlert = await prisma.notification.findFirst({
              where: { userId: line.userId, type: "line_down", createdAt: { gte: new Date(Date.now() - 6 * 60 * 60 * 1000) } },
              select: { id: true },
            });
            if (!recentAlert) {
              console.warn(`[line-health] línea ${line.id}: posible caída SILENCIOSA (${clics} clics, 0 mensajes en ${SILENT_WINDOW_H}h) -> alerta`);
              await alertLineDown(line);
            }
          }
        }
        // Auto-reparación del número: si quedó conectada pero SIN teléfono (pasa cuando el owner
        // no llegó en el connection.update al reconectar), se lo re-pedimos al motor. Sin número el
        // /go NO usa la línea y la landing muestra "WhatsApp no disponible".
        if (connected && !phone) {
          const owner = await getEngine().fetchOwnerNumber(inst).catch(() => "");
          if (owner) {
            phone = owner;
            console.log(`[line-health] línea ${line.id}: recuperé el número (${owner}) que había quedado vacío`);
          }
        }
      }
      await prisma.waLine.update({ where: { id: line.id }, data: { connected, qualityRating: quality ?? null, phone, lastCheckedAt: new Date() } });
      emitToUser(line.userId, "wa:health", { lineId: line.id, connected, qualityRating: quality ?? null });
    } catch (e) {
      console.error("[line-health] error en línea", line.id, e instanceof Error ? e.message : String(e));
    }
  }
}

// Vigila la versión de WhatsApp Web fijada en Evolution: si venció o vence en <=7 días,
// avisa a los admins (in-app + email). Una versión vencida hace que la sesión conecte y
// reciba pero los envíos se DESCARTEN en silencio — hay que renovarla antes de que pase.
export async function checkWaVersionJob(): Promise<void> {
  const st = await checkWaWebVersion();
  if (!st) return; // sin CONFIG_SESSION_PHONE_VERSION en el env, o fetch fallido: nada que hacer
  if (!st.needsAction) return;
  const detail =
    st.daysLeft === null
      ? `La versión fijada (${st.pinned}) YA NO FIGURA como vigente: lo más probable es que haya vencido y los envíos se estén descartando en silencio.`
      : `La versión fijada (${st.pinned}) vence en ${st.daysLeft} día${st.daysLeft === 1 ? "" : "s"} (${st.expiresAt?.toISOString().slice(0, 10)}).`;
  const body =
    `${detail}\n\nActualizá CONFIG_SESSION_PHONE_VERSION=${st.latest} en el .env del VPS ` +
    `(/opt/publilat/.env) y levantá Evolution de nuevo: docker compose -f docker-compose.vps.yml up -d evolution`;
  const title = "⚠️ Renovar la versión de WhatsApp Web (Evolution)";
  const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
  let alerted = false;
  for (const a of admins) {
    // Aviso una vez cada 20 h por admin (el job corre varias veces al día).
    const recent = await prisma.notification.findFirst({
      where: { userId: a.id, title, createdAt: { gte: new Date(Date.now() - 20 * 60 * 60 * 1000) } },
      select: { id: true },
    });
    if (recent) continue;
    await notify(a.id, "system", title, body);
    alerted = true;
  }
  // El email acompaña al primer aviso in-app del día (o va solo si no hay admins en la DB).
  if (alerted || admins.length === 0) void sendAdminMail(title, body);
  console.warn(`[wa-version] ${detail}`);
}

// Avisa a los clientes ~10 h y ~3 h ANTES de que se les acabe el saldo, para que recarguen
// y su servicio no se corte. Solo avisa a quien NO tiene días para renovar (si tiene, la
// línea se renueva sola). Un aviso por CLIENTE (la línea que vence primero), con dedupe.
export async function checkLowBalance(): Promise<void> {
  const now = Date.now();
  const horizon = new Date(now + 10.5 * 60 * 60 * 1000); // miramos hasta ~10 h adelante
  const lines = await prisma.waLine.findMany({
    where: { status: "active", connected: true, expiresAt: { gt: new Date(now), lt: horizon } },
    select: { id: true, userId: true, label: true, phone: true, expiresAt: true },
  });
  // Por cliente, la línea que vence PRIMERO marca cuándo se frena su operación.
  const soonestByUser = new Map<string, (typeof lines)[number]>();
  for (const l of lines) {
    if (!l.expiresAt) continue;
    const cur = soonestByUser.get(l.userId);
    if (!cur || (cur.expiresAt && l.expiresAt < cur.expiresAt)) soonestByUser.set(l.userId, l);
  }
  for (const [userId, line] of soonestByUser) {
    // Si tiene días, la línea se renueva sola al vencer: no hace falta avisar.
    const credit = await prisma.credit.findUnique({ where: { userId }, select: { days: true } });
    if ((credit?.days ?? 0) >= 1) continue;
    const hoursLeft = (line.expiresAt!.getTime() - now) / (60 * 60 * 1000);
    const threshold = hoursLeft <= 3 ? 3 : hoursLeft <= 10 ? 10 : null;
    if (!threshold) continue;
    // Dedupe atómico por (cliente, umbral, vencimiento): un aviso por umbral y ciclo.
    const key = `lowbal:${userId}:${threshold}:${line.expiresAt!.toISOString().slice(0, 13)}`;
    try {
      await prisma.inboundDedup.create({ data: { key } });
    } catch (e) {
      if ((e as { code?: string })?.code === "P2002") continue; // ya avisado
      continue;
    }
    await alertLowBalance({ id: line.id, userId, label: line.label, phone: line.phone }, hoursLeft);
  }
}

// ============================ AUTO-RECUPERACIÓN DE PROXIES (Fase 4) ============================
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const RECOVER_BACKOFFS = [5_000, 15_000, 45_000, 120_000]; // ms entre intentos (spec)

// Alcance del proxy: TCP connect al gateway. No valida la IP upstream, pero si el gateway no
// responde, todas sus líneas están muertas. Best-effort con timeout.
function tcpReachable(host: string, port: number, timeoutMs = 6000): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    const done = (ok: boolean) => { try { sock.destroy(); } catch { /* noop */ } resolve(ok); };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
    try { sock.connect(port, host); } catch { done(false); }
  });
}

// Recupera una línea con proxy que se cayó (no pausada, no baneada). Backoff (5s/15s/45s/2m):
// intenta reconectar; desde el 2º intento ROTA la IP; si reconecta, listo; si tras rotar la IP el
// motor indica LOGOUT/ban o se agotan los intentos: marca banned, LIBERA el proxy y AVISA al admin.
// Un solo job por línea (jobId dedup). Best-effort: NUNCA frena el resto.
export async function recoverProxyLine(lineId: string): Promise<void> {
  for (let attempt = 1; attempt <= RECOVER_BACKOFFS.length; attempt++) {
    const line = await prisma.waLine.findUnique({
      where: { id: lineId },
      select: { id: true, provider: true, proxyId: true, status: true, banned: true, sessionId: true },
    });
    if (!line || line.provider === "cloud" || !line.proxyId) return; // solo Baileys con proxy del pool
    if (line.status === "paused" || line.banned) return;             // el cliente la pausó / ya baneada
    const inst = line.sessionId ?? `line_${line.id}`;

    await sleep(RECOVER_BACKOFFS[attempt - 1]); // backoff antes del intento
    if ((await getEngine().connectionState(inst).catch(() => "unknown")) === "open") {
      await logProxyEvent(lineId, line.proxyId, "reconnected", `reconectó sola (intento ${attempt})`);
      return;
    }
    if (attempt >= 2) {
      await rotateProxy(lineId).catch(() => undefined);        // nueva IP sticky
      await applyLineProxy(inst, lineId).catch(() => undefined);
      await logProxyEvent(lineId, line.proxyId, "rotated", `roto IP y reintento (intento ${attempt})`);
    } else {
      await logProxyEvent(lineId, line.proxyId, "line_down", `reintento de reconexión ${attempt}`);
    }
    await getEngine().restartInstance(inst).catch(() => undefined);
    await sleep(12_000);
    const state = await getEngine().connectionState(inst).catch(() => "unknown");
    if (state === "open") {
      await logProxyEvent(lineId, line.proxyId, "reconnected", `intento ${attempt}`);
      return;
    }
    if (/logout|logged|failed|banned|401|403|unpaired/i.test(state)) break; // ban inequívoco: cortar
  }

  // Agotó los intentos (o ban inequívoco): confirmar que sigue caída y marcar baneada.
  const line = await prisma.waLine.findUnique({
    where: { id: lineId },
    select: { proxyId: true, label: true, phone: true, banned: true, status: true, provider: true, sessionId: true },
  });
  if (!line || line.provider === "cloud" || line.banned || line.status === "paused") return;
  const inst = line.sessionId ?? `line_${lineId}`;
  if ((await getEngine().connectionState(inst).catch(() => "")) === "open") return; // reconectó en el ínterin
  await prisma.waLine.update({ where: { id: lineId }, data: { banned: true, connected: false, status: "inactive" } }).catch(() => undefined);
  await logProxyEvent(lineId, line.proxyId, "banned", "no reconectó tras rotar la IP");
  await releaseProxy(lineId); // libera el cupo del proxy para otra línea
  await alertAdminProxy(
    "Número baneado",
    `La línea "${line.label ?? line.phone}" no reconectó ni rotando la IP. Se marcó BANEADA y se liberó su proxy.`,
    "banned",
    { lineId },
  );
}

// Encola la recuperación de una línea (dedup por jobId: una recuperación por línea a la vez).
export function enqueueProxyRecover(lineId: string): void {
  if (queue) {
    void queue.add("proxy-recover", { lineId }, { jobId: `precover-${lineId}`, removeOnComplete: true, removeOnFail: 20 });
  } else {
    void recoverProxyLine(lineId).catch(() => undefined);
  }
}

// Corre fn sobre items con un tope de concurrencia (100 proxies × ~9s serían minutos si fuera serial).
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(runners);
  return out;
}

// Salud del POOL (Fase 2): valida cada proxy activo con un CONNECT REAL a un checker de IP por su
// túnel (no solo TCP: comprueba auth + upstream + SALIDA a internet). Solo los healthy son asignables
// (assignProxy filtra por healthy). Si uno cae, lo marca unhealthy y rota sus líneas a otro sano.
// Pre-gate barato: si el gateway ni responde TCP, se saltea el CONNECT completo. Best-effort.
export async function checkProxyHealth(): Promise<void> {
  const proxies = await prisma.proxy.findMany({ where: { active: true } });
  const results = await mapLimit(proxies, 8, async (p) => {
    if (!(await tcpReachable(p.host, p.port))) return { p, ok: false, ip: undefined as string | undefined };
    const probe = await probeProxy(p);
    return { p, ok: probe.ok, ip: probe.ip };
  });
  for (const { p, ok, ip } of results) {
    const wasHealthy = p.healthy;
    await prisma.proxy.update({ where: { id: p.id }, data: { healthy: ok, lastCheckAt: new Date() } }).catch(() => undefined);
    if (wasHealthy && !ok) {
      await logProxyEvent("", p.id, "proxy_unhealthy", `${p.host}:${p.port} no sale a internet (CONNECT falló)`);
      await alertAdminProxy("Proxy caído", `El proxy "${p.label}" no sale a internet. Roto sus líneas a otro proxy sano.`, "proxy_unhealthy", { proxyId: p.id });
      const lines = await prisma.waLine.findMany({ where: { proxyId: p.id }, select: { id: true, sessionId: true } });
      for (const l of lines) {
        await rotateProxy(l.id).catch(() => undefined); // re-asigna a otro sano (o pool_full → avisa)
        const inst = l.sessionId ?? `line_${l.id}`;
        await applyLineProxy(inst, l.id).catch(() => undefined);
        await getEngine().restartInstance(inst).catch(() => undefined);
      }
    } else if (!wasHealthy && ok) {
      await logProxyEvent("", p.id, "reconnected", `${p.label} volvió a salir a internet${ip ? ` (IP ${ip})` : ""}`);
    }
  }
}

// ===================== WATCHDOG DE REGISTRO + waiting_proxy (Fase 4) =====================
const WATCH_DELAY_MS = 50_000;   // margen para que la línea llegue al QR/WORKING por el proxy
const WATCH_MAX_ATTEMPTS = 3;    // intentos de fallback (rota proxy/proveedor) antes de waiting_proxy

// Vigila una línea NUEVA que arrancó con proxy: ¿llegó al QR/WORKING por el proxy? Si sí, listo. Si el
// túnel de ese proxy falló (FAILED), rota siguiendo la jerarquía (otra IP → contingencia → cualquiera)
// y reintenta; tras N intentos sin éxito, la deja en waiting_proxy (NUNCA la conecta por la IP del VPS).
export async function watchProxyRegistration(lineId: string, attempt = 1): Promise<void> {
  const line = await prisma.waLine.findUnique({
    where: { id: lineId },
    select: { id: true, userId: true, provider: true, proxyId: true, status: true, banned: true, proxyWait: true, sessionId: true },
  });
  if (!line || line.provider === "cloud") return;
  if (line.status === "paused" || line.banned || line.proxyWait) return; // pausada/baneada/ya esperando
  if (!line.proxyId) return; // sin proxy (flag off o resuelta): nada que vigilar
  const inst = line.sessionId ?? `line_${line.id}`;

  const state = await getEngine().connectionState(inst).catch(() => "unknown");
  // "open" = WORKING; "connecting" = SCAN_QR_CODE (QR ya visible POR el proxy) → el túnel sale OK.
  if (state === "open" || state === "connecting") {
    await logProxyEvent(lineId, line.proxyId, "reconnected", `registro OK por el proxy (${state}, intento ${attempt})`);
    return;
  }
  // "close"/"unknown" = FAILED tras aplicar el proxy → el túnel de ESTE proxy falló en el registro.
  if (attempt >= WATCH_MAX_ATTEMPTS) {
    await setLineWaitingProxy(lineId, `no llegó al QR por el proxy tras ${attempt} intentos`);
    return; // la sesión queda FAILED (no conectada por ninguna IP); la reconecta recoverWaitingProxyLines
  }
  const r = await assignFallback(lineId, line.proxyId); // jerarquía; NUNCA "sin proxy"
  if (!r.ok) {
    await setLineWaitingProxy(lineId, "sin proxy sano para el fallback del registro");
    return;
  }
  await applyLineProxy(inst, lineId).catch(() => undefined);
  await getEngine().restartInstance(inst).catch(() => undefined);
  await logProxyEvent(lineId, r.proxyId, "rotated", `fallback de registro (intento ${attempt}→${attempt + 1})`);
  const fresh = await getEngine().connectInstance(inst).catch(() => ({} as { base64?: string }));
  if (fresh.base64) emitToUser(line.userId, "wa:qr", { lineId, qr: fresh.base64 });
  enqueueProxyWatch(lineId, attempt + 1);
}

// Encola el watchdog de una línea con delay (dedup por jobId línea+intento).
export function enqueueProxyWatch(lineId: string, attempt = 1): void {
  if (queue) {
    void queue.add("proxy-watch", { lineId, attempt }, { delay: WATCH_DELAY_MS, jobId: `pwatch-${lineId}-${attempt}`, removeOnComplete: true, removeOnFail: 20 });
  } else {
    setTimeout(() => void watchProxyRegistration(lineId, attempt).catch(() => undefined), WATCH_DELAY_MS);
  }
}

// AUTO-RECUPERACIÓN de líneas en waiting_proxy: cuando el pool se recupera, les asigna un proxy sano y
// las conecta (por la IP residencial). Así una línea nunca queda muerta ni toca la IP del VPS.
export async function recoverWaitingProxyLines(): Promise<void> {
  const lines = await prisma.waLine.findMany({
    where: { proxyWait: true, provider: { not: "cloud" }, banned: false, status: { not: "paused" } },
    select: { id: true, userId: true, sessionId: true },
  });
  for (const l of lines) {
    const a = await assignProxyPreferred(l.id);
    if (!a.ok) continue; // el pool sigue sin cupo sano: la línea sigue esperando
    const inst = l.sessionId ?? `line_${l.id}`;
    await getEngine().createInstance(inst).catch(() => undefined); // crea o reusa la sesión
    await applyLineProxy(inst, l.id).catch(() => undefined);
    await prisma.waLine.update({ where: { id: l.id }, data: { proxyWait: false } }).catch(() => undefined);
    await logProxyEvent(l.id, a.proxyId, "reconnected", "waiting_proxy → proxy asignado, reconectando");
    const fresh = await getEngine().connectInstance(inst).catch(() => ({} as { base64?: string }));
    if (fresh.base64) emitToUser(l.userId, "wa:qr", { lineId: l.id, qr: fresh.base64 });
    enqueueProxyWatch(l.id);
  }
}

// Limpieza de sesiones WAHA HUÉRFANAS (Chromium sin línea asociada) — cada una es un navegador que
// come RAM al pedo; acumuladas ahogan el server y tumban las líneas en cadena. Borra solo las que NO
// están WORKING (jamás corta una línea conectada, aunque parezca huérfana). Solo con WAHA. Best-effort.
export async function cleanupOrphanWahaSessions(): Promise<void> {
  if (getEngine().name !== "waha") return;
  const lines = await prisma.waLine.findMany({ where: { provider: { not: "cloud" } }, select: { id: true, sessionId: true } });
  const valid = new Set<string>();
  for (const l of lines) {
    if (l.sessionId) valid.add(l.sessionId);
    valid.add(`line_${l.id}`);
  }
  const sessions = await wahaListSessions();
  let deleted = 0;
  for (const s of sessions) {
    if (!s.name || valid.has(s.name)) continue;
    if (s.status === "WORKING") continue; // NUNCA borrar una sesión conectada
    await getEngine().logoutInstance(s.name).catch(() => undefined);
    await getEngine().deleteInstance(s.name).catch(() => undefined);
    deleted++;
  }
  if (deleted) console.log(`[waha-cleanup] ${deleted} sesión(es) huérfana(s) borrada(s) (de ${sessions.length})`);
}

// Programa la reanudación de una secuencia tras un delay (para el motor de automatizaciones).
export function scheduleFlowResume(runId: string, delaySec: number): void {
  if (queue) {
    void queue.add("flow-resume", { runId }, { delay: delaySec * 1000, removeOnComplete: true, removeOnFail: 50 });
  } else {
    // Fallback en proceso si la cola no está lista (dev sin Redis).
    setTimeout(() => { void import("./flow-engine.js").then((m) => m.resumeFlowRun(runId)).catch(() => undefined); }, delaySec * 1000);
  }
}

// Arranca el worker y programa los chequeos periódicos. Idempotente.
export async function initQueues(): Promise<void> {
  if (queue) return;
  try {
    queue = new Queue(QUEUE_NAME, { connection });
    worker = new Worker(
      QUEUE_NAME,
      async (job: Job) => {
        if (job.name === "capi-retry") return retryFailedCapi();
        if (job.name === "line-health") return checkLineHealth();
        if (job.name === "low-balance") return checkLowBalance();
        if (job.name === "wa-version-check") return checkWaVersionJob();
        if (job.name === "proxy-health") return checkProxyHealth();
        if (job.name === "proxy-recover") return recoverProxyLine(job.data.lineId as string);
        if (job.name === "proxy-watch") return watchProxyRegistration(job.data.lineId as string, (job.data.attempt as number) ?? 1);
        if (job.name === "proxy-waiting") return recoverWaitingProxyLines();
        if (job.name === "waha-cleanup") return cleanupOrphanWahaSessions();
        if (job.name === "flow-resume") {
          const { resumeFlowRun } = await import("./flow-engine.js");
          return resumeFlowRun(job.data.runId as string);
        }
        await expireChatDays().catch((e) => console.error("[chat-day] expire:", e instanceof Error ? e.message : String(e)));
        return expireLines();
      },
      { connection }
    );
    worker.on("failed", (job, err) => console.error(`[queue:${job?.name}] job falló:`, err?.message));

    // jobId fijo => no se duplica entre reinicios.
    await queue.add("expire", {}, { repeat: { every: 60_000 }, jobId: "expire-repeat", removeOnComplete: true, removeOnFail: 50 });
    await queue.add("capi-retry", {}, { repeat: { every: 300_000 }, jobId: "capi-retry-repeat", removeOnComplete: true, removeOnFail: 50 });
    await queue.add("line-health", {}, { repeat: { every: 300_000 }, jobId: "line-health-repeat", removeOnComplete: true, removeOnFail: 50 });
    await queue.add("low-balance", {}, { repeat: { every: 1_800_000 }, jobId: "low-balance-repeat", removeOnComplete: true, removeOnFail: 50 });
    await queue.add("wa-version-check", {}, { repeat: { every: 43_200_000 }, jobId: "wa-version-check-repeat", removeOnComplete: true, removeOnFail: 50 });
    await queue.add("proxy-health", {}, { repeat: { every: 360_000 }, jobId: "proxy-health-repeat", removeOnComplete: true, removeOnFail: 50 });
    await queue.add("proxy-waiting", {}, { repeat: { every: 120_000 }, jobId: "proxy-waiting-repeat", removeOnComplete: true, removeOnFail: 50 });
    await queue.add("waha-cleanup", {}, { repeat: { every: 1_800_000 }, jobId: "waha-cleanup-repeat", removeOnComplete: true, removeOnFail: 50 });
    console.log("[queue] BullMQ listo (vencimiento 60s + CAPI 5min + salud 5min + saldo 30min + versión WA Web 12h + proxies 6min + waiting_proxy 2min + limpieza WAHA 30min)");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[queue] no se pudo iniciar BullMQ (¿Redis arriba?):", msg);
  }
}

// Cierra worker y cola para un shutdown limpio.
export async function closeQueues(): Promise<void> {
  await worker?.close().catch(() => undefined);
  await queue?.close().catch(() => undefined);
  worker = null;
  queue = null;
}
