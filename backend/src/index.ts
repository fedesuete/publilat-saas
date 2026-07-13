import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Server as SocketServer } from "socket.io";
import { goRouter } from "./routes/go.js";
import { landingRouter } from "./routes/landing.js";
import { authRouter } from "./routes/auth.js";
import { leadsRouter } from "./routes/leads.js";
import { waRouter } from "./routes/wa.js";
import { webhookRouter } from "./routes/webhook.js";
import { cloudWebhookRouter } from "./routes/wa-cloud.js";
import { inboxRouter } from "./routes/inbox.js";
import { analyticsRouter } from "./routes/analytics.js";
import { billingRouter, billingWebhookRouter, usdtWebhookRouter, pagoparWebhookRouter, stripeWebhookHandler } from "./routes/billing.js";
import { landingsRouter } from "./routes/landings.js";
import { integrationsRouter, inboundIntegrationsRouter } from "./routes/integrations.js";
import { pixelRouter } from "./routes/pixel.js";
import { setupRouter } from "./routes/setup.js";
import { adminRouter } from "./routes/admin.js";
import { supportRouter } from "./routes/support.js";
import { notificationsRouter } from "./routes/notifications.js";
import { flowsRouter } from "./routes/flows.js";
import { trackRouter } from "./routes/track.js";
import { requireAdmin } from "./middleware/requireAdmin.js";
import { requireAuth } from "./middleware/requireAuth.js";
import { verifyToken } from "./lib/auth.js";
import { setIo } from "./lib/io.js";
import { initQueues, closeQueues } from "./lib/queue.js";
import { validateEnv } from "./lib/env.js";
import { prisma } from "./lib/prisma.js";
import { getEngine } from "./lib/wa-engine.js";

validateEnv();

// CORS: una o varias URLs separadas por coma en PANEL_BASE_URL. En dev cae a "*".
const allowedOrigins = (process.env.PANEL_BASE_URL ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const corsOrigin = allowedOrigins.length ? allowedOrigins : "*";

const app = express();
app.set("trust proxy", 1); // detrás de proxy/CDN: req.ip real + rate-limit correcto
app.use(
  helmet({
    contentSecurityPolicy: false, // las landings traen el pixel inline; el panel es SPA aparte
    crossOriginEmbedderPolicy: false,
    // Permite que los popups que abre la app (Facebook Login / Embedded Signup) sigan
    // comunicándose con la ventana que los abrió (window.opener + postMessage).
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  })
);
app.use(cors({ origin: corsOrigin, credentials: true }));

// Webhook de Stripe ANTES del json(): necesita el body crudo para validar la firma.
app.post("/api/billing/webhook/stripe", express.raw({ type: "*/*" }), stripeWebhookHandler);

// Guardamos el body crudo (para validar la firma X-Hub-Signature-256 de los webhooks de Meta).
app.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buf) => {
      (req as unknown as { rawBody?: Buffer }).rawBody = buf;
    },
  })
);
app.use(cookieParser());

// Rate limits: más laxo global, estricto en auth y en el redirector público.
const apiLimiter = rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 15 * 60_000, max: 30, standardHeaders: true, legacyHeaders: false });
const goLimiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
// Techo para webhooks públicos que vienen de IPs externas (pagos, CRM). Generoso para no
// estrangular ráfagas legítimas, pero corta un flood. El webhook de WhatsApp NO lo usa:
// su tráfico legítimo llega todo desde la IP interna de WAHA/Evolution y ya exige token.
const webhookLimiter = rateLimit({ windowMs: 60_000, max: 600, standardHeaders: true, legacyHeaders: false });

// Health (sin rate-limit, para chequeos del orquestador)
app.get("/health", (_req, res) => res.json({ ok: true, service: "publilat-backend" }));

// Corazón del MVP: redirector de atribución (público)
app.use("/go", goLimiter);
app.use("/", goRouter);

// Landings públicas (/l/:slug demo, /p/:slug guardada)
app.use("/", landingRouter);

// Links rastreados de automatizaciones (público, /r/:code)
app.use("/", trackRouter);

