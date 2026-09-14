import { describe, it, expect, vi, beforeEach } from "vitest";

// Embudo de venta de Publi.lat en sí (pixel de marketing propio): atribución del alta,
// CompleteRegistration/Purchase por CAPI y cierre de loop con el CRM.
vi.mock("./meta-capi.js", () => ({
  sendCapiEvent: vi.fn(async () => ({ pixelId: "pix", eventsReceived: 1 })),
}));
const prismaMock = vi.hoisted(() => ({
  payment: { findUnique: vi.fn(), updateMany: vi.fn() },
  credit: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  user: { findUnique: vi.fn() },
  contact: { findFirst: vi.fn() },
}));
vi.mock("./prisma.js", () => ({ prisma: prismaMock }));
vi.mock("./mailer.js", () => ({ sendAdminMail: vi.fn(async () => true) }));
vi.mock("./referrals.js", () => ({ settleReferralOnFirstPayment: vi.fn(async () => undefined) }));
vi.mock("./purchase.js", () => ({ markPurchase: vi.fn(async () => ({ ok: true })) }));

import { sendCapiEvent } from "./meta-capi.js";
import { markPurchase } from "./purchase.js";
import { clickIdsFromSignup, signupSource } from "./attribution.js";
import { fireMarketingEvent, publicMarketingConfig } from "./marketing-capi.js";
import { approvePayment } from "./billing-approve.js";

const sendMock = sendCapiEvent as unknown as ReturnType<typeof vi.fn>;
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.PUBLILAT_MKT_PIXEL_ID;
  delete process.env.PUBLILAT_MKT_CAPI_TOKEN;
  delete process.env.PUBLILAT_MKT_CRM_USER_ID;
});

describe("clickIdsFromSignup", () => {
  it("deriva fbc del fbclid cuando no vino la cookie _fbc", () => {
    const r = clickIdsFromSignup({ fbp: "fb.1.1.abc", fbclid: "QA123", now: new Date(1700000000000) });
    expect(r).toEqual({ fbp: "fb.1.1.abc", fbc: "fb.1.1700000000000.QA123", fbclid: "QA123" });
  });
  it("respeta la cookie _fbc si vino", () => {
    const r = clickIdsFromSignup({ fbc: "fb.1.999.real", fbclid: "QA123" });
    expect(r.fbc).toBe("fb.1.999.real");
  });
  it("sin ids devuelve nulls (no strings vacíos)", () => {
    expect(clickIdsFromSignup({})).toEqual({ fbp: null, fbc: null, fbclid: null });
    expect(clickIdsFromSignup({ fbp: "", fbclid: "" })).toEqual({ fbp: null, fbc: null, fbclid: null });
  });
});

describe("signupSource", () => {
  it("referido si vino un referidor válido, app si no", () => {
    expect(signupSource({ referred: true })).toBe("referido");
    expect(signupSource({ referred: false })).toBe("app");
  });
});

describe("fireMarketingEvent", () => {
  it("es no-op sin token en el env (leído en cada llamada, no al importar)", async () => {
    process.env.PUBLILAT_MKT_PIXEL_ID = "111";
    await fireMarketingEvent({ eventName: "CompleteRegistration", externalId: "u1" });
    expect(sendMock).not.toHaveBeenCalled();
  });
  it("con pixel+token manda el evento a ESE pixel con email y teléfono", async () => {
    process.env.PUBLILAT_MKT_PIXEL_ID = "111";
    process.env.PUBLILAT_MKT_CAPI_TOKEN = "tok";
    await fireMarketingEvent({ eventName: "CompleteRegistration", externalId: "u1", email: "A@B.com", phone: "595981", eventId: "e1" });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0]).toMatchObject({
      pixelId: "111", capiToken: "tok", eventName: "CompleteRegistration", externalId: "u1", email: "A@B.com", phone: "595981", eventId: "e1",
    });
  });
  it("publicMarketingConfig expone el pixel id (o null)", () => {
    expect(publicMarketingConfig()).toEqual({ mktPixelId: null });
    process.env.PUBLILAT_MKT_PIXEL_ID = " 111 ";
    expect(publicMarketingConfig()).toEqual({ mktPixelId: "111" });
  });
});

describe("approvePayment", () => {
  const payment = { id: "pay-1", userId: "u1", days: 7, amount: 10500000, currency: "PYG", status: "pending" };
  const user = { id: "u1", source: "admin", email: "cli@x.com", phone: "595981111", name: "Ana Perez", fbp: "fb.1.1.x", fbc: null, slug: "ana" };
  beforeEach(() => {
    process.env.PUBLILAT_MKT_PIXEL_ID = "111";
    process.env.PUBLILAT_MKT_CAPI_TOKEN = "tok";
    prismaMock.payment.findUnique.mockResolvedValue(payment);
    prismaMock.payment.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.credit.findUnique.mockResolvedValue({ id: "c1", userId: "u1", days: 0 });
    prismaMock.credit.update.mockResolvedValue({});
    prismaMock.user.findUnique.mockResolvedValue(user);
    prismaMock.contact.findFirst.mockResolvedValue(null);
  });

  it("acredita los días y dispara Purchase aunque el source NO sea landing", async () => {
    await approvePayment("pay-1", "Pagopar");
    await flush();
    expect(prismaMock.credit.update).toHaveBeenCalledTimes(1);
    const purchase = sendMock.mock.calls.map((c) => c[0]).find((e) => e.eventName === "Purchase");
    expect(purchase).toMatchObject({
      pixelId: "111", externalId: "u1", email: "cli@x.com", phone: "595981111", firstName: "Ana Perez", fbp: "fb.1.1.x",
      value: 105000, currency: "PYG", eventId: "pay-1:purchase",
    });
  });

  it("no acredita ni dispara nada si el pago ya estaba aprobado (idempotente)", async () => {
    prismaMock.payment.findUnique.mockResolvedValue({ ...payment, status: "approved" });
    await approvePayment("pay-1", "Pagopar");
    await flush();
    expect(prismaMock.credit.update).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("cierra el loop en el CRM: marca COMPRO al contacto con ese teléfono en la cuenta del CRM", async () => {
    process.env.PUBLILAT_MKT_CRM_USER_ID = "fede";
    prismaMock.contact.findFirst.mockResolvedValue({ id: "ct-9", userId: "fede", stage: "CONTACTADO" });
    await approvePayment("pay-1", "Pagopar");
    await flush();
    expect(prismaMock.contact.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: "fede", phone: expect.objectContaining({ endsWith: "595981111" }) }),
    }));
    expect(markPurchase).toHaveBeenCalledWith("fede", "ct-9", 105000, "PYG", { eventId: "pay-1:purchase" });
  });

  it("sin PUBLILAT_MKT_CRM_USER_ID no toca el CRM", async () => {
    await approvePayment("pay-1", "Pagopar");
    await flush();
    expect(prismaMock.contact.findFirst).not.toHaveBeenCalled();
    expect(markPurchase).not.toHaveBeenCalled();
  });
});
