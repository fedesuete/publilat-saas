// Gestión de líneas de WhatsApp (Fase 2). Protegido por requireAuth.
// Crea instancias en Evolution, expone QR (socket + respuesta) y estado de conexión.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { emitToUser } from "../lib/io.js";
import { encryptSecret, decryptSecret, maskSecret } from "../lib/crypto.js";
import { getAvailableDays, consumeDayAndActivate } from "../lib/access.js";
import {
  createInstance,
  connectInstance,
  connectionState,
  fetchOwnerNumber,
  logoutInstance,
  deleteInstance,
} from "../lib/evolution.js";
import axios from "axios";
import crypto from "node:crypto";
import {
  GRAPH_VERSION,
  exchangeCodeForToken,
  subscribeWaba,
  getSubscribedApps,
  registerCloudNumber,
  getWabaPhoneNumbers,
  debugToken,
} from "../lib/wa-cloud.js";

export const waRouter = Router();

// URL pública del webhook de la Cloud API (para pegar en Meta).
const CLOUD_WEBHOOK_URL = `${(process.env.APP_BASE_URL ?? "http://localhost:4000").replace(/\/$/, "")}/api/wa/cloud/webhook`;

// Forma pública de una línea (nunca devuelve el access token entero).
function toPublicLine(l: {
  id: string; phone: string; label: string | null; status: string; provider: string;
  connected: boolean; expiresAt: Date | null; createdAt: Date; registered?: boolean; qualityRating?: string | null;
  wabaPhoneNumberId: string | null; wabaId: string | null; accessToken: string | null; verifyToken: string | null;
}) {
  return {
    id: l.id,
    phone: l.phone,
    label: l.label,
    status: l.status,
    provider: l.provider,
    connected: l.connected,
    expiresAt: l.expiresAt,
    createdAt: l.createdAt,
    registered: l.registered ?? false,
    qualityRating: l.qualityRating ?? null,
    wabaPhoneNumberId: l.wabaPhoneNumberId,
    wabaId: l.wabaId,
    verifyToken: l.verifyToken,
    tokenMask: l.accessToken ? maskSecret(l.accessToken.replace(/^enc:v1:/, "")) : null,
    webhookUrl: l.provider === "cloud" ? CLOUD_WEBHOOK_URL : null,
  };
}

// GET /api/wa/lines — líneas del usuario con su estado (según DB; el webhook lo mantiene).
waRouter.get("/lines", async (req, res) => {
  const lines = await prisma.waLine.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: "asc" },
  });
  return res.json({ lines: lines.map(toPublicLine) });
});

const createSchema = z.object({
  label: z.string().min(1).max(60).optional(),
  phone: z.string().min(6).max(20).optional(),
  provider: z.enum(["baileys", "cloud"]).default("baileys"),
  // Cloud API (CTWA):
  wabaPhoneNumberId: z.string().min(3).max(40).optional(),
  wabaId: z.string().min(3).max(40).optional(),
  accessToken: z.string().min(20).max(1000).optional(),
  verifyToken: z.string().min(4).max(120).optional(),
});