// Auth (público, rate-limit estricto contra fuerza bruta)
app.use("/api/auth", authLimiter, authRouter);

// Webhooks públicos (los llaman servicios externos, sin Bearer)
app.use("/api/wa/cloud/webhook", cloudWebhookRouter); // WhatsApp Cloud API (CTWA)
app.use("/api/wa/webhook", webhookRouter);
app.use("/api/integrations/inbound", webhookLimiter, inboundIntegrationsRouter); // CRM externo (Kommo) → Purchase
app.use("/api/billing/webhook/usdt", webhookLimiter, usdtWebhookRouter); // NOWPayments (USDT)
app.use("/api/billing/webhook/pagopar", webhookLimiter, pagoparWebhookRouter); // Pagopar (Paraguay)
app.use("/api/billing/webhook", webhookLimiter, billingWebhookRouter); // MercadoPago (debe ir último)

// Solicitud de eliminación de datos (pública). La vía principal es por email (hola@publi.lat);
// este endpoint deja registrado el pedido. No expone datos.
app.post("/api/data-deletion", webhookLimiter, (req, res) => {
  const account = typeof req.body?.account === "string" ? req.body.account.trim().slice(0, 200) : "";
  const phone = typeof req.body?.phone === "string" ? req.body.phone.trim().slice(0, 40) : "";
  if (!account && !phone) {
    return res.status(400).json({ error: "Indicá el email de la cuenta o el teléfono del contacto." });
  }
  // No loguear PII en claro (regla del proyecto) ni permitir inyección de líneas en el log:
  // se enmascara el teléfono y se sanitizan saltos de línea del input.
  const mask = (s: string) => s.replace(/[\r\n\t]/g, " ").slice(0, 60);
  const maskedPhone = phone ? `••••${phone.replace(/\D/g, "").slice(-4)}` : "";
  const maskedAccount = account ? mask(account).replace(/(.{2}).*(@.*)/, "$1•••$2") : "";
  console.log(`[data-deletion] solicitud recibida -> account="${maskedAccount}" phone="${maskedPhone}"`);
  return res.json({
    ok: true,
    message: "Recibimos tu solicitud y la procesaremos a la brevedad. También podés escribir a hola@publi.lat.",
  });
});

// Rutas protegidas: Bearer token + rate-limit de API.
app.use("/api/leads", apiLimiter, requireAuth, leadsRouter);
app.use("/api/wa", apiLimiter, requireAuth, waRouter);
app.use("/api/inbox", apiLimiter, requireAuth, inboxRouter);
app.use("/api/analytics", apiLimiter, requireAuth, analyticsRouter);
app.use("/api/billing", apiLimiter, requireAuth, billingRouter);
app.use("/api/landings", apiLimiter, requireAuth, landingsRouter);
app.use("/api/integrations", apiLimiter, requireAuth, integrationsRouter);
app.use("/api/pixels", apiLimiter, requireAuth, pixelRouter);
app.use("/api/setup", apiLimiter, requireAuth, setupRouter);
app.use("/api/support", apiLimiter, requireAuth, supportRouter);
app.use("/api/notifications", apiLimiter, requireAuth, notificationsRouter);
app.use("/api/flows", apiLimiter, requireAuth, flowsRouter);
// Panel maestro: admin-only (requireAuth + requireAdmin).
app.use("/api/admin", apiLimiter, requireAuth, requireAdmin, adminRouter);

// 404 para rutas de API desconocidas (antes del fallback del SPA).
app.use("/api", (_req, res) => res.status(404).json({ error: "No encontrado" }));

// Servir el panel (build de Vite) si está disponible -> deploy de un solo servicio.
// FRONTEND_DIST apunta al dist; si no, intenta ../frontend/dist.
const frontendDist =
  process.env.FRONTEND_DIST ?? resolve(process.cwd(), "..", "frontend", "dist");
if (existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  // SPA fallback: cualquier GET que no sea API/landing devuelve index.html.
  app.get("*", (_req, res) => res.sendFile(resolve(frontendDist, "index.html")));
  console.log(`[static] sirviendo panel desde ${frontendDist}`);
}

