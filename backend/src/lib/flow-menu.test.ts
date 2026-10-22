import { describe, it, expect, vi, beforeEach } from "vitest";

// Menú de la bienvenida (22/10): el cliente responde 1/2/3 y sigue la rama. Si escribe otra cosa, el menú se
// reenvía UNA sola vez; a la segunda el flujo se cierra (antes se reenviaba con cada mensaje y pisaba la charla).
const prismaMock = vi.hoisted(() => ({
  flowRun: { findUnique: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })), update: vi.fn(async () => ({})), findFirst: vi.fn(), create: vi.fn() },
  flow: { findFirst: vi.fn(), findMany: vi.fn(async () => []) },
  contact: { findUnique: vi.fn(async () => ({ source: "wa" })), update: vi.fn() },
  message: { count: vi.fn(async () => 0) },
  user: { findUnique: vi.fn() },
}));
const sendToContact = vi.hoisted(() => vi.fn(async () => true));
vi.mock("./prisma.js", () => ({ prisma: prismaMock }));
vi.mock("./wa-send.js", () => ({ sendToContact }));
vi.mock("./wa-image.js", () => ({ sendImageToContact: vi.fn(async () => true) }));
vi.mock("./queue.js", () => ({ scheduleFlowResume: vi.fn() }));
vi.mock("./leadgen-send.js", () => ({ parseVariants: vi.fn(() => []), pickVariant: vi.fn(() => null), sendLeadVariant: vi.fn(async () => true) }));
vi.mock("./lead-template.js", () => ({ renderLeadReply: vi.fn((t: string) => t) }));
vi.mock("./keyed-lock.js", () => ({ runExclusive: vi.fn(async (_k: string, fn: () => Promise<void>) => fn()) }));
vi.mock("./io.js", () => ({ emitToUser: vi.fn() }));

const { onInboundFlow } = await import("./flow-engine.js");

const menu = {
  id: "m", type: "menu", menuRaw: true, text: "Hola! Te paso las 3 cosas…\n\n¿Cuál te sirve?",
  options: [{ id: "o1", label: "Plataforma propia", steps: [] }, { id: "o2", label: "Solo fichas", steps: [] }, { id: "o3", label: "Gestiona tus anuncios", steps: [] }],
};
const run = (status: string) => ({ id: "r1", status, cursor: "0", contactId: "c1", flowId: "f1", flow: { id: "f1", userId: "u1", steps: [menu] } });

beforeEach(() => vi.clearAllMocks());

describe("menú de la bienvenida", () => {
  it("respuesta que no es una opción: reenvía el texto TAL CUAL una vez y marca el reenvío", async () => {
    prismaMock.flowRun.findFirst.mockResolvedValueOnce(run("waiting_option") as never);
    await onInboundFlow("u1", "c1", "hola, cómo es?");
    expect(sendToContact).toHaveBeenCalledWith("u1", "c1", menu.text);
    expect(prismaMock.flowRun.update).toHaveBeenCalledWith({ where: { id: "r1" }, data: { status: "waiting_option_r" } });
  });

  it("segunda respuesta que no es una opción: NO reenvía y cierra el flujo", async () => {
    prismaMock.flowRun.findFirst.mockResolvedValueOnce(run("waiting_option_r") as never);
    await onInboundFlow("u1", "c1", "¿cuánto sale?");
    expect(sendToContact).not.toHaveBeenCalled();
    expect(prismaMock.flowRun.update).toHaveBeenCalledWith({ where: { id: "r1" }, data: { status: "done" } });
  });

  it("después del reenvío, un '2' todavía elige la opción 2", async () => {
    prismaMock.flowRun.findFirst.mockResolvedValueOnce(run("waiting_option_r") as never);
    prismaMock.flowRun.findUnique.mockResolvedValue(null as never);
    await onInboundFlow("u1", "c1", "2");
    expect(prismaMock.flowRun.update).toHaveBeenCalledWith({ where: { id: "r1" }, data: { cursor: "0:1:0", status: "running" } });
  });
});
