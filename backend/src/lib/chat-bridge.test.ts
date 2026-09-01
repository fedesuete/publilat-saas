// Puente Chat App ↔ bot cajero externo (combatwin/mijoker). Cubre las dos direcciones:
// entrada (forwardChatToBot: payload sintético Evolution-like, gateado por env) y salida
// (postBotChatMessage: postea en la conversación SOLO con el puente prendido; sombra = log).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { prismaMock, emitChatMock } = vi.hoisted(() => ({
  prismaMock: {
    chatPlayer: { findUnique: vi.fn() },
    chatConversation: { findFirst: vi.fn(), update: vi.fn() },
    chatMessage: { create: vi.fn() },
  },
  emitChatMock: vi.fn(),
}));
vi.mock("./prisma.js", () => ({ prisma: prismaMock }));
vi.mock("./io.js", () => ({ emitChat: (...a: unknown[]) => emitChatMock(...a) }));

import { parseChatPlayerRef, chatInstance, forwardChatToBot, postBotChatMessage } from "./chat-bridge.js";

const fetchMock = vi.fn().mockResolvedValue({ ok: true });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.BOT_CHAT_FORWARD;
});

describe("parseChatPlayerRef", () => {
  it("extrae el chatPlayerId de un ref chat:<id>", () => {
    expect(parseChatPlayerRef("chat:abc123")).toBe("abc123");
  });
  it("rechaza teléfonos reales y refs vacíos", () => {
    expect(parseChatPlayerRef("5492944679040")).toBeNull();
    expect(parseChatPlayerRef("chat:")).toBeNull();
    expect(parseChatPlayerRef("")).toBeNull();
  });
});

describe("chatInstance", () => {
  it("arma la instancia sintética por cuenta", () => {
    expect(chatInstance("acc1")).toBe("publilat-chat-acc1");
  });
});

describe("forwardChatToBot (entrada)", () => {
  it("no hace nada sin BOT_CHAT_FORWARD (apagado por default)", () => {
    forwardChatToBot("acc1", "p1", { text: "hola" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("no hace nada si la cuenta no está en el mapa", () => {
    process.env.BOT_CHAT_FORWARD = JSON.stringify({ otra: "https://bot/webhook" });
    forwardChatToBot("acc1", "p1", { text: "hola" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("manda el payload sintético Evolution-like con instance y phone de chat", () => {
    process.env.BOT_CHAT_FORWARD = JSON.stringify({ acc1: "https://bot/webhook?token=x" });
    forwardChatToBot("acc1", "p1", { text: "quiero cargar", msgId: "m1", pushName: "Juan" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(url).toBe("https://bot/webhook?token=x");
    const body = JSON.parse(init.body);
    expect(body.instance).toBe("publilat-chat-acc1");
    expect(body.data.key.senderPn).toBe("chat:p1");
    expect(body.data.key.remoteJid).toBe("chat:p1");
    expect(body.data.key.fromMe).toBe(false);
    expect(body.data.message.conversation).toBe("quiero cargar");
    expect(body.data.pushName).toBe("Juan");
  });

  it("manda comprobantes como imageMessage + mediaBase64", () => {
    process.env.BOT_CHAT_FORWARD = JSON.stringify({ acc1: "https://bot/webhook" });
    forwardChatToBot("acc1", "p1", { mediaBase64: "QUJD", mediaMimetype: "image/jpeg", text: "va el compro" });
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, { body: string }])[1].body);
    expect(body.data.message.imageMessage).toBeTruthy();
    expect(body.data.message.imageMessage.caption).toBe("va el compro");
    expect(body.data.mediaBase64).toBe("QUJD");
    expect(body.data.mediaMimetype).toBe("image/jpeg");
  });

  it("BOT_CHAT_FORWARD mal formado = no-op (no tira)", () => {
    process.env.BOT_CHAT_FORWARD = "{roto";
    expect(() => forwardChatToBot("acc1", "p1", { text: "hola" })).not.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("postBotChatMessage (salida)", () => {
  const player = (flags: { chatBotBridge: boolean; chatBotBridgeShadow: boolean }) => ({
    id: "p1", userId: "acc1", user: flags,
  });

  it("puente ON: postea en la conversación y emite en vivo a jugador y operador", async () => {
    prismaMock.chatPlayer.findUnique.mockResolvedValue(player({ chatBotBridge: true, chatBotBridgeShadow: false }));
    prismaMock.chatConversation.findFirst.mockResolvedValue({ id: "conv1" });
    prismaMock.chatMessage.create.mockResolvedValue({ id: "m1", senderType: "system", body: "hola!", createdAt: new Date() });
    prismaMock.chatConversation.update.mockResolvedValue({});
    const r = await postBotChatMessage("chat:p1", "hola!");
    expect(r.ok).toBe(true);
    expect(prismaMock.chatMessage.create).toHaveBeenCalledTimes(1);
    const rooms = emitChatMock.mock.calls.map((c) => c[0]);
    expect(rooms).toContain("chat:acc1:player:p1");
    expect(rooms).toContain("chat:acc1");
  });

  it("SOMBRA: no postea nada, devuelve shadow (solo log)", async () => {
    prismaMock.chatPlayer.findUnique.mockResolvedValue(player({ chatBotBridge: false, chatBotBridgeShadow: true }));
    const r = await postBotChatMessage("chat:p1", "hola!");
    expect(r).toMatchObject({ ok: true, shadow: true });
    expect(prismaMock.chatMessage.create).not.toHaveBeenCalled();
    expect(emitChatMock).not.toHaveBeenCalled();
  });

  it("puente APAGADO: no postea (skipped)", async () => {
    prismaMock.chatPlayer.findUnique.mockResolvedValue(player({ chatBotBridge: false, chatBotBridgeShadow: false }));
    const r = await postBotChatMessage("chat:p1", "hola!");
    expect(r).toMatchObject({ ok: true, skipped: "bridge_off" });
    expect(prismaMock.chatMessage.create).not.toHaveBeenCalled();
  });

  it("ref inválido o jugador inexistente: skipped, sin explotar", async () => {
    expect(await postBotChatMessage("5492944679040", "x")).toMatchObject({ ok: false, skipped: "bad_ref" });
    prismaMock.chatPlayer.findUnique.mockResolvedValue(null);
    expect(await postBotChatMessage("chat:nope", "x")).toMatchObject({ ok: false, skipped: "no_player" });
    expect(prismaMock.chatMessage.create).not.toHaveBeenCalled();
  });
});
