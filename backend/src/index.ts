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
import { billingRouter, billingWebhookRouter, usdtWebhookRouter, stripeWebhookHandler } from "./routes/billing.js";
import { landingsRouter } from "./routes/landings.js";
import { integrationsRouter } from "./routes/integrations.js";
import { pixelRouter } from "./routes/pixel.js";
import { setupRouter } from "./routes/setup.js";
import { adminRouter } from "./routes/admin.js";
import { supportRouter } from "./routes/support.js";
import { requireAdmin } from "./middleware/requireAdmin.js";
import { requireAuth } from "./middleware/requireAuth.js";
import { verifyToken } from "./lib/auth.js";
import { setIo } from "./lib/io.js";
import { initQueues, closeQueues } from "./lib/queue.js";
import { validateEnv } from "./lib/env.js";
import { prisma } from "./lib/prisma.js";

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

// Health (sin rate-limit, para chequeos del orquestador)
app.get("/health", (_req, res) => res.json({ ok: true, service: "publilat-backend" }));

// Corazón del MVP: redirector de atribución (público)
app.use("/go", goLimiter);
app.use("/", goRouter);

// Landings públicas (/l/:slug demo, /p/:slug guardada)
app.use("/", landingRouter);

// Auth (público, rate-limit estricto contra fuerza bruta)
app.use("/api/auth", authLimiter, authRouter);

// Webhooks públicos (los llaman servicios externos, sin Bearer)
app.use("/api/wa/cloud/webhook", cloudWebhookRouter); // WhatsApp Cloud API (CTWA)
app.use("/api/wa/webhook", webhookRouter);
app.use("/api/billing/webhook/usdt", usdtWebhookRouter); // NOWPayments (USDT)
app.use("/api/billing/webhook", billingWebhookRouter); // MercadoPago (debe ir último)

// Solicitud de eliminación de datos (pública). La vía principal es por email (hola@publi.lat);
// este endpoint deja registrado el pedido. No expone datos.
app.post("/api/data-deletion", (req, res) => {
  const account = typeof req.body?.account === "string" ? req.body.account.trim().slice(0, 200) : "";
  const phone = typeof req.body?.phone === "string" ? req.body.phone.trim().slice(0, 40) : "";
  if (!account && !phone) {
    return res.status(400).json({ error: "Indicá el email de la cuenta o el teléfono del contacto." });
  }
  console.log(`[data-deletion] solicitud recibida -> account="${account}" phone="${phone}"`);
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
io.use((socket, next) => {
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
    const { userId } = verifyToken(token);
    socket.data.userId = userId;
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

const PORT = Number(process.env.PORT ?? 4000);
server.listen(PORT, () => {
  console.log(`API en http://localhost:${PORT} (${process.env.NODE_ENV ?? "development"})`);
  void initQueues(); // BullMQ: vencimiento automático de líneas
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
