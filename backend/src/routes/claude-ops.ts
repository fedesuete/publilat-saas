// Worker de Claude (server del casino) ⇄ pedidos "C-" del grupo SOPORTE. Ver lib/claude-ops.ts.
// Bearer CLAUDE_OPS_SECRET; sin la variable, 503. El worker pregunta cada pocos segundos (no hay puerto abierto del otro lado).
import { Router } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { tomarTarea, cerrarVuelta, avisarAlGrupo } from "../lib/claude-ops.js";

export const claudeOpsRouter = Router();

function autorizado(header: string | undefined): boolean | null {
  const secreto = process.env.CLAUDE_OPS_SECRET;
  if (!secreto) return null;
  const got = Buffer.from(String(header ?? "").replace(/^Bearer\s+/i, ""));
  const exp = Buffer.from(secreto);
  return got.length === exp.length && crypto.timingSafeEqual(got, exp);
}

claudeOpsRouter.use((req, res, next) => {
  const ok = autorizado(req.headers.authorization);
  if (ok === null) return res.status(503).json({ error: "no configurado" });
  if (!ok) return res.status(401).json({ error: "no autorizado" });
  next();
});

claudeOpsRouter.post("/tomar", async (_req, res) => {
  try {
    res.json({ tarea: await tomarTarea() });
  } catch (e) {
    console.error("[claude-ops] tomar:", e instanceof Error ? e.message : String(e));
    res.status(500).json({ error: "no se pudo tomar" });
  }
});

// 2026-10-30: avisos sueltos del server del casino al grupo SOPORTE (cargas y retiros de soporte247).
const Aviso = z.object({ texto: z.string().min(1).max(4000) });

claudeOpsRouter.post("/aviso", async (req, res) => {
  const b = Aviso.safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: "datos inválidos" });
  try {
    const ok = await avisarAlGrupo(b.data.texto);
    res.status(ok ? 200 : 503).json({ ok });
  } catch (e) {
    console.error("[claude-ops] aviso:", e instanceof Error ? e.message : String(e));
    res.status(502).json({ error: "no salió el aviso" });
  }
});

const Cierre = z.object({
  id: z.string().min(1).max(64),
  fase: z.enum(["consulta", "ejecucion"]),
  estado: z.enum(["esperando_ok", "hecho", "necesita_info", "error"]),
  texto: z.string().min(1).max(20_000),
  claudeSession: z.string().max(200).nullable().optional(),
});

claudeOpsRouter.post("/cerrar", async (req, res) => {
  const b = Cierre.safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: "datos inválidos" });
  try {
    const ok = await cerrarVuelta(b.data.id, b.data.fase, b.data.estado, b.data.texto, b.data.claudeSession ?? null);
    res.status(ok ? 200 : 404).json({ ok });
  } catch (e) {
    console.error("[claude-ops] cerrar:", e instanceof Error ? e.message : String(e));
    res.status(500).json({ error: "no se pudo cerrar" });
  }
});
