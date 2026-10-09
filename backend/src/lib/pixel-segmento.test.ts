// Pixel por tipo de cliente: el contacto marcado va a SU pixel; el resto, al principal de siempre.
import { describe, it, expect, vi, beforeEach } from "vitest";

type Px = { id: string; userId: string; pixelId: string; capiToken: string; eventType: string; label: string | null; hidden: boolean; mirror: boolean; createdAt: Date };
let pixeles: Px[] = [];
let segmentos: Record<string, string> = {}; // contactId -> pixelRowId

const matchea = (p: Px, w: Record<string, unknown>) =>
  Object.entries(w).every(([k, v]) => (k === "label" && v && typeof v === "object" ? p.label !== null : (p as Record<string, unknown>)[k] === v));

vi.mock("./prisma.js", () => ({
  prisma: {
    pixel: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        [...pixeles].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).find((p) => matchea(p, where)) ?? null),
    },
    contactSegment: {
      findUnique: vi.fn(async ({ where }: { where: { contactId: string } }) =>
        segmentos[where.contactId] ? { pixelRowId: segmentos[where.contactId] } : null),
    },
  },
}));
vi.mock("./crypto.js", () => ({ decryptSecret: (s: string) => `dec(${s})` }));

const { resolveUserPixel, resolveContactPixel } = await import("./pixel.js");

const px = (id: string, label: string | null, dias: number, extra: Partial<Px> = {}): Px => ({
  id, userId: "u1", pixelId: `meta-${id}`, capiToken: `tok-${id}`, eventType: "Lead", label,
  hidden: false, mirror: false, createdAt: new Date(2026, 0, dias), ...extra,
});

beforeEach(() => {
  segmentos = {};
  // Caso real de Federico: el principal ya existía; después carga los de cada tipo.
  pixeles = [px("fichas", "Fichas", 5), px("principal", null, 1), px("plataforma", "Plataforma", 6)];
});

describe("resolveUserPixel (el principal)", () => {
  it("un pixel con tipo NUNCA pasa a ser el principal, aunque se haya cargado antes", () => {
    pixeles = [px("fichas", "Fichas", 1), px("principal", null, 9)];
    return expect(resolveUserPixel("u1", "Lead")).resolves.toEqual({ pixelId: "meta-principal", capiToken: "dec(tok-principal)" });
  });
  it("si la cuenta SOLO tiene pixeles con tipo, usa el más viejo (antes que perder el evento)", () => {
    pixeles = [px("plataforma", "Plataforma", 6), px("fichas", "Fichas", 2)];
    return expect(resolveUserPixel("u1", "Lead")).resolves.toMatchObject({ pixelId: "meta-fichas" });
  });
  it("el espejo y la sombra nunca son principales", () => {
    pixeles = [px("espejo", null, 1, { mirror: true }), px("sombra", null, 1, { hidden: true }), px("principal", null, 3)];
    return expect(resolveUserPixel("u1", "Lead")).resolves.toMatchObject({ pixelId: "meta-principal" });
  });
});

describe("resolveContactPixel (por contacto)", () => {
  it("contacto SIN marca → principal, exactamente como antes", async () => {
    expect(await resolveContactPixel("u1", "c1", "Purchase")).toMatchObject({ pixelId: "meta-principal" });
  });
  it("contacto marcado Fichas → el pixel de Fichas", async () => {
    segmentos.c1 = "fichas";
    expect(await resolveContactPixel("u1", "c1", "Purchase")).toEqual({ pixelId: "meta-fichas", capiToken: "dec(tok-fichas)" });
  });
  it("la marca apunta a un pixel borrado → cae al principal (no se pierde el evento)", async () => {
    segmentos.c1 = "ya-no-existe";
    expect(await resolveContactPixel("u1", "c1", "Lead")).toMatchObject({ pixelId: "meta-principal" });
  });
  it("la marca apunta a un pixel de OTRA cuenta → no lo usa", async () => {
    pixeles.push(px("ajeno", "Fichas", 3, { userId: "otro" }));
    segmentos.c1 = "ajeno";
    expect(await resolveContactPixel("u1", "c1", "Lead")).toMatchObject({ pixelId: "meta-principal" });
  });
  it("sin contacto → principal", async () => {
    expect(await resolveContactPixel("u1", null, "Lead")).toMatchObject({ pixelId: "meta-principal" });
  });
});

describe("landing solo-servidor (sin pixel de navegador)", async () => {
  const { injectCurrentPixel, injectMirrorPixels, SIN_PIXEL_MARK } = await import("./landing-template.js");
  const conMarca = `<html><head><meta name="${SIN_PIXEL_MARK}" content="1"></head><body></body></html>`;
  const sinMarca = `<html><head></head><body></body></html>`;
  it("con la marca, el publicador no mete ni el pixel principal ni los espejos", () => {
    expect(injectCurrentPixel(conMarca, "123456789")).toBe(conMarca);
    expect(injectMirrorPixels(conMarca, ["987654321"])).toBe(conMarca);
  });
  it("sin la marca, todo sigue igual: se inyecta el pixel", () => {
    expect(injectCurrentPixel(sinMarca, "123456789")).toContain("fbq('init','123456789')");
  });
});