// POST /api/wa/lines — crea la línea. Baileys: instancia en Evolution + QR.
// Cloud: guarda credenciales (token cifrado) y queda lista para el webhook de Meta.
waRouter.post("/lines", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Input inválido", details: parsed.error.flatten() });
  }
  const { label, phone, provider, wabaPhoneNumberId, wabaId, accessToken, verifyToken } = parsed.data;
  const userId = req.userId!;

  // Paywall: conectar un número requiere días. Sin crédito, le pedimos pagar.
  const days = await getAvailableDays(userId);
  if (days < 1) {
    return res.status(402).json({
      error: "Necesitás días para conectar un número. Comprá días en Créditos para activar tu línea.",
      code: "NEEDS_CREDITS",
    });
  }
  // Límite de líneas del plan (configurable por cliente desde el panel).
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { maxLines: true } });
  const lineCount = await prisma.waLine.count({ where: { userId } });
  if (lineCount >= (me?.maxLines ?? 1)) {
    return res.status(403).json({
      error: `Alcanzaste el límite de líneas de tu plan (${me?.maxLines ?? 1}). Escribinos para ampliarlo.`,
      code: "LINE_LIMIT",
    });
  }

  // --- Línea Cloud API oficial (CTWA) ---
  if (provider === "cloud") {
    if (!wabaPhoneNumberId || !accessToken || !verifyToken) {
      return res.status(400).json({ error: "Faltan datos de la Cloud API (Phone Number ID, Access Token y Verify Token)" });
    }
    const line = await prisma.waLine.create({
      data: {
        userId: req.userId!,
        label,
        phone: phone ?? "",
        provider: "cloud",
        status: "active",
        connected: true,
        wabaPhoneNumberId,
        wabaId,
        accessToken: encryptSecret(accessToken),
        verifyToken,
      },
    });
    // La línea Cloud queda activa de inmediato: arranca el contador (consume 1 día / 24h).
    await consumeDayAndActivate(userId, line.id, line.label);
    const fresh = await prisma.waLine.findUnique({ where: { id: line.id } });
    return res.status(201).json({ line: toPublicLine(fresh ?? line), webhookUrl: CLOUD_WEBHOOK_URL });
  }

  // --- Línea Baileys (QR/Evolution) ---
  const line = await prisma.waLine.create({
    data: { userId: req.userId!, label, phone: phone ?? "", status: "inactive" },
  });
  const instanceName = `line_${line.id}`;

  try {
    const qr = await createInstance(instanceName);
    const updated = await prisma.waLine.update({ where: { id: line.id }, data: { sessionId: instanceName } });
    if (qr.base64) emitToUser(req.userId!, "wa:qr", { lineId: line.id, qr: qr.base64 });
    return res.status(201).json({ line: toPublicLine(updated), qr: qr.base64 ?? null });
  } catch (e) {
    // Si Evolution falla, no dejamos la línea huérfana.
    await prisma.waLine.delete({ where: { id: line.id } }).catch(() => undefined);
    const message = e instanceof Error ? e.message : String(e);
    console.error("[wa/lines create] error:", message);
    return res.status(502).json({ error: "No se pudo crear la instancia en Evolution", detail: message });
  }
});

// GET /api/wa/cloud/config — datos públicos para lanzar el Embedded Signup en el front.
// (Nunca incluye el app secret.)
waRouter.get("/cloud/config", (_req, res) => {
  res.json({
    appId: process.env.META_APP_ID ?? null,
    configId: process.env.META_ES_CONFIG_ID ?? null,
    graphVersion: GRAPH_VERSION,
  });
});

const connectSchema = z.object({
  code: z.string().min(10).max(4000),
  phoneNumberId: z.string().min(3).max(40).optional(),
  wabaId: z.string().min(3).max(40).optional(),
  label: z.string().max(60).optional(),
  phone: z.string().max(20).optional(),
});

