import { describe, it, expect, vi, beforeEach } from "vitest";

// Cuentas/líneas manejadas por el bot cajero de un socio (env BOT_FORWARD = {"<lineId>":url} o
// {"user:<userId>":url}). Para ellas el Purchase lo avisa el BOT al acreditar (bot-relay /purchase),
// así que el OCR del inbox NO debe disparar Purchase solo (duplicaba y leía mal la moneda).
const prismaMock = vi.hoisted(() => ({
  contact: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(async () => ({})) },
  message: { count: vi.fn(async () => 0) },
}));
vi.mock("./prisma.js", () => ({ prisma: prismaMock }));
vi.mock("./io.js", () => ({ emitToUser: vi.fn() }));
vi.mock("./evolution.js", () => ({ getMediaBase64: vi.fn(async () => null) }));
vi.mock("./ai-receipt.js", () => ({
  aiEnabled: () => true,
  analyzeReceipt: vi.fn(async () => ({ isReceipt: true, amount: 5000, currency: "ARS", confidence: 0.95, senderName: "Juan Perez" })),
}));
vi.mock("./purchase.js", () => ({ markPurchase: vi.fn(async () => ({ ok: true })), accountCurrency: vi.fn(async () => "ARS") }));

import { markPurchase } from "./purchase.js";
import { botForwardScope, isBotManaged, findBotRelayContact } from "./bot-managed.js";
import { detectPayment } from "./payment-detect.js";

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.BOT_FORWARD;
});

describe("botForwardScope / isBotManaged", () => {
  it("separa claves por línea y por cuenta (user:<id>)", () => {
    process.env.BOT_FORWARD = JSON.stringify({ "line-1": "http://x", "user:u1": "http://y" });
    expect(botForwardScope()).toEqual({ lineIds: ["line-1"], userIds: ["u1"] });
  });
  it("es bot-managed por línea o por cuenta; si no, no", () => {
    process.env.BOT_FORWARD = JSON.stringify({ "line-1": "http://x", "user:u1": "http://y" });
    expect(isBotManaged({ userId: "u9", lineId: "line-1" })).toBe(true);
    expect(isBotManaged({ userId: "u1", lineId: "line-9" })).toBe(true);
    expect(isBotManaged({ userId: "u9", lineId: "line-9" })).toBe(false);
    expect(isBotManaged({ userId: "u9", lineId: null })).toBe(false);
  });
  it("sin env o JSON roto → nadie es bot-managed", () => {
    expect(isBotManaged({ userId: "u1", lineId: "line-1" })).toBe(false);
    process.env.BOT_FORWARD = "{no json";
    expect(isBotManaged({ userId: "u1", lineId: "line-1" })).toBe(false);
  });
});

describe("findBotRelayContact (bot-relay /purchase)", () => {
  it("busca el contacto por teléfono dentro de las líneas Y las cuentas del forward", async () => {
    process.env.BOT_FORWARD = JSON.stringify({ "line-1": "http://x", "user:u1": "http://y" });
    prismaMock.contact.findFirst.mockResolvedValue({ id: "ct-1" });
    const c = await findBotRelayContact("5491100000000");
    expect(c).toEqual({ id: "ct-1" });
    const where = prismaMock.contact.findFirst.mock.calls[0][0].where;
    expect(where.phone).toBe("5491100000000");
    expect(where.OR).toEqual([{ lineId: { in: ["line-1"] } }, { userId: { in: ["u1"] } }]);
  });
  it("sin forward configurado cae al match global por teléfono", async () => {
    prismaMock.contact.findFirst.mockResolvedValue(null);
    await findBotRelayContact("5491100000000");
    const where = prismaMock.contact.findFirst.mock.calls[0][0].where;
    expect(where).toEqual({ phone: "5491100000000" });
  });
});

describe("detectPayment en cuenta bot-managed", () => {
  const args = () => ({
    mode: "auto",
    userId: "u1",
    contact: { id: "ct-1", externalId: "ext-1", stage: "NUEVO", name: "Juan" },
    instance: "",
    item: {},
    text: "",
    imageBase64: "QUFB",
    imageMediaType: "image/jpeg",
  });
  it("modo auto se degrada a assisted: NO dispara Purchase, deja el pago pre-detectado", async () => {
    process.env.BOT_FORWARD = JSON.stringify({ "user:u1": "http://y" });
    prismaMock.contact.findUnique.mockResolvedValue({ paymentDetectedAt: null, lineId: "line-x" });
    await detectPayment(args());
    expect(markPurchase).not.toHaveBeenCalled();
    expect(prismaMock.contact.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ paymentDetected: true, paymentDetectedAmount: 500000 }),
    }));
  });
  it("cuenta NO bot-managed sigue disparando en auto", async () => {
    process.env.BOT_FORWARD = JSON.stringify({ "user:otro": "http://y" });
    prismaMock.contact.findUnique.mockResolvedValue({ paymentDetectedAt: null, lineId: "line-x" });
    await detectPayment(args());
    expect(markPurchase).toHaveBeenCalledTimes(1);
  });
});
