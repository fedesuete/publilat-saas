import { describe, it, expect, vi, afterEach } from "vitest";

// 08/10 (Eduardo, cuenta valentinolocal): el Lead tiene que salir SOLO si el contacto trae el código
// "(ref: …)" del mensaje que arma el botón de la landing. Los canales de WhatsApp, los chats personales
// del chip y los que escriben directo (aunque sean argentinos) ensuciaban el público del píxel.
const { sendMock, createMock, contactFindMock, contactFindFirstMock } = vi.hoisted(() => ({
  sendMock: vi.fn(async () => ({ pixelId: "pix-1", payload: {}, response: { events_received: 1 } })),
  createMock: vi.fn(async () => ({ id: "me-1" })),
  contactFindMock: vi.fn(async (): Promise<{ code: string | null } | null> => null),
  contactFindFirstMock: vi.fn(async (): Promise<{ id: string } | null> => null),
}));
vi.mock("./meta-capi.js", () => ({
  sendCapiEvent: sendMock,
  globalPixelAllowed: () => false,
  metaErrorDetail: (e: unknown) => ({ message: String(e) }),
}));
vi.mock("./prisma.js", () => ({
  prisma: {
    metaEvent: { create: createMock, update: vi.fn(async () => ({})), findFirst: vi.fn(async () => null) },
    contact: { findUnique: contactFindMock, findFirst: contactFindFirstMock },
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
  delete process.env.LEAD_REQUIRE_REF_LANDING;
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

// 08/10 (Eduardo): la regla aplica sola a TODA cuenta que publicita con la landing: tuvo clics del botón
// (/go, con código) desde anuncios (fbclid/fbc) en los últimos 30 días. Las cuentas sin landing (todos sus
// Lead son de gente que escribe directo, ej. seba-1) siguen como siempre: si no, quedarían en cero.
describe("Lead solo con código ref en cuentas que usan la landing (detección automática)", () => {
  it("cuenta con clics de la landing desde anuncios en los últimos 30 días: el Lead sin código no sale", async () => {
    contactFindFirstMock.mockResolvedValueOnce({ id: "go-1" });
    const r = await fireMetaEvent({ id: "c10", userId: "u-landing", externalId: "e10", code: null }, "Lead");
    expect(r).toEqual({ ok: true, skipped: true });
    expect(sendMock).not.toHaveBeenCalled();
    const where = (contactFindFirstMock.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
    expect(where.userId).toBe("u-landing");
    expect(where.code).toEqual({ not: null });
    expect(where.OR).toEqual(expect.arrayContaining([{ fbclid: { not: null } }]));
    const desde = (where.createdAt as { gte: Date }).gte.getTime();
    expect(Date.now() - desde).toBeGreaterThan(29 * 86400e3);
    expect(Date.now() - desde).toBeLessThan(31 * 86400e3);
  });

  it("cuenta sin clics de landing: el Lead sin código sale como siempre", async () => {
    contactFindFirstMock.mockResolvedValueOnce(null);
    const r = await fireMetaEvent({ id: "c11", userId: "u-sin-landing", externalId: "e11", code: null }, "Lead");
    expect(r.ok).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("Lead con código: sale sin consultar la detección", async () => {
    const r = await fireMetaEvent({ id: "c12", userId: "u-landing-2", externalId: "e12", code: "AB12CD34" }, "Lead");
    expect(r.ok).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(contactFindFirstMock).not.toHaveBeenCalled();
  });

  it("LEAD_REQUIRE_REF_LANDING=off apaga la detección automática", async () => {
    process.env.LEAD_REQUIRE_REF_LANDING = "off";
    const r = await fireMetaEvent({ id: "c13", userId: "u-landing-3", externalId: "e13", code: null }, "Lead");
    expect(r.ok).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(contactFindFirstMock).not.toHaveBeenCalled();
  });

  it("cuenta sin landing y llamador sin el campo código: no consulta la base por el código", async () => {
    contactFindFirstMock.mockResolvedValueOnce(null);
    const r = await fireMetaEvent({ id: "c16", userId: "u-sin-landing-2", externalId: "e16" }, "Lead");
    expect(r.ok).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(contactFindMock).not.toHaveBeenCalled();
  });

  it("si la detección falla (base caída), el Lead sale como antes: best-effort, no frena", async () => {
    contactFindFirstMock.mockRejectedValueOnce(new Error("db caída"));
    const r = await fireMetaEvent({ id: "c17", userId: "u-falla", externalId: "e17", code: null }, "Lead");
    expect(r.ok).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("la detección se guarda por cuenta: dos Lead seguidos sin código hacen una sola consulta", async () => {
    contactFindFirstMock.mockResolvedValueOnce({ id: "go-2" });
    await fireMetaEvent({ id: "c14", userId: "u-landing-4", externalId: "e14", code: null }, "Lead");
    const r = await fireMetaEvent({ id: "c15", userId: "u-landing-4", externalId: "e15", code: null }, "Lead");
    expect(r).toEqual({ ok: true, skipped: true });
    expect(contactFindFirstMock).toHaveBeenCalledTimes(1);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