// POST /api/wa/cloud/connect — cierra el Embedded Signup usando SOLO el `code`:
// intercambia el code por token, resuelve la WABA (debug_token) y el número
// (phone_numbers), suscribe la app al webhook, registra el número y crea la línea.
// No depende del postMessage del popup (phoneNumberId/wabaId son best-effort).
waRouter.post("/cloud/connect", async (req, res) => {
  const parsed = connectSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Input inválido", details: parsed.error.flatten() });
  }
  const { code, label } = parsed.data;
  let wabaId = parsed.data.wabaId;
  let phoneNumberId = parsed.data.phoneNumberId;
  let phone = parsed.data.phone;
  try {
    const token = await exchangeCodeForToken(code);

    // a) Resolver la WABA desde el token si no vino del front.
    if (!wabaId) {
      const { wabaIds } = await debugToken(token);
      if (wabaIds.length === 0) {
        return res.status(409).json({
          error: "La cuenta de WhatsApp se conectó en Meta pero todavía no se comparte con la app. Esperá unos segundos y tocá Reintentar.",
        });
      }
      wabaId = wabaIds[0];
    }

    // b) Resolver el número de la WABA: el id si falta, y SIEMPRE el display_phone_number
    //    si no tenemos el teléfono (aunque el phone_number_id ya haya venido del front).
    if (!phoneNumberId || !phone) {
      const numbers = await getWabaPhoneNumbers(wabaId, token);
      if (numbers.length === 0) {
        if (!phoneNumberId) {
          return res.status(409).json({
            error: "La cuenta no tiene número verificado todavía. Reintentá en unos segundos.",
          });
        }
        // Tenemos el id pero no pudimos listar números: seguimos sin teléfono mostrable.
      } else {
        const chosen = (phoneNumberId ? numbers.find((n) => n.id === phoneNumberId) : undefined) ?? numbers[0];
        if (!phoneNumberId) phoneNumberId = chosen.id;
        if (!phone && chosen.display_phone_number) phone = chosen.display_phone_number.replace(/\D/g, "");
      }
    }

    // c) Suscribir la app al webhook de la WABA.
    await subscribeWaba(wabaId, token);

    // d) Crear la línea cloud con un PIN de registro (cifrado en reposo).
    const pin = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    const line = await prisma.waLine.create({
      data: {
        userId: req.userId!,
        label: label ?? "WhatsApp oficial",
        phone: phone ?? "",
        provider: "cloud",
        status: "active",
        connected: true,
        wabaPhoneNumberId: phoneNumberId,
        wabaId,
        accessToken: encryptSecret(token),
        registerPin: encryptSecret(pin),
        verifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? null,
      },
    });

    // e) Registrar el número en la Cloud API (saca la línea de "Pendiente").
    //    Best-effort: si falla (ej. falta método de pago en la WABA) se reintenta desde el panel.
    const reg = await registerCloudNumber(phoneNumberId, token, pin);
    if (reg.ok) await prisma.waLine.update({ where: { id: line.id }, data: { registered: true } });
    const fresh = await prisma.waLine.findUnique({ where: { id: line.id } });
    return res.status(201).json({ line: toPublicLine(fresh ?? line), registered: reg.ok, registerError: reg.error });
  } catch (e) {
    if (axios.isAxiosError(e)) {
      console.error("[wa/cloud/connect] Graph error", e.response?.status, JSON.stringify(e.response?.data));
      const detail = e.response?.data?.error?.message ?? e.message;
      return res.status(502).json({ error: "No se pudo conectar la cuenta de WhatsApp", detail });
    }
    const message = e instanceof Error ? e.message : String(e);
    console.error("[wa/cloud/connect] error:", message);
    return res.status(502).json({ error: "No se pudo conectar la cuenta de WhatsApp", detail: message });
  }
});

// Helper: busca la línea del usuario o responde 404.
async function getOwnedLine(userId: string, id: string) {
  return prisma.waLine.findFirst({ where: { id, userId } });
}

// POST /api/wa/lines/:id/register — reintenta el registro del número en la Cloud API
// (saca la línea de "Pendiente" en el WhatsApp Manager). Devuelve el resultado real de Meta.
waRouter.post("/lines/:id/register", async (req, res) => {
  const line = await getOwnedLine(req.userId!, req.params.id);
  if (!line) return res.status(404).json({ error: "Línea no encontrada" });
  if (line.provider !== "cloud") return res.status(400).json({ error: "El registro solo aplica a líneas Cloud API" });
  if (!line.wabaPhoneNumberId || !line.accessToken) {
    return res.status(400).json({ error: "La línea Cloud no está configurada (falta Phone Number ID o token)" });
  }

  const token = decryptSecret(line.accessToken);
  // Reusa el PIN guardado o genera uno nuevo (y lo persiste cifrado).
  let pin: string;
  if (line.registerPin) {
    pin = decryptSecret(line.registerPin);
  } else {
    pin = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    await prisma.waLine.update({ where: { id: line.id }, data: { registerPin: encryptSecret(pin) } });
  }

  const reg = await registerCloudNumber(line.wabaPhoneNumberId, token, pin);
  if (reg.ok) await prisma.waLine.update({ where: { id: line.id }, data: { registered: true } });
  const fresh = await prisma.waLine.findUnique({ where: { id: line.id } });
  return res.status(reg.ok ? 200 : 502).json({
    registered: reg.ok,
    error: reg.ok ? undefined : reg.error,
    line: fresh ? toPublicLine(fresh) : undefined,
  });
});