// Manejador central de errores: no filtra stack traces al cliente.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[error]", err instanceof Error ? err.stack : err);
  if (res.headersSent) return;
  res.status(500).json({ error: "Error interno" });
});

const server = createServer(app);
const io = new SocketServer(server, { cors: { origin: corsOrigin, credentials: true } });
setIo(io);

// Auth del socket: el JWT viene por la cookie httpOnly (mismo origen) o, como fallback,
// en handshake.auth.token.
io.use(async (socket, next) => {
  const fromAuth = socket.handshake.auth?.token as string | undefined;
  const cookieHeader = socket.handshake.headers.cookie ?? "";
  const fromCookie = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("publilat_token="))
    ?.slice("publilat_token=".length);
  const token = fromAuth || (fromCookie ? decodeURIComponent(fromCookie) : undefined);
  if (!token) return next(new Error("No autenticado"));
  try {
    const payload = verifyToken(token);
    // Revalida contra la DB igual que requireAuth: una sesión revocada (tokenVersion) o
    // una cuenta suspendida NO debe seguir recibiendo eventos en vivo hasta que expire el JWT.
    if (typeof payload.tv === "number") {
      const u = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { tokenVersion: true, suspended: true },
      });
      if (!u || u.suspended || u.tokenVersion !== payload.tv) {
        return next(new Error("Sesión revocada"));
      }
    }
    socket.data.userId = payload.userId;
    return next();
  } catch {
    return next(new Error("Token inválido"));
  }
});

io.on("connection", (socket) => {
  const userId = socket.data.userId as string;
  socket.join(`user:${userId}`); // recibe QR, estado de línea e Inbox de su cuenta
});

// Red de seguridad: un error async no manejado NO debe tumbar el servidor.
process.on("unhandledRejection", (reason) => console.error("[unhandledRejection]", reason));
process.on("uncaughtException", (err) => console.error("[uncaughtException]", err));

// Re-aplica la configuración del webhook a las instancias Evolution existentes.
// Necesario al agregar eventos nuevos (ej. MESSAGES_UPDATE): las instancias creadas
// antes quedaron suscriptas a la lista vieja y no mandarían los acks de entrega.
// OJO: SOLO para Evolution. En WAHA el webhook ya persiste en la config de la sesión, y
// re-aplicarlo hace un PUT que REINICIA la sesión — en un deploy eso puede tumbar líneas
// conectadas (incidente Ganamos 2026-07-13). Con WAHA no se re-sincroniza.
async function syncEvolutionWebhooks() {
  try {
    if (getEngine().name !== "evolution") {
      console.log("[wa] motor no-Evolution: el webhook persiste en la sesión, no se re-sincroniza (evita reiniciar líneas)");
      return;
    }
    const lines = await prisma.waLine.findMany({
      where: { provider: "baileys", sessionId: { not: null } },
      select: { sessionId: true },
    });
    let ok = 0;
    for (const l of lines) {
      if (!l.sessionId) continue;
      try {
        await getEngine().setWebhook(l.sessionId);
        ok++;
      } catch (e) {
        console.warn(`[wa] setWebhook ${l.sessionId} falló:`, e instanceof Error ? e.message : String(e));
      }
    }
    if (lines.length) console.log(`[wa] webhook re-sincronizado en ${ok}/${lines.length} instancia(s)`);
  } catch (e) {
    console.error("[wa] syncEvolutionWebhooks:", e instanceof Error ? e.message : String(e));
  }
}

const PORT = Number(process.env.PORT ?? 4000);
server.listen(PORT, () => {
  console.log(`API en http://localhost:${PORT} (${process.env.NODE_ENV ?? "development"})`);
  void initQueues(); // BullMQ: vencimiento automático de líneas
  void syncEvolutionWebhooks(); // acks de entrega en instancias pre-existentes
});

// Apagado limpio: cierra HTTP, colas y Prisma.
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal} recibido, cerrando...`);
  server.close();
  io.close();
  await closeQueues();
  await prisma.$disconnect().catch(() => undefined);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
