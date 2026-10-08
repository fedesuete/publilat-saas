import { describe, it, expect, vi, afterEach } from "vitest";

// 08/10 (Eduardo, cuenta valentinolocal): el Lead tiene que salir SOLO si el contacto trae el código
// "(ref: …)" del mensaje que arma el botón de la landing. Los canales de WhatsApp, los chats personales
// del chip y los que escriben directo (aunque sean argentinos) ensuciaban el público del píxel.
const { sendMock, createMock, contactFindMock } = vi.hoisted(() => ({
  sendMock: vi.fn(async () => ({ pixelId: "pix-1", payload: {}, response: { events_received: 1 } })),
  createMock: vi.fn(async () => ({ id: "me-1" })),
  contactFindMock: vi.fn(async (): Promise<{ code: string | null } | null> => null),
}));
vi.mock("./meta-capi.js", () => ({
  sendCapiEvent: sendMock,
  globalPixelAllowed: () => false,
  metaErrorDetail: (e: unknown) => ({ message: String(e) }),
}));
vi.mock("./prisma.js", () => ({
  prisma: {
    metaEvent: { create: createMock, update: vi.fn(async () => ({})), findFirst: vi.fn(async () => null) },
    contact: { findUnique: contactFindMock },
  },
}));
vi.mock("./pixel.js", () => ({
  resolveUserPixel: vi.fn(async () => ({ pixelId: "pix-1", capiToken: "tok-1" })),
  resolveShadowPixels: vi.fn(async () => []),
}));
vi.mock("./capi-guard.js", () => ({ notifyMissingPixel: vi.fn() }));
vi.mock("./io.js", () => ({ emitToUser: vi.fn() }));
vi.mock("./funnel-detect.js", () => ({ looksLikeCredentials: vi.fn(async () => false) }));

import { fireMetaEvent } from "./meta-events.js";

afterEach(() => {
  delete process.env.LEAD_REQUIRE_REF_USERS;
  vi.clearAllMocks();
});

describe("Lead solo con código ref (LEAD_REQUIRE_REF_USERS)", () => {
  it("cuenta listada: el Lead de un contacto SIN código no sale a Meta ni se registra", async () => {
    process.env.LEAD_REQUIRE_REF_USERS = "u-ref";
    const r = await fireMetaEvent({ id: "c1", userId: "u-ref", externalId: "e1", code: null }, "Lead", { oncePerContact: true });
    expect(r).toEqual({ ok: true, skipped: true });
    expect(sendMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("cuenta listada: el Lead de un contacto CON código sale como siempre", async () => {
    process.env.LEAD_REQUIRE_REF_USERS = "u-ref";
    const r = await fireMetaEvent({ id: "c2", userId: "u-ref", externalId: "e2", code: "5E5B50BB" }, "Lead", { oncePerContact: true });
    expect(r.ok).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect((sendMock.mock.calls[0] as unknown as [{ eventName: string }])[0].eventName).toBe("Lead");
  });

  it("cuenta listada: si el llamador no pasa el código, lo busca en la base", async () => {
    process.env.LEAD_REQUIRE_REF_USERS = "u-ref";
    contactFindMock.mockResolvedValueOnce({ code: null });
    const sinCodigo = await fireMetaEvent({ id: "c3", userId: "u-ref", externalId: "e3" }, "Lead");
    expect(sinCodigo).toEqual({ ok: true, skipped: true });
    expect(sendMock).not.toHaveBeenCalled();

    contactFindMock.mockResolvedValueOnce({ code: "79821415" });
    const conCodigo = await fireMetaEvent({ id: "c4", userId: "u-ref", externalId: "e4" }, "Lead");
    expect(conCodigo.ok).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("varias cuentas separadas por coma y con espacios", async () => {
    process.env.LEAD_REQUIRE_REF_USERS = "u-a , u-ref ,u-b";
    const r = await fireMetaEvent({ id: "c5", userId: "u-ref", externalId: "e5", code: null }, "Lead");
    expect(r).toEqual({ ok: true, skipped: true });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("cuenta listada: el Purchase de un contacto sin código sigue saliendo (solo se filtra el Lead)", async () => {
    process.env.LEAD_REQUIRE_REF_USERS = "u-ref";
    const r = await fireMetaEvent({ id: "c6", userId: "u-ref", externalId: "e6", code: null }, "Purchase", { value: 5000 });
    expect(r.ok).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("cuenta NO listada: el Lead sin código sigue saliendo como siempre", async () => {
    process.env.LEAD_REQUIRE_REF_USERS = "u-ref";
    const r = await fireMetaEvent({ id: "c7", userId: "u-otra", externalId: "e7", code: null }, "Lead");
    expect(r.ok).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});
