import { describe, it, expect, vi, beforeEach } from "vitest";

// "Si el cliente no responde en 10 u 11 min, le mandamos la secuencia igual" (dueño, 2026-09-22).
// Lo delicado no es esperar: es NO mandar la secuencia dos veces cuando el cliente contesta justo
// al vencer el plazo. Eso sí parece un bot y quema la línea.
const prismaMock = vi.hoisted(() => ({
  flowRun: { findUnique: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })), update: vi.fn(async () => ({})), findFirst: vi.fn() },
  flow: { findFirst: vi.fn() },
  contact: { findUnique: vi.fn(), update: vi.fn() },
  message: { count: vi.fn(async () => 0) },
  user: { findUnique: vi.fn() },
}));
vi.mock("./prisma.js", () => ({ prisma: prismaMock }));
vi.mock("./wa-send.js", () => ({ sendToContact: vi.fn(async () => true) }));
vi.mock("./wa-image.js", () => ({ sendImageToContact: vi.fn(async () => true) }));
vi.mock("./queue.js", () => ({ scheduleFlowResume: vi.fn() }));
vi.mock("./leadgen-send.js", () => ({ parseVariants: vi.fn(() => []), pickVariant: vi.fn(() => null), sendLeadVariant: vi.fn(async () => true) }));
vi.mock("./lead-template.js", () => ({ renderLeadReply: vi.fn((t: string) => t) }));
vi.mock("./keyed-lock.js", () => ({ runExclusive: vi.fn(async (_k: string, fn: () => Promise<void>) => fn()) }));
vi.mock("./io.js", () => ({ emitToUser: vi.fn() }));

import { resumeIfStillWaiting } from "./flow-engine.js";

beforeEach(() => vi.clearAllMocks());

describe("vencimiento del paso esperar respuesta", () => {
  it("si el contacto NO contestó, sigue la secuencia", async () => {
    prismaMock.flowRun.findUnique.mockResolvedValueOnce({ id: "r1", status: "waiting", cursor: "3", contactId: "c1", stepIndex: 0, flowId: "f1", flow: { id: "f1", userId: "u1", steps: [] } } as never);
    prismaMock.flowRun.updateMany.mockResolvedValueOnce({ count: 1 } as never);
    prismaMock.flow.findFirst.mockResolvedValue(null as never);
    await resumeIfStillWaiting("r1", "3");
    // Tomó el run (lo pasó a "running") antes de seguir.
    expect(prismaMock.flowRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "r1", status: "waiting", cursor: "3" }, data: { status: "running" } }),
    );
  });

  it("si el contacto YA contestó (el run dejó de estar esperando), NO hace nada", async () => {
    prismaMock.flowRun.findUnique.mockResolvedValueOnce({ id: "r1", status: "running", cursor: "3", contactId: "c1", stepIndex: 0, flowId: "f1", flow: { id: "f1", userId: "u1", steps: [] } } as never);
    await resumeIfStillWaiting("r1", "3");
    expect(prismaMock.flowRun.updateMany).not.toHaveBeenCalled();
  });

  it("si el flujo ya avanzó a otro paso, NO hace nada", async () => {
    prismaMock.flowRun.findUnique.mockResolvedValueOnce({ id: "r1", status: "waiting", cursor: "7", contactId: "c1", stepIndex: 0, flowId: "f1", flow: { id: "f1", userId: "u1", steps: [] } } as never);
    await resumeIfStillWaiting("r1", "3");
    expect(prismaMock.flowRun.updateMany).not.toHaveBeenCalled();
  });

  it("si el flujo ya terminó, NO hace nada", async () => {
    prismaMock.flowRun.findUnique.mockResolvedValueOnce({ id: "r1", status: "done", cursor: "3", contactId: "c1", stepIndex: 0, flowId: "f1", flow: { id: "f1", userId: "u1", steps: [] } } as never);
    await resumeIfStillWaiting("r1", "3");
    expect(prismaMock.flowRun.updateMany).not.toHaveBeenCalled();
  });

  it("si el run ya no existe, no rompe", async () => {
    prismaMock.flowRun.findUnique.mockResolvedValueOnce(null as never);
    await expect(resumeIfStillWaiting("r1", "3")).resolves.toBeUndefined();
  });

  it("dos vencimientos a la vez: sólo UNO sigue (el segundo pierde el claim)", async () => {
    prismaMock.flowRun.findUnique.mockResolvedValue({ id: "r1", status: "waiting", cursor: "3", contactId: "c1", stepIndex: 0, flowId: "f1", flow: { id: "f1", userId: "u1", steps: [] } } as never);
    prismaMock.flow.findFirst.mockResolvedValue(null as never);
    prismaMock.flowRun.updateMany
      .mockResolvedValueOnce({ count: 1 } as never)  // el primero gana
      .mockResolvedValueOnce({ count: 0 } as never); // el segundo llega tarde
    await resumeIfStillWaiting("r1", "3");
    await resumeIfStillWaiting("r1", "3");
    expect(prismaMock.flowRun.updateMany).toHaveBeenCalledTimes(2); // los dos intentaron tomarlo
    // Sólo el que ganó el claim siguió: 2 lecturas del guard + 1 de la reanudación real = 3.
    // Si los dos hubieran seguido serían 4, y el cliente recibiría la secuencia dos veces.
    expect(prismaMock.flowRun.findUnique).toHaveBeenCalledTimes(3);
  });
});
