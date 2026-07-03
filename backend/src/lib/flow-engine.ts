// Motor de automatizaciones/secuencias (MVP lineal): mensaje -> delay -> esperar respuesta.
// Se dispara con el primer mensaje del contacto o por palabra clave. Los delays usan BullMQ.
import { prisma } from "./prisma.js";
import { sendToContact } from "./wa-send.js";
import { scheduleFlowResume } from "./queue.js";

export interface FlowStep {
  id: string;
  type: "message" | "delay" | "wait_reply";
  text?: string;    // para message
  minutes?: number; // para delay
}

function stepsOf(raw: unknown): FlowStep[] {
  return Array.isArray(raw) ? (raw as FlowStep[]) : [];
}

// Ejecuta la secuencia desde run.stepIndex hasta el próximo pause (delay/wait_reply) o el final.
export async function resumeFlowRun(runId: string): Promise<void> {
  const run = await prisma.flowRun.findUnique({ where: { id: runId }, include: { flow: true } });
  if (!run || run.status === "done") return;
  const steps = stepsOf(run.flow.steps);
  const userId = run.flow.userId;
  let i = run.stepIndex;

  while (i < steps.length) {
    const step = steps[i];
    if (step.type === "message") {
      if (step.text) await sendToContact(userId, run.contactId, step.text);
      i++;
      await prisma.flowRun.update({ where: { id: run.id }, data: { stepIndex: i } });
    } else if (step.type === "delay") {
      i++;
      await prisma.flowRun.update({ where: { id: run.id }, data: { stepIndex: i, status: "running" } });
      const sec = Math.max(1, Math.round((step.minutes ?? 1) * 60));
      scheduleFlowResume(run.id, sec);
      return; // pausa hasta que dispare el job
    } else if (step.type === "wait_reply") {
      i++;
      await prisma.flowRun.update({ where: { id: run.id }, data: { stepIndex: i, status: "waiting" } });
      return; // pausa hasta el próximo mensaje entrante
    } else {
      i++;
    }
  }
  await prisma.flowRun.update({ where: { id: run.id }, data: { status: "done" } });
}

// Se llama por cada mensaje ENTRANTE: resume una secuencia en espera o arranca una nueva.
export async function onInboundFlow(userId: string, contactId: string, text: string): Promise<void> {
  try {
    // 1) ¿Hay una secuencia esperando respuesta? -> continuarla con este mensaje.
    const waiting = await prisma.flowRun.findFirst({ where: { contactId, status: "waiting" }, orderBy: { updatedAt: "desc" } });
    if (waiting) {
      await prisma.flowRun.update({ where: { id: waiting.id }, data: { status: "running" } });
      await resumeFlowRun(waiting.id);
      return;
    }
    // 2) ¿Ya hay una secuencia en curso? No arrancar otra.
    const active = await prisma.flowRun.findFirst({ where: { contactId, status: "running" } });
    if (active) return;

    // 3) Buscar una secuencia habilitada que dispare.
    const anyRun = await prisma.flowRun.findFirst({ where: { contactId } });
    const flows = await prisma.flow.findMany({ where: { userId, enabled: true }, orderBy: { createdAt: "asc" } });
    const low = (text || "").toLowerCase();
    for (const f of flows) {
      const match = f.trigger === "keyword"
        ? !!f.keyword && low.includes(f.keyword.toLowerCase())
        : !anyRun; // first_message: solo si el contacto nunca entró a una secuencia
      if (!match) continue;
      const run = await prisma.flowRun.create({ data: { flowId: f.id, contactId, stepIndex: 0, status: "running" } });
      await resumeFlowRun(run.id);
      return;
    }
  } catch (e) {
    console.error("[flow] onInboundFlow error:", e instanceof Error ? e.message : String(e));
  }
}
