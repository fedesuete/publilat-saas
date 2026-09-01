// Puente Chat App ↔ bot cajero externo (combatwin/mijoker). Cubre las dos direcciones:
// entrada (forwardChatToBot: payload sintético Evolution-like, gateado por env) y salida
// (postBotChatMessage: postea en la conversación SOLO con el puente prendido; sombra = log).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { prismaMock, emitChatMock, resolvePixelMock, sendCapiMock } = vi.hoisted(() => ({
  prismaMock: {
    chatPlayer: { findUnique: vi.fn(), update: vi.fn() },
    chatConversation: { findFirst: vi.fn(), update: vi.fn() },
    chatMessage: { create: vi.fn() },
    metaEvent: { create: vi.fn().mockResolvedValue({ id: "me1" }), update: vi.fn().mockResolvedValue({}) },
  },
  emitChatMock: vi.fn(),
  resolvePixelMock: vi.fn(),
  sendCapiMock: vi.fn(),
}));
vi.mock("./prisma.js", () => ({ prisma: prismaMock }));
vi.mock("./io.js", () => ({ emitChat: (...a: unknown[]) => emitChatMock(...a) }));
vi.mock("./pixel.js", () => ({ resolveUserPixel: (...a: unknown[]) => resolvePixelMock(...a) }));
vi.mock("./meta-capi.js", () => ({ sendCapiEvent: (...a: unknown[]) => sendCapiMock(...a) }));

import { parseChatPlayerRef, chatInstance, forwardChatToBot, postBotChatMessage, updateChatPlayerUsername, fireChatBridgePurchase } from "./chat-bridge.js";

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

  it("incluye el usuario y la clave que la app YA le mostró al jugador, para que el bot lo reconozca", () => {
    process.env.BOT_CHAT_FORWARD = JSON.stringify({ acc1: "https://bot/webhook" });
    forwardChatToBot("acc1", "p1", { text: "hola", chatUsername: "pepe1234rb", chatPassword: "123456", pushName: "Pepe" });
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, { body: string }])[1].body);
    expect(body.data.chatUsername).toBe("pepe1234rb");
    expect(body.data.chatPassword).toBe("123456");
    expect(body.data.pushName).toBe("Pepe");
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

describe("updateChatPlayerUsername (sync del username definitivo que creó el bot)", () => {
  it("actualiza el casinoUsername del jugador (el web* provisional pasa a ser el real)", async () => {
    prismaMock.chatPlayer.update.mockResolvedValue({ id: "p1" });
    const r = await updateChatPlayerUsername("chat:p1", "maxi1234rb");
    expect(r.ok).toBe(true);
    expect(prismaMock.chatPlayer.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "p1" }, data: expect.objectContaining({ casinoUsername: "maxi1234rb" }) }),
    );
  });

  it("ref inválido o username vacío: skipped sin tocar nada", async () => {
    expect(await updateChatPlayerUsername("5492944679040", "x")).toMatchObject({ ok: false });
    expect(await updateChatPlayerUsername("chat:p1", "")).toMatchObject({ ok: false });
    expect(prismaMock.chatPlayer.update).not.toHaveBeenCalled();
  });

  it("username tomado o jugador inexistente (P2002/P2025): no explota", async () => {
    prismaMock.chatPlayer.update.mockRejectedValue(new Error("Unique constraint failed"));
    const r = await updateChatPlayerUsername("chat:p1", "maxi1234rb");
    expect(r.ok).toBe(false);
  });
});

describe("fireChatBridgePurchase (Purchase CAPI de cargas del canal chat)", () => {
  const player = {
    id: "p1", userId: "acc1", casinoUsername: "maxi1234rb",
    fbp: "fb.1.111.222", fbc: null, fbclid: "CLID123", clientIp: "190.1.2.3", userAgent: "Mozilla/5.0",
  };

  it("dispara Purchase con el pixel de la cuenta, external_id=username y la atribución guardada", async () => {
    prismaMock.chatPlayer.findUnique.mockResolvedValue(player);
    resolvePixelMock.mockResolvedValue({ pixelId: "px1", capiToken: "tok1" });
    sendCapiMock.mockResolvedValue({ pixelId: "px1", payload: {}, response: {} });
    const r = await fireChatBridgePurchase("chat:p1", 15000, "ARS");
    expect(r.ok).toBe(true);
    const arg = sendCapiMock.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.eventName).toBe("Purchase");
    expect(arg.externalId).toBe("maxi1234rb");
    expect(arg.value).toBe(15000);
    expect(arg.currency).toBe("ARS");
    expect(arg.fbp).toBe("fb.1.111.222");
    expect(String(arg.fbc)).toContain("CLID123"); // fbc derivada del fbclid guardado
    expect(arg.clientIp).toBe("190.1.2.3");
    expect(arg.userAgent).toBe("Mozilla/5.0");
    expect(arg.pixelId).toBe("px1");
    expect(prismaMock.metaEvent.create).toHaveBeenCalled(); // visible en analytics
  });

  it("eventId único por carga (Meta cuenta cada una, sin dedup entre cargas)", async () => {
    prismaMock.chatPlayer.findUnique.mockResolvedValue(player);
    resolvePixelMock.mockResolvedValue({ pixelId: "px1", capiToken: "tok1" });
    sendCapiMock.mockResolvedValue({ pixelId: "px1", payload: {}, response: {} });
    await fireChatBridgePurchase("chat:p1", 1000, "ARS");
    await fireChatBridgePurchase("chat:p1", 2000, "ARS");
    const ids = sendCapiMock.mock.calls.map((c) => (c[0] as { eventId: string }).eventId);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("ref inválido, monto inválido o jugador inexistente → skipped sin CAPI", async () => {
    expect(await fireChatBridgePurchase("5492944679040", 1000, "ARS")).toMatchObject({ ok: false });
    expect(await fireChatBridgePurchase("chat:p1", 0, "ARS")).toMatchObject({ ok: false });
    prismaMock.chatPlayer.findUnique.mockResolvedValue(null);
    expect(await fireChatBridgePurchase("chat:nope", 1000, "ARS")).toMatchObject({ ok: false, skipped: "no_player" });
    expect(sendCapiMock).not.toHaveBeenCalled();
  });

  it("fallo del CAPI: marca el MetaEvent failed y no explota", async () => {
    prismaMock.chatPlayer.findUnique.mockResolvedValue(player);
    resolvePixelMock.mockResolvedValue({ pixelId: "px1", capiToken: "tok1" });
    sendCapiMock.mockRejectedValue(new Error("boom"));
    const r = await fireChatBridgePurchase("chat:p1", 1000, "ARS");
    expect(r.ok).toBe(false);
    expect(prismaMock.metaEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) }),
    );
  });
});