// POST /api/wa/lines/:id/subscribe — (re)suscribe NUESTRA app al webhook de la WABA del
// cliente. Sin esta suscripción los mensajes entrantes nunca llegan al webhook/Inbox.
waRouter.post("/lines/:id/subscribe", async (req, res) => {
  const line = await getOwnedLine(req.userId!, req.params.id);
  if (!line) return res.status(404).json({ error: "Línea no encontrada" });
  if (line.provider !== "cloud") return res.status(400).json({ error: "Solo aplica a líneas Cloud API" });
  if (!line.wabaId || !line.accessToken) {
    return res.status(400).json({ error: "La línea Cloud no está configurada (falta WABA ID o token)" });
  }
  const token = decryptSecret(line.accessToken);
  try {
    await subscribeWaba(line.wabaId, token);
    const apps = await getSubscribedApps(line.wabaId, token);
    return res.json({ subscribed: apps.length > 0, apps });
  } catch (e) {
    if (axios.isAxiosError(e)) {
      console.error("[wa/lines/subscribe] Graph error", e.response?.status, JSON.stringify(e.response?.data));
      return res.status(502).json({ subscribed: false, error: e.response?.data?.error?.message ?? e.message });
    }
    const message = e instanceof Error ? e.message : String(e);
    console.error("[wa/lines/subscribe] error:", message);
    return res.status(502).json({ subscribed: false, error: message });
  }
});

// POST /api/wa/lines/:id/connect — devuelve el QR (o, si mandás `number`, un pairing code
// de 8 caracteres para vincular por número). El QR se emite por socket.
waRouter.post("/lines/:id/connect", async (req, res) => {
  const line = await getOwnedLine(req.userId!, req.params.id);
  if (!line) return res.status(404).json({ error: "Línea no encontrada" });
  const instanceName = line.sessionId ?? `line_${line.id}`;
  const number = typeof req.body?.number === "string" ? req.body.number.replace(/\D/g, "") : "";

  try {
    const qr = await connectInstance(instanceName, number || undefined);
    if (qr.base64) emitToUser(req.userId!, "wa:qr", { lineId: line.id, qr: qr.base64 });
    return res.json({ qr: qr.base64 ?? null, pairingCode: qr.pairingCode ?? null });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return res.status(502).json({ error: "No se pudo iniciar la conexión", detail: message });
  }
});

// POST /api/wa/lines/:id/reset — reinicia una línea Baileys trabada (se desconectó varias
// veces / quedó en "connecting"): cierra sesión, borra la instancia y la recrea limpia.
waRouter.post("/lines/:id/reset", async (req, res) => {
  const line = await getOwnedLine(req.userId!, req.params.id);
  if (!line) return res.status(404).json({ error: "Línea no encontrada" });
  if (line.provider !== "baileys") return res.status(400).json({ error: "El reinicio aplica a líneas por QR (Baileys)" });
  const instanceName = line.sessionId ?? `line_${line.id}`;
  try {
    await logoutInstance(instanceName);
    await deleteInstance(instanceName);
    const qr = await createInstance(instanceName);
    await prisma.waLine.update({
      where: { id: line.id },
      data: { sessionId: instanceName, connected: false, status: "inactive" },
    });
    if (qr.base64) emitToUser(req.userId!, "wa:qr", { lineId: line.id, qr: qr.base64 });
    return res.json({ ok: true, qr: qr.base64 ?? null });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[wa/lines/reset] error:", message);
    return res.status(502).json({ error: "No se pudo reiniciar la conexión", detail: message });
  }
});

// GET /api/wa/lines/:id/status — estado en vivo desde Evolution; sincroniza la DB.
waRouter.get("/lines/:id/status", async (req, res) => {
  const line = await getOwnedLine(req.userId!, req.params.id);
  if (!line) return res.status(404).json({ error: "Línea no encontrada" });
  const instanceName = line.sessionId ?? `line_${line.id}`;

  const state = await connectionState(instanceName);
  const connected = state === "open";
  // Al conectar, capturamos el número del WhatsApp vinculado (para armar los wa.me).
  let phone = line.phone;
  if (connected && !phone) phone = await fetchOwnerNumber(instanceName);
  const updated = await prisma.waLine.update({
    where: { id: line.id },
    data: { connected, status: connected ? "active" : line.status, ...(phone ? { phone } : {}) },
  });
  return res.json({
    state,
    connected,
    line: { id: updated.id, status: updated.status, phone: updated.phone },
  });
});

