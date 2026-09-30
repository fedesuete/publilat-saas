// Segundo webhook de WAHA, SOLO para la sesión del número de soporte: recibe los mismos eventos que
// el webhook principal pero acá se miran únicamente los GRUPOS (el principal los descarta a propósito
// y NO se toca, §9.6). Es un oyente aparte: si esto falla, WhatsApp, el Inbox y la atribución siguen
// exactamente igual. Ver lib/soporte-relay.ts.
import { Router } from "express";
import crypto from "node:crypto";
import { onEventoDeGrupo } from "../lib/soporte-relay.js";

export const soporteWaRouter = Router();

function tokenOk(got: string, expected: string): boolean {
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

soporteWaRouter.post("/", async (req, res) => {
  // Misma firma por token que el webhook principal: manda mensajes desde el número de soporte, así
  // que sin token en producción se cierra.
  const expected = process.env.EVOLUTION_WEBHOOK_TOKEN;
  if (!expected) {
    if (process.env.NODE_ENV === "production") return res.status(503).json({ error: "webhook no configurado" });
  } else if (!tokenOk(typeof req.query.token === "string" ? req.query.token : "", expected)) {
    return res.status(401).json({ error: "token inválido" });
  }
  res.json({ ok: true }); // rápido y siempre 200: WAHA reintenta si no

  try {
    const body = req.body ?? {};
    const event = typeof body.event === "string" ? body.event : "";
    const session = typeof body.session === "string" ? body.session : "";
    if (!session || (event !== "message" && event !== "message.any")) return;
    await onEventoDeGrupo(session, body.payload ?? {});
  } catch (e) {
    console.error("[soporte-wa]", e instanceof Error ? e.message : String(e));
  }
});
