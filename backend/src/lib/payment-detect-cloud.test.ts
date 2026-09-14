import { describe, it, expect, vi, beforeEach } from "vitest";

// Recargas por Cloud API (wa-cloud.ts): el caller NO pasa paymentDetectedAt → el cooldown de 1h no
// actuaba y el mismo comprobante re-enviado disparaba N Purchase (caso 11/09: 3 Purchase en 27 min).
// Y la moneda: la IA "leía" PYG en recibos ARS y se mandaba así a Meta (valor /5). La cuenta manda.
const prismaMock = vi.hoisted(() => ({
  contact: { findUnique: vi.fn(), update: vi.fn(async () => ({})) },
  message: { count: vi.fn(async () => 0) },
}));
vi.mock("./prisma.js", () => ({ prisma: prismaMock }));
vi.mock("./io.js", () => ({ emitToUser: vi.fn() }));
vi.mock("./evolution.js", () => ({ getMediaBase64: vi.fn(async () => null) }));
vi.mock("./ai-receipt.js", () => ({
  aiEnabled: () => true,
  analyzeReceipt: vi.fn(async () => ({ isReceipt: true, amount: 5000, currency: "PYG", confidence: 0.95, senderName: "Juan Perez" })),
}));
vi.mock("./purchase.js", () => ({
  markPurchase: vi.fn(async () => ({ ok: true })),
  accountCurrency: vi.fn(async () => "ARS"),
}));

import { markPurchase } from "./purchase.js";
import { detectPayment } from "./payment-detect.js";

const baseArgs = () => ({
  mode: "auto",
  userId: "u1",
  // Igual que wa-cloud.ts: SIN paymentDetectedAt.
  contact: { id: "ct-1", externalId: "ext-1", stage: "NUEVO", name: "Juan" },
  instance: "",
  item: {},
  text: "",
  imageBase64: "QUFB",
  imageMediaType: "image/jpeg",
});

beforeEach(() => vi.clearAllMocks());

describe("detectPayment por Cloud API (sin paymentDetectedAt en el caller)", () => {
  it("lee paymentDetectedAt de la DB: comprobante re-enviado dentro del cooldown NO dispara otro Purchase", async () => {
    prismaMock.contact.findUnique.mockResolvedValue({ paymentDetectedAt: new Date(Date.now() - 10 * 60 * 1000) });
    await detectPayment(baseArgs());
    expect(markPurchase).not.toHaveBeenCalled();
  });

  it("fuera del cooldown SÍ dispara la recarga", async () => {
    prismaMock.contact.findUnique.mockResolvedValue({ paymentDetectedAt: new Date(Date.now() - 3 * 60 * 60 * 1000) });
    await detectPayment(baseArgs());
    expect(markPurchase).toHaveBeenCalledTimes(1);
  });

  it("la moneda es la de la CUENTA aunque la IA lea otra en el comprobante", async () => {
    prismaMock.contact.findUnique.mockResolvedValue({ paymentDetectedAt: null });
    await detectPayment(baseArgs());
    expect(markPurchase).toHaveBeenCalledTimes(1);
    const [, , amount, currency] = (markPurchase as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(amount).toBe(5000);
    expect(currency).toBe("ARS");
  });
});