const activateSchema = z.object({ days: z.number().int().positive().max(365) });

// POST /api/wa/lines/:id/activate — consume N días del crédito y extiende expiresAt.
// 1 día = 24h de línea activa (en rotación). Si ya tenía tiempo, se le suma.
waRouter.post("/lines/:id/activate", async (req, res) => {
  const parsed = activateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Input inválido", details: parsed.error.flatten() });
  }
  const { days } = parsed.data;
  const line = await getOwnedLine(req.userId!, req.params.id);
  if (!line) return res.status(404).json({ error: "Línea no encontrada" });

  const credit = await prisma.credit.findUnique({ where: { userId: req.userId! } });
  if (!credit || credit.days < days) {
    return res.status(402).json({ error: "No te alcanzan los días disponibles", have: credit?.days ?? 0 });
  }

  // Base: si la línea aún tiene tiempo, sumamos sobre eso; si no, desde ahora.
  const now = new Date();
  const base = line.expiresAt && line.expiresAt > now ? line.expiresAt : now;
  const expiresAt = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);

  const [updatedLine] = await prisma.$transaction([
    prisma.waLine.update({ where: { id: line.id }, data: { expiresAt, status: "active" } }),
    prisma.credit.update({
      where: { id: credit.id },
      data: {
        days: { decrement: days },
        ledger: { create: { delta: -days, reason: `activación línea ${line.label ?? line.id}` } },
      },
    }),
  ]);

  return res.json({
    line: { id: updatedLine.id, status: updatedLine.status, expiresAt: updatedLine.expiresAt },
    creditDays: credit.days - days,
  });
});

// POST /api/wa/lines/:id/pause — saca la línea de rotación (status=paused) sin desconectar.
waRouter.post("/lines/:id/pause", async (req, res) => {
  const line = await getOwnedLine(req.userId!, req.params.id);
  if (!line) return res.status(404).json({ error: "Línea no encontrada" });
  const updated = await prisma.waLine.update({ where: { id: line.id }, data: { status: "paused" } });
  return res.json({ line: { id: updated.id, status: updated.status } });
});

// POST /api/wa/lines/:id/resume — vuelve a rotación (status=active).
waRouter.post("/lines/:id/resume", async (req, res) => {
  const line = await getOwnedLine(req.userId!, req.params.id);
  if (!line) return res.status(404).json({ error: "Línea no encontrada" });
  const updated = await prisma.waLine.update({ where: { id: line.id }, data: { status: "active" } });
  return res.json({ line: { id: updated.id, status: updated.status } });
});

// POST /api/wa/lines/:id/logout — desvincula el teléfono (sin borrar la línea).
waRouter.post("/lines/:id/logout", async (req, res) => {
  const line = await getOwnedLine(req.userId!, req.params.id);
  if (!line) return res.status(404).json({ error: "Línea no encontrada" });
  await logoutInstance(line.sessionId ?? `line_${line.id}`);
  const updated = await prisma.waLine.update({
    where: { id: line.id },
    data: { connected: false, status: "inactive" },
  });
  return res.json({ ok: true, line: { id: updated.id, status: updated.status } });
});

// DELETE /api/wa/lines/:id — borra la instancia y la línea.
waRouter.delete("/lines/:id", async (req, res) => {
  const line = await getOwnedLine(req.userId!, req.params.id);
  if (!line) return res.status(404).json({ error: "Línea no encontrada" });
  try {
    if (line.provider !== "cloud") await deleteInstance(line.sessionId ?? `line_${line.id}`);
    // Orden por las FKs: mensajes (lineId obligatorio) -> soltar contactos -> línea.
    await prisma.message.deleteMany({ where: { lineId: line.id } });
    await prisma.contact.updateMany({ where: { lineId: line.id }, data: { lineId: null } });
    await prisma.waLine.delete({ where: { id: line.id } });
    return res.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[wa/lines delete] error:", message);
    return res.status(500).json({ error: "No se pudo borrar la línea", detail: message });
  }
});
