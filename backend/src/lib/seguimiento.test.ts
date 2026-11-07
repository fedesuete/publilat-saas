import { describe, it, expect, vi, beforeEach } from "vitest";

// Seguimiento automático (07/11): a quién le toca, cuándo, y los frenos que cuidan la línea.
const prismaMock = vi.hoisted(() => ({
  followUpConfig: { findUnique: vi.fn(), update: vi.fn(async () => ({})), findMany: vi.fn() },
  followUpTouch: { count: vi.fn(async () => 0), findFirst: vi.fn(async () => null), findUnique: vi.fn(async () => null), create: vi.fn(async () => ({ id: "t1" })), update: vi.fn(async () => ({})) },
  contact: { findFirst: vi.fn(async () => null), findUnique: vi.fn(), update: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({})) },
  waLine: { findFirst: vi.fn(async () => ({ id: "L1" })) },
  $queryRaw: vi.fn(async () => []),
}));
const sendLeadVariant = vi.hoisted(() => vi.fn(async () => true));
vi.mock("./prisma.js", () => ({ prisma: prismaMock }));
vi.mock("./leadgen-send.js", async () => {
  const real = await vi.importActual<typeof import("./leadgen-send.js")>("./leadgen-send.js");
  return { parseVariants: real.parseVariants, pickVariant: real.pickVariant, sendLeadVariant };
});

const { pasoQueToca, dentroDeVentana, parsearLista, tickCuenta, parsePasos } = await import("./seguimiento.js");

