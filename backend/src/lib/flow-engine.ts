// Motor de automatizaciones/secuencias (tipo ManyChat) con RAMIFICACIÓN.
// Pasos: message | delay | wait_reply | menu (opciones numeradas que ramifican).
// El menú se envía como texto con opciones 1️⃣ 2️⃣ 3️⃣ (compatible Baileys y Cloud);
// el cliente responde con el número o una palabra clave y sigue esa rama.
// La posición en el árbol se guarda en FlowRun.cursor: "2" o "2:1:0" (paso:opción:subpaso).
import { prisma } from "./prisma.js";
import { sendToContact } from "./wa-send.js";
import { scheduleFlowResume } from "./queue.js";

export interface FlowOption {
  id: string;
  label: string;        // texto visible de la opción
  keywords?: string[];  // palabras que también la seleccionan (además del número/label)
  steps: FlowStep[];    // rama que sigue si elige esta opción
}

export interface FlowStep {
  id: string;
  type: "message" | "delay" | "wait_reply" | "menu" | "link" | "set_stage";
  text?: string;          // message, menu (encabezado) y link (mensaje que acompaña)
  minutes?: number;       // delay
  options?: FlowOption[]; // menu
  url?: string;           // link: destino real
  urlLabel?: string;      // link: texto del "botón"
  stage?: string;         // set_stage: NUEVO | CONTACTADO | INTERESADO | PERDIDO
}

const NUM_EMOJI = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"];

function stepsOf(raw: unknown): FlowStep[] {
  return Array.isArray(raw) ? (raw as FlowStep[]) : [];
}

// Devuelve la lista de pasos en la que vive el cursor y el índice local.
// cursor "2:1:0" => root[2].options[1].steps, índice 0. Null si el camino no existe.
function resolveCursor(root: FlowStep[], cursor: string): { list: FlowStep[]; index: number } | null {
  const parts = cursor.split(":").map((n) => parseInt(n, 10));
  if (parts.some((n) => Number.isNaN(n) || n < 0)) return null;
  let list = root;
  // Los pares (paso, opción) van descendiendo; el último número es el índice local.
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const step = list[parts[i]];
    const opt = step?.options?.[parts[i + 1]];
    if (!opt) return null;
    list = opt.steps ?? [];
  }
  return { list, index: parts[parts.length - 1] };
}

const cursorWith = (cursor: string, index: number): string => {
  const parts = cursor.split(":");
  parts[parts.length - 1] = String(index);
  return parts.join(":");
};

// Texto del menú: encabezado + opciones numeradas + ayuda.
function renderMenu(step: FlowStep): string {
  const opts = (step.options ?? []).slice(0, 9);
  const lines = opts.map((o, i) => `${NUM_EMOJI[i] ?? `${i + 1}.`} ${o.label}`);
  return [step.text ?? "Elegí una opción:", "", ...lines, "", "Respondé con el número de la opción 👆"].join("\n");
}

// Matchea la respuesta del cliente contra las opciones (número, label o keyword).
function matchOption(step: FlowStep, text: string): number | null {
  const opts = step.options ?? [];
  const t = (text || "").trim().toLowerCase();
  if (!t) return null;
  const num = t.match(/^\s*(\d)\b/);
  if (num) {
    const i = parseInt(num[1], 10) - 1;
    if (i >= 0 && i < opts.length) return i;
  }
  for (let i = 0; i < opts.length; i++) {
    const o = opts[i];
    if (o.label && t.includes(o.label.toLowerCase())) return i;
    for (const k of o.keywords ?? []) {
      if (k && t.includes(k.toLowerCase())) return i;
    }
  }
  return null;
}

