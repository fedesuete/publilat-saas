import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Techo de gasto del plan de proxies. Lo que se prueba: que corte cuando se pasa, que corte a la
// que MÁS gasta, que deje la línea trabajando igual, y que no vuelva a agarrar proxy a los 2 min.
const prismaMock = vi.hoisted(() => ({ waLine: { findMany: vi.fn(async () => []), update: vi.fn(async () => ({})) } }));
const flapsMock = vi.hoisted(() => ({ recentFlaps: vi.fn(() => 0) }));
const emergenciaMock = vi.hoisted(() => ({ pasarLineaADirecto: vi.fn(async () => true) }));
vi.mock("./prisma.js", () => ({ prisma: prismaMock }));
vi.mock("./line-weights.js", () => flapsMock);
vi.mock("./proxy-emergencia.js", () => emergenciaMock);

import { excedido, elegirVictima, aplicarTope, textoTope, PRESUPUESTO_GB_DIA, BLOQUEO_HORAS } from "./proxy-presupuesto.js";

const linea = (id: string, dias: number) => ({ id, phone: "54911000000" + id, label: null, createdAt: new Date(Date.now() - dias * 86400e3) });

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.PROXY_PRESUPUESTO;
  flapsMock.recentFlaps.mockReturnValue(0);
  emergenciaMock.pasarLineaADirecto.mockResolvedValue(true as never);
});
afterEach(() => { delete process.env.PROXY_PRESUPUESTO; });

describe("¿se pasó del techo?", () => {
  it("por encima del presupuesto, sí", () => {
    expect(excedido(PRESUPUESTO_GB_DIA + 0.01)).toBe(true);
  });
  it("justo en el techo o por debajo, no", () => {
    expect(excedido(PRESUPUESTO_GB_DIA)).toBe(false);
    expect(excedido(0.05)).toBe(false);
  });
  it("sin medición confiable no corta nada", () => {
    expect(excedido(null)).toBe(false);
  });
  it("apagado por env, nunca", () => {
    process.env.PROXY_PRESUPUESTO = "off";
    expect(excedido(99)).toBe(false);
  });
});

describe("a quién cortarle el proxy", () => {
  it("a la que más se cayó (es la que más gasta)", () => {
    flapsMock.recentFlaps.mockImplementation((id: string) => ({ a: 2, b: 40, c: 5 }[id] ?? 0));
    expect(elegirVictima([linea("a", 30), linea("b", 30), linea("c", 30)])).toBe("b");
  });

  it("sin caídas registradas, a la más nueva (las recién vinculadas son las que peor andan)", () => {
    expect(elegirVictima([linea("vieja", 60), linea("nueva", 1)])).toBe("nueva");
  });

  it("con empate de caídas desempata la más nueva", () => {
    flapsMock.recentFlaps.mockReturnValue(7);
    expect(elegirVictima([linea("vieja", 60), linea("nueva", 2)])).toBe("nueva");
  });

  it("sin candidatas devuelve null", () => {
    expect(elegirVictima([])).toBeNull();
  });
});

describe("aplicar el tope", () => {
  it("dentro del presupuesto no toca nada", async () => {
    expect(await aplicarTope(0.1)).toBeNull();
    expect(prismaMock.waLine.findMany).not.toHaveBeenCalled();
  });

  it("pasado el techo: saca el proxy Y bloquea, para que no lo recupere en 2 minutos", async () => {
    prismaMock.waLine.findMany.mockResolvedValueOnce([linea("a", 1)] as never);
    const r = await aplicarTope(PRESUPUESTO_GB_DIA + 1);
    expect(r?.lineId).toBe("a");
    expect(emergenciaMock.pasarLineaADirecto).toHaveBeenCalled();
    const data = prismaMock.waLine.update.mock.calls[0][0].data as { proxyBlockedUntil: Date; proxyWait: boolean };
    // proxyWait en false es lo que evita que el job de recupero le devuelva el proxy y vuelva a gastar.
    expect(data.proxyWait).toBe(false);
    const horas = (data.proxyBlockedUntil.getTime() - Date.now()) / 3600_000;
    expect(horas).toBeGreaterThan(BLOQUEO_HORAS - 0.1);
  });

  it("corta UNA por vuelta, no toda la flota de golpe", async () => {
    prismaMock.waLine.findMany.mockResolvedValueOnce([linea("a", 1), linea("b", 2), linea("c", 3)] as never);
    await aplicarTope(99);
    expect(emergenciaMock.pasarLineaADirecto).toHaveBeenCalledTimes(1);
  });

  it("si no se pudo sacar el proxy, NO la marca como bloqueada (no miente)", async () => {
    prismaMock.waLine.findMany.mockResolvedValueOnce([linea("a", 1)] as never);
    emergenciaMock.pasarLineaADirecto.mockResolvedValueOnce(false as never);
    expect(await aplicarTope(99)).toBeNull();
    expect(prismaMock.waLine.update).not.toHaveBeenCalled();
  });

  it("sin líneas con proxy no hace nada", async () => {
    prismaMock.waLine.findMany.mockResolvedValueOnce([] as never);
    expect(await aplicarTope(99)).toBeNull();
  });
});

describe("aviso", () => {
  it("explica qué pasó y que la línea sigue funcionando", () => {
    const t = textoTope("…7450", 1.2, 24);
    expect(t).toContain("1.20 GB por día");
    expect(t).toContain("…7450");
    expect(t).toContain("SIGUE FUNCIONANDO");
    expect(t).toContain("24 h");
  });
});
