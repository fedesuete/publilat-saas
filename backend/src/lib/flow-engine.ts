// Motor de automatizaciones/secuencias (tipo ManyChat) con RAMIFICACIÓN.
// Pasos: message | delay | wait_reply | menu (opciones numeradas que ramifican).
// El menú se envía como texto con opciones 1️⃣ 2️⃣ 3️⃣ (compatible Baileys y Cloud);
// el cliente responde con el número o una palabra clave y sigue esa rama.
// La posición en el árbol se guarda en FlowRun.cursor: "2" o "2:1:0" (paso:opción:subpaso).
import { prisma } from "./prisma.js";
import { sendToContact } from "./wa-send.js";
import { scheduleFlowResume } from "./queue.js";
import { parseVariants, pickVariant, sendLeadVariant } from "./leadgen-send.js";
import { renderLeadReply } from "./lead-template.js";

// ---- Bienvenida automática de líneas QR (waQrWelcomeEnabled + waQrWelcomeReplies) ----
// Al PRIMER mensaje de un contacto NUEVO se manda UNA variante al azar (texto o audio). Dedup en dos
// capas: (1) claim ATÓMICO de la etapa NUEVO→CONTACTADO (dos mensajes rápidos seguidos no duplican:
// solo uno gana el updateMany), y (2) si el contacto ya tiene ALGÚN saliente (le hablaste vos desde
// el celu o el panel) no se manda nada. Best-effort: jamás rompe el procesamiento del inbound.
async function maybeSendQrWelcome(userId: string, contactId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { waQrWelcomeEnabled: true, waQrWelcomeReplies: true },
  });
  if (!user?.waQrWelcomeEnabled) return;
  const variants = parseVariants(user.waQrWelcomeReplies);
  if (!variants.length) return;
  // Si hay un FLOW de bienvenida activo (trigger first_message), manda el flow y esta bienvenida
  // simple se calla — así el contacto NUNCA recibe las dos. Apagando el flow, esta vuelve sola.
  const flowActivo = await prisma.flow.findFirst({
    where: { userId, enabled: true, trigger: "first_message" },
    select: { id: true },
  });
  if (flowActivo) return;

  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { id: true, name: true, stage: true, lineId: true },
  });
  if (!contact?.lineId || contact.stage !== "NUEVO") return;
  // ¿Ya le hablamos alguna vez (panel, celu, tanda)? Entonces no es un contacto "por estrenar".
  const prevOut = await prisma.message.findFirst({ where: { contactId, direction: "out" }, select: { id: true } });
  if (prevOut) return;
  // Claim atómico: solo UN inbound gana el derecho a dar la bienvenida.
  const claimed = await prisma.contact.updateMany({
    where: { id: contactId, stage: "NUEVO" },
    data: { stage: "CONTACTADO" },
  });
  if (claimed.count !== 1) return;

  const variant = pickVariant(variants)!;
  const text = variant.kind === "text"
    ? renderLeadReply(variant.body, { name: contact.name, phone: null, email: null, answers: [] })
    : undefined;
  const ok = await sendLeadVariant(userId, contactId, variant, text).catch(() => false);
  if (!ok) {
    // No salió (línea caída, cupo de warmup): soltamos el claim para que el próximo mensaje reintente.
    await prisma.contact.updateMany({ where: { id: contactId, stage: "CONTACTADO" }, data: { stage: "NUEVO" } }).catch(() => undefined);
    console.warn(`[qr-welcome] no se pudo enviar la bienvenida al contacto ${contactId}`);
    return;
  }
  console.log(`[qr-welcome] bienvenida (${variant.kind}) enviada al contacto ${contactId}`);
}

export interface FlowOption {
  id: string;
  label: string;        // texto visible de la opción
  keywords?: string[];  // palabras que también la seleccionan (además del número/label)
  steps: FlowStep[];    // rama que sigue si elige esta opción
}

export interface FlowStep {
  id: string;
  type: "message" | "delay" | "wait_reply" | "menu" | "link" | "set_stage" | "audio";
  text?: string;          // message, menu (encabezado) y link (mensaje que acompaña)
  alts?: string[];        // message: VARIANTES extra — se manda UNA al azar entre text y alts
                          // (mensajes idénticos en masa = patrón que WhatsApp detecta como bot)
  minutes?: number;       // delay
  options?: FlowOption[]; // menu
  url?: string;           // link: destino real
  urlLabel?: string;      // link: texto del "botón"
  stage?: string;         // set_stage: NUEVO | CONTACTADO | INTERESADO | PERDIDO
  clipIds?: string[];     // audio: biblioteca de audios — se manda UNO al azar (copia única por envío)
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
      // Rotación: una variante al azar entre el texto principal y las alternativas.
      const pool = [step.text, ...(step.alts ?? [])].filter((t): t is string => Boolean(t && t.trim()));
      if (pool.length) await sendToContact(userId, run.contactId, pool[Math.floor(Math.random() * pool.length)]);
      cursor = cursorWith(cursor, pos.index + 1);
      await prisma.flowRun.update({ where: { id: run.id }, data: { cursor, status: "running" } });
    } else if (step.type === "audio") {
      // Audio de la biblioteca: uno al azar del pool; el envío sale con copia única (uniquifyAudio).
      const clips = (step.clipIds ?? []).filter(Boolean);
      if (clips.length) {
        const clipId = clips[Math.floor(Math.random() * clips.length)];
        await sendLeadVariant(userId, run.contactId, { kind: "audio", clipId }).catch((e) =>
          console.error("[flow] audio no enviado:", e instanceof Error ? e.message : String(e)));
      }
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
    // Bienvenida automática de líneas QR (independiente de los flows; con su propio dedup).
    await maybeSendQrWelcome(userId, contactId).catch((e) =>
      console.error("[qr-welcome] error:", e instanceof Error ? e.message : String(e)));
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
      let match: boolean;
      if (f.trigger === "keyword") {
        match = !!f.keyword && low.includes(f.keyword.toLowerCase());
      } else {
        // first_message: contacto que nunca entró a una secuencia Y al que NUNCA le escribimos
        // (sin salientes previos). Sin la 2ª condición, prender el flow le mandaba la "bienvenida"
        // a contactos VIEJOS con charlas de meses en su próximo mensaje — desastre asegurado.
        match = !anyRun;
        if (match) {
          const prevOut = await prisma.message.findFirst({ where: { contactId, direction: "out" }, select: { id: true } });
          match = !prevOut;
        }
      }
      if (!match) continue;
      const run = await prisma.flowRun.create({ data: { flowId: f.id, contactId, cursor: "0", status: "running" } });
      await resumeFlowRun(run.id);
      return;
    }
  } catch (e) {
    console.error("[flow] onInboundFlow error:", e instanceof Error ? e.message : String(e));
  }
}