const DIA = 24 * 3600 * 1000;
const pasos = parsePasos([
  { afterDays: 1, variants: [{ kind: "text", body: "¿Pudiste ver, {{nombre}}?" }] },
  { afterDays: 2, variants: [{ kind: "text", body: "Te dejo esto" }] },
  { afterDays: 4, variants: [{ kind: "text", body: "Último" }] },
]);
// 15:00 en Asunción (UTC-3) = 18:00 UTC
const AHORA = new Date("2026-11-07T18:00:00Z");
const cfg = (over: Record<string, unknown> = {}) => ({
  userId: "u1", enabled: true, steps: pasos, listVariants: [], dailyCap: 30, hourFrom: 9, hourTo: 21,
  tz: "America/Asuncion", minGapMin: 8, maxAgeDays: 30, lineId: null, ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("cuándo le toca", () => {
  it("paso 1 al día de nuestro último mensaje, no antes", () => {
    expect(pasoQueToca(pasos, 0, new Date(AHORA.getTime() - 0.5 * DIA), AHORA)).toBeNull();
    expect(pasoQueToca(pasos, 0, new Date(AHORA.getTime() - 1.1 * DIA), AHORA)).toBe(0);
  });
  it("el paso 2 espera 2 días desde el paso 1; después del último no hay más", () => {
    expect(pasoQueToca(pasos, 1, new Date(AHORA.getTime() - 1 * DIA), AHORA)).toBeNull();
    expect(pasoQueToca(pasos, 1, new Date(AHORA.getTime() - 2.1 * DIA), AHORA)).toBe(1);
    expect(pasoQueToca(pasos, 3, new Date(AHORA.getTime() - 30 * DIA), AHORA)).toBeNull();
  });
  it("ventana horaria en la hora local de la cuenta", () => {
    expect(dentroDeVentana(cfg(), AHORA)).toBe(true);
    expect(dentroDeVentana(cfg(), new Date("2026-11-07T03:00:00Z"))).toBe(false); // 00:00 en Asunción
  });
});

describe("lista importada", () => {
  it("lee 'nombre, número', solo número, ignora encabezado y repetidos", () => {
    const { filas, invalidas } = parsearLista("Nombre,Teléfono\nAna Pérez, +595 981 234-567\n5491122334455\n0981\n595981234567");
    expect(filas).toEqual([{ name: "Ana Pérez", phone: "595981234567" }, { name: null, phone: "5491122334455" }]);
    expect(invalidas).toBe(2); // el encabezado y el 0981
  });
});

describe("tick de una cuenta", () => {
  const frio = (dias: number, hechos = 0) => [{ contactId: "c1", lastAt: new Date(AHORA.getTime() - dias * DIA), hechos }];

  it("le manda el paso que toca al lead frío y lo registra", async () => {
    prismaMock.followUpConfig.findUnique.mockResolvedValueOnce(cfg() as never);
    prismaMock.$queryRaw.mockResolvedValueOnce(frio(1.5) as never);
    prismaMock.contact.findUnique.mockResolvedValueOnce({ id: "c1", name: "Juan Pérez", lineId: "L1" } as never);
    expect(await tickCuenta("u1", AHORA)).toBe("enviado");
    expect(prismaMock.followUpTouch.create).toHaveBeenCalledWith({ data: { userId: "u1", contactId: "c1", kind: "seguimiento", step: 0, ok: false }, select: { id: true } });
    expect(sendLeadVariant).toHaveBeenCalledWith("u1", "c1", expect.objectContaining({ kind: "text" }), "¿Pudiste ver, Juan?");
  });

  it("no manda fuera de horario, con el tope lleno, ni apagado", async () => {
    prismaMock.followUpConfig.findUnique.mockResolvedValueOnce(cfg() as never);
    expect(await tickCuenta("u1", new Date("2026-11-07T03:00:00Z"))).toBe("fuera de horario");
    prismaMock.followUpConfig.findUnique.mockResolvedValueOnce(cfg() as never);
    prismaMock.followUpTouch.count.mockResolvedValueOnce(30 as never);
    expect(await tickCuenta("u1", AHORA)).toBe("tope diario");
    prismaMock.followUpConfig.findUnique.mockResolvedValueOnce(cfg({ enabled: false }) as never);
    expect(await tickCuenta("u1", AHORA)).toBe("apagado");
    expect(sendLeadVariant).not.toHaveBeenCalled();
  });

  it("respeta la pausa entre envíos", async () => {
    prismaMock.followUpConfig.findUnique.mockResolvedValueOnce(cfg() as never);
    prismaMock.followUpTouch.findFirst.mockResolvedValueOnce({ createdAt: new Date(AHORA.getTime() - 60_000) } as never);
    expect(await tickCuenta("u1", AHORA)).toBe("pausa");
  });

  it("sin línea activa frena y avisa", async () => {
    prismaMock.followUpConfig.findUnique.mockResolvedValueOnce(cfg() as never);
    prismaMock.$queryRaw.mockResolvedValueOnce(frio(2) as never);
    prismaMock.contact.findUnique.mockResolvedValueOnce({ id: "c1", name: null, lineId: "L9" } as never);
    prismaMock.waLine.findFirst.mockResolvedValue(null as never);
    expect(await tickCuenta("u1", AHORA)).toBe("sin línea");
    expect(sendLeadVariant).not.toHaveBeenCalled();
    prismaMock.waLine.findFirst.mockResolvedValue({ id: "L1" } as never);
  });

  it("si otro proceso ya registró ese paso, no lo repite", async () => {
    const { Prisma } = await import("@prisma/client");
    prismaMock.followUpConfig.findUnique.mockResolvedValueOnce(cfg() as never);
    prismaMock.$queryRaw.mockResolvedValueOnce(frio(2) as never);
    prismaMock.contact.findUnique.mockResolvedValueOnce({ id: "c1", name: null, lineId: "L1" } as never);
    prismaMock.followUpTouch.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" }) as never);
    expect(await tickCuenta("u1", AHORA)).toBe("ya enviado");
    expect(sendLeadVariant).not.toHaveBeenCalled();
  });

  it("lista: primer mensaje y pasa a Contactado", async () => {
    prismaMock.followUpConfig.findUnique.mockResolvedValueOnce(cfg({ steps: [], listVariants: [{ kind: "text", body: "Hola {{nombre}}" }] }) as never);
    prismaMock.contact.findFirst.mockResolvedValueOnce({ id: "c2" } as never);
    prismaMock.contact.findUnique.mockResolvedValueOnce({ id: "c2", name: "Ana", lineId: null } as never);
    expect(await tickCuenta("u1", AHORA)).toBe("enviado");
    expect(sendLeadVariant).toHaveBeenCalledWith("u1", "c2", expect.anything(), "Hola Ana");
    expect(prismaMock.contact.updateMany).toHaveBeenCalledWith({ where: { id: "c2", stage: "NUEVO" }, data: { stage: "CONTACTADO" } });
  });
});
