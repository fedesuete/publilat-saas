// Gestión de líneas de WhatsApp (Fase 2). Protegido por requireAuth.
// Crea instancias en Evolution, expone QR (socket + respuesta) y estado de conexión.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { emitToUser } from "../lib/io.js";
import {
  createInstance,
  connectInstance,
  connectionState,
  fetchOwnerNumber,
  logoutInstance,
  deleteInstance,
} from "../lib/evolution.js";

export const waRouter = Router();

// GET /api/wa/lines — líneas del usuario con su estado (según DB; el webhook lo mantiene).
waRouter.get("/lines", async (req, res) => {
  const lines = await prisma.waLine.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      phone: true,
      label: true,
      status: true,
      connected: true,
      expiresAt: true,
      createdAt: true,
    },
  });
  return res.json({ lines });
});

const createSchema = z.object({
  label: z.string().min(1).max(60).optional(),
  phone: z.string().min(6).max(20).optional(),
});

// POST /api/wa/lines — crea la línea + la instancia en Evolution. Devuelve el QR inicial.
waRouter.post("/lines", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Input inválido", details: parsed.error.flatten() });
  }
  const { label, phone } = parsed.data;

  // Creamos la fila primero para tener el id que da nombre a la instancia.
  const line = await prisma.waLine.create({
    data: { userId: req.userId!, label, phone: phone ?? "", status: "inactive" },
  });
  const instanceName = `line_${line.id}`;

  try {
    const qr = await createInstance(instanceName);
    await prisma.waLine.update({ where: { id: line.id }, data: { sessionId: instanceName } });
    if (qr.base64) emitToUser(req.userId!, "wa:qr", { lineId: line.id, qr: qr.base64 });
    return res.status(201).json({ line: { ...line, sessionId: instanceName }, qr: qr.base64 ?? null });
  } catch (e) {
    // Si Evolution falla, no dejamos la línea huérfana.
    await prisma.waLine.delete({ where: { id: line.id } }).catch(() => undefined);
    const message = e instanceof Error ? e.message : String(e);
    console.error("[wa/lines create] error:", message);
    return res.status(502).json({ error: "No se pudo crear la instancia en Evolution", detail: message });
  }
});

// Helper: busca la línea del usuario o responde 404.
async function getOwnedLine(userId: string, id: string) {
  return prisma.waLine.findFirst({ where: { id, userId } });
}

// POST /api/wa/lines/:id/connect — devuelve el QR para escanear (y lo emite por socket).
waRouter.post("/lines/:id/connect", async (req, res) => {
  const line = await getOwnedLine(req.userId!, req.params.id);
  if (!line) return res.status(404).json({ error: "Línea no encontrada" });
  const instanceName = line.sessionId ?? `line_${line.id}`;

  try {
    const qr = await connectInstance(instanceName);
    if (qr.base64) emitToUser(req.userId!, "wa:qr", { lineId: line.id, qr: qr.base64 });
    return res.json({ qr: qr.base64 ?? null, pairingCode: qr.pairingCode ?? null });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return res.status(502).json({ error: "No se pudo obtener el QR", detail: message });
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
    await deleteInstance(line.sessionId ?? `line_${line.id}`);
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