// Ejecuta desde el cursor hasta la próxima pausa (delay/wait_reply/menu) o el final.
export async function resumeFlowRun(runId: string): Promise<void> {
  const run = await prisma.flowRun.findUnique({ where: { id: runId }, include: { flow: true } });
  if (!run || run.status === "done") return;
  const root = stepsOf(run.flow.steps);
  const userId = run.flow.userId;

  // Compat: runs lineales viejos sin cursor real siguen desde stepIndex.
  let cursor = run.cursor || "0";
  if (cursor === "0" && run.stepIndex > 0 && !cursor.includes(":")) cursor = String(run.stepIndex);

  for (let guard = 0; guard < 60; guard++) {
    const pos = resolveCursor(root, cursor);
    if (!pos || pos.index >= pos.list.length) {
      await prisma.flowRun.update({ where: { id: run.id }, data: { status: "done", cursor } });
      return;
    }
    const step = pos.list[pos.index];

    if (step.type === "message") {
      if (step.text) await sendToContact(userId, run.contactId, step.text);
      cursor = cursorWith(cursor, pos.index + 1);
      await prisma.flowRun.update({ where: { id: run.id }, data: { cursor, status: "running" } });
    } else if (step.type === "link") {
      // "Botón" con link medible: creamos un link rastreado ÚNICO para este contacto
      // y lo mandamos en el mensaje. El clic se registra en GET /r/:code (CTR por paso).
      if (step.url) {
        const tl = await prisma.trackedLink.create({
          data: { userId, flowId: run.flowId, stepId: step.id, contactId: run.contactId, url: step.url, label: step.urlLabel ?? null },
        });
        const base = (process.env.APP_BASE_URL ?? "").replace(/\/$/, "");
        const shortUrl = `${base}/r/${tl.id}`;
        const body = [step.text, "", `👉 ${step.urlLabel ?? "Abrir link"}: ${shortUrl}`].filter((x) => x !== undefined && x !== null).join("\n").trim();
        await sendToContact(userId, run.contactId, body);
      }
      cursor = cursorWith(cursor, pos.index + 1);
      await prisma.flowRun.update({ where: { id: run.id }, data: { cursor, status: "running" } });
    } else if (step.type === "set_stage") {
      // Acción CRM: mueve al contacto de etapa (COMPRO queda excluido: eso va con monto).
      const allowed = ["NUEVO", "CONTACTADO", "INTERESADO", "PERDIDO"] as const;
      const stage = allowed.find((s) => s === step.stage);
      if (stage) {
        await prisma.contact.update({ where: { id: run.contactId }, data: { stage } }).catch(() => undefined);
      }
      cursor = cursorWith(cursor, pos.index + 1);
      await prisma.flowRun.update({ where: { id: run.id }, data: { cursor, status: "running" } });
    } else if (step.type === "delay") {
      cursor = cursorWith(cursor, pos.index + 1);
      await prisma.flowRun.update({ where: { id: run.id }, data: { cursor, status: "running" } });
      scheduleFlowResume(run.id, Math.max(1, Math.round((step.minutes ?? 1) * 60)));
      return;
    } else if (step.type === "wait_reply") {
      cursor = cursorWith(cursor, pos.index + 1);
      await prisma.flowRun.update({ where: { id: run.id }, data: { cursor, status: "waiting" } });
      return;
    } else if (step.type === "menu") {
      await sendToContact(userId, run.contactId, renderMenu(step));
      // Queda esperando la elección; el cursor apunta AL menú (no al siguiente).
      cursor = cursorWith(cursor, pos.index);
      await prisma.flowRun.update({ where: { id: run.id }, data: { cursor, status: "waiting_option" } });
      return;
    } else {
      cursor = cursorWith(cursor, pos.index + 1);
      await prisma.flowRun.update({ where: { id: run.id }, data: { cursor } });
    }
  }
  // guard agotado (flujo absurdo de largo): lo cerramos para no loopear.
  await prisma.flowRun.update({ where: { id: run.id }, data: { status: "done" } });
}

// Se llama por cada mensaje ENTRANTE.
export async function onInboundFlow(userId: string, contactId: string, text: string): Promise<void> {
  try {
    // 1) ¿Esperando la elección de un menú?
    const waitingOpt = await prisma.flowRun.findFirst({
      where: { contactId, status: "waiting_option" },
      orderBy: { updatedAt: "desc" },
      include: { flow: true },
    });
    if (waitingOpt) {
      const root = stepsOf(waitingOpt.flow.steps);
      const pos = resolveCursor(root, waitingOpt.cursor);
      const step = pos && pos.index < pos.list.length ? pos.list[pos.index] : null;
      if (step?.type === "menu") {
        const chosen = matchOption(step, text);
        if (chosen == null) {
          // No entendimos: reenviamos el menú una vez y seguimos esperando.
          await sendToContact(userId, contactId, renderMenu(step));
          return;
        }
        // Desciende a la rama elegida: cursor = "<pasoMenu>:<opción>:0"
        const branchCursor = `${waitingOpt.cursor}:${chosen}:0`;
        await prisma.flowRun.update({ where: { id: waitingOpt.id }, data: { cursor: branchCursor, status: "running" } });
        await resumeFlowRun(waitingOpt.id);
        return;
      }
      // Estado inconsistente: cerramos el run.
      await prisma.flowRun.update({ where: { id: waitingOpt.id }, data: { status: "done" } });
      return;
    }

    // 2) ¿Esperando una respuesta libre (wait_reply)?
    const waiting = await prisma.flowRun.findFirst({ where: { contactId, status: "waiting" }, orderBy: { updatedAt: "desc" } });
    if (waiting) {
      await prisma.flowRun.update({ where: { id: waiting.id }, data: { status: "running" } });
      await resumeFlowRun(waiting.id);
      return;
    }

    // 3) ¿Ya hay una secuencia en curso? No arrancar otra.
    const active = await prisma.flowRun.findFirst({ where: { contactId, status: "running" } });
    if (active) return;

    // 4) Buscar una secuencia habilitada que dispare.
    const anyRun = await prisma.flowRun.findFirst({ where: { contactId } });
    const flows = await prisma.flow.findMany({ where: { userId, enabled: true }, orderBy: { createdAt: "asc" } });
    const low = (text || "").toLowerCase();
    for (const f of flows) {
      const match = f.trigger === "keyword"
        ? !!f.keyword && low.includes(f.keyword.toLowerCase())
        : !anyRun; // first_message: solo si el contacto nunca entró a una secuencia
      if (!match) continue;
      const run = await prisma.flowRun.create({ data: { flowId: f.id, contactId, cursor: "0", status: "running" } });
      await resumeFlowRun(run.id);
      return;
    }
  } catch (e) {
    console.error("[flow] onInboundFlow error:", e instanceof Error ? e.message : String(e));
  }
}
