import { describe, it, expect, vi, beforeEach } from "vitest";

// (1) Un envío que falla NO avanza el flujo: se reintenta (23/09: la línea estaba caída, la
//     bienvenida salió y audio/imagen/texto fallaron; el motor avanzó igual y 3 personas quedaron
//     solo con el "hola").
// (2) Paso "silence" (recontacto): si el contacto no escribe en N horas, sigue; si escribe, termina.
const prismaMock = vi.hoisted(() => ({
  flowRun: { findUnique: vi.fn(), update: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 1 })), findFirst: vi.fn() },
  flow: { findMany: vi.fn(async () => []), findFirst: vi.fn() },
  contact: { findUnique: vi.fn(async () => ({ source: null })), update: vi.fn() },
  message: { count: vi.fn(async () => 0) },
  user: { findUnique: vi.fn(async () => null) },
}));
const sendMock = vi.hoisted(() => ({ sendToContact: vi.fn(async () => true) }));
const queueMock = vi.hoisted(() => ({ scheduleFlowResume: vi.fn() }));
vi.mock("./prisma.js", () => ({ prisma: prismaMock }));
vi.mock("./wa-send.js", () => sendMock);
vi.mock("./wa-image.js", () => ({ sendImageToContact: vi.fn(async () => true) }));
vi.mock("./queue.js", () => queueMock);
vi.mock("./leadgen-send.js", () => ({ parseVariants: vi.fn(() => []), pickVariant: vi.fn(() => null), sendLeadVariant: vi.fn(async () => true) }));
vi.mock("./lead-template.js", () => ({ renderLeadReply: vi.fn((t: string) => t) }));
vi.mock("./keyed-lock.js", () => ({ runExclusive: vi.fn(async (_k: string, fn: () => Promise<void>) => fn()) }));
vi.mock("./io.js", () => ({ emitToUser: vi.fn() }));

import { resumeFlowRun, resumeIfStillWaiting, onInboundFlow, olvidarReintentos, FLOW_RETRY_MAX, FLOW_RETRY_SEC } from "./flow-engine.js";

const run = (steps: unknown[], cursor = "0", status = "running") =>
  ({ id: "r1", flowId: "f1", contactId: "c1", stepIndex: 0, cursor, status, flow: { id: "f1", userId: "u1", steps } });

beforeEach(() => {
  vi.clearAllMocks();
  olvidarReintentos("r1");
});

describe("reintento cuando un envío falla", () => {
  it("si el mensaje no sale, el flujo NO avanza y se programa un reintento", async () => {
    prismaMock.flowRun.findUnique.mockResolvedValue(run([{ id: "a", type: "message", text: "hola" }]) as never);
    sendMock.sendToContact.mockResolvedValueOnce(false as never);
    await resumeFlowRun("r1");
    expect(queueMock.scheduleFlowResume).toHaveBeenCalledWith("r1", FLOW_RETRY_SEC);
    // No avanzó el cursor ni cerró el flujo.
    expect(prismaMock.flowRun.update).not.toHaveBeenCalled();
  });

  it("cuando el envío sale, avanza y termina", async () => {
    prismaMock.flowRun.findUnique.mockResolvedValue(run([{ id: "a", type: "message", text: "hola" }]) as never);
    await resumeFlowRun("r1");
    expect(queueMock.scheduleFlowResume).not.toHaveBeenCalled();
    expect(prismaMock.flowRun.update).toHaveBeenCalledWith(expect.objectContaining({ data: { cursor: "1", status: "running" } }));
    expect(prismaMock.flowRun.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "done", cursor: "1" } }));
  });

  it("tras agotar los reintentos, sigue con el próximo paso (no se cuelga para siempre)", async () => {
    prismaMock.flowRun.findUnique.mockResolvedValue(run([{ id: "a", type: "message", text: "hola" }]) as never);
    sendMock.sendToContact.mockResolvedValue(false as never);
    for (let i = 0; i < FLOW_RETRY_MAX; i++) await resumeFlowRun("r1");
    expect(queueMock.scheduleFlowResume).toHaveBeenCalledTimes(FLOW_RETRY_MAX);
    expect(prismaMock.flowRun.update).not.toHaveBeenCalled();
    await resumeFlowRun("r1"); // el intento 13 se da por perdido y avanza
    expect(prismaMock.flowRun.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "done", cursor: "1" } }));
  });

  it("un envío que lanza error cuenta como fallido (reintento), no como enviado", async () => {
    prismaMock.flowRun.findUnique.mockResolvedValue(run([{ id: "a", type: "message", text: "hola" }]) as never);
    sendMock.sendToContact.mockRejectedValueOnce(new Error("422") as never);
    await resumeFlowRun("r1");
    expect(queueMock.scheduleFlowResume).toHaveBeenCalledWith("r1", FLOW_RETRY_SEC);
    expect(prismaMock.flowRun.update).not.toHaveBeenCalled();
  });
});

describe("paso silence (recontacto si no responde)", () => {
  const pasos = [{ id: "s", type: "silence", minutes: 1200 }, { id: "m", type: "message", text: "¿Pudiste ver los precios?" }];

  it("queda esperando 20 h y programa la reanudación con el cursor (guarda anti-doble)", async () => {
    prismaMock.flowRun.findUnique.mockResolvedValue(run(pasos) as never);
    await resumeFlowRun("r1");
    expect(prismaMock.flowRun.update).toHaveBeenCalledWith(expect.objectContaining({ data: { cursor: "1", status: "waiting" } }));
    expect(queueMock.scheduleFlowResume).toHaveBeenCalledWith("r1", 1200 * 60, "1");
    expect(sendMock.sendToContact).not.toHaveBeenCalled();
  });

  it("si NO responde: al vencer, manda el recontacto", async () => {
    prismaMock.flowRun.findUnique.mockResolvedValue(run(pasos, "1", "waiting") as never);
    await resumeIfStillWaiting("r1", "1");
    expect(sendMock.sendToContact).toHaveBeenCalledWith("u1", "c1", "¿Pudiste ver los precios?");
  });

  it("si RESPONDE durante el silencio: el flujo termina y NO se manda el recontacto", async () => {
    prismaMock.flowRun.findFirst
      .mockResolvedValueOnce(null as never) // no hay menú esperando
      .mockResolvedValueOnce(run(pasos, "1", "waiting") as never); // sí hay un silence esperando
    await onInboundFlow("u1", "c1", "hola, me interesa");
    expect(prismaMock.flowRun.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "done" } }));
    expect(sendMock.sendToContact).not.toHaveBeenCalled();
    expect(prismaMock.flowRun.findUnique).not.toHaveBeenCalled(); // no se reanudó
  });

  it("una respuesta durante un 'esperar respuesta' común SÍ reanuda (no cambia lo de siempre)", async () => {
    const comun = [{ id: "w", type: "wait_reply" }, { id: "m", type: "message", text: "seguimos" }];
    prismaMock.flowRun.findFirst
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(run(comun, "1", "waiting") as never);
    prismaMock.flowRun.findUnique.mockResolvedValue(run(comun, "1", "running") as never);
    await onInboundFlow("u1", "c1", "hola");
    expect(sendMock.sendToContact).toHaveBeenCalledWith("u1", "c1", "seguimos");
  });
});
