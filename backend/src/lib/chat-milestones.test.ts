import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./prisma.js", () => ({
  prisma: {
    chatConversation: { findFirst: vi.fn(), update: vi.fn(async () => ({})) },
    chatMessage: { findFirst: vi.fn(), create: vi.fn() },
  },
}));
vi.mock("./io.js", () => ({ emitChat: vi.fn() }));

import { prisma } from "./prisma.js";
import { emitChat } from "./io.js";
import { postPlayerMilestone } from "./chat-milestones.js";

const p = prisma as unknown as {
  chatConversation: { findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  chatMessage: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  p.chatConversation.findFirst.mockResolvedValue({ id: "conv-1" });
  p.chatConversation.update.mockResolvedValue({});
  p.chatMessage.findFirst.mockResolvedValue(null);
  p.chatMessage.create.mockResolvedValue({ id: "m1", senderType: "system", body: "x", metadata: { kind: "push_on" }, createdAt: new Date() });
});

describe("postPlayerMilestone", () => {
  it("primera vez: crea mensaje system con metadata.kind, actualiza la conversación y emite al operador", async () => {
    await postPlayerMilestone("u1", "pl1", "push_on", "🔔 El cliente activó las notificaciones de la app");
    expect(p.chatMessage.create).toHaveBeenCalledOnce();
    const data = p.chatMessage.create.mock.calls[0][0].data;
    expect(data.senderType).toBe("system");
    expect(data.metadata).toEqual({ kind: "push_on" });
    expect(p.chatConversation.update).toHaveBeenCalledOnce();
    expect(emitChat).toHaveBeenCalledWith("chat:u1", "chat:message", expect.objectContaining({ conversationId: "conv-1" }));
  });

  it("repetido (mismo kind ya en el hilo): NO crea otro mensaje ni emite", async () => {
    p.chatMessage.findFirst.mockResolvedValue({ id: "ya-existe" });
    await postPlayerMilestone("u1", "pl1", "push_on", "🔔 ...");
    expect(p.chatMessage.create).not.toHaveBeenCalled();
    expect(emitChat).not.toHaveBeenCalled();
  });

  it("jugador sin conversación: no-op silencioso", async () => {
    p.chatConversation.findFirst.mockResolvedValue(null);
    await postPlayerMilestone("u1", "pl1", "app_installed", "📲 ...");
    expect(p.chatMessage.create).not.toHaveBeenCalled();
  });

  it("si prisma explota, NUNCA rechaza (best-effort: no rompe el subscribe)", async () => {
    p.chatConversation.findFirst.mockRejectedValue(new Error("db caída"));
    await expect(postPlayerMilestone("u1", "pl1", "push_on", "x")).resolves.toBeUndefined();
  });
});
