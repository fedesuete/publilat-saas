import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Quedarse sin saldo de proxy NO puede tirar abajo el WhatsApp de todos los clientes (pasó dos veces
// en tres días). Acá se prueba CUÁNDO se sale a la IP directa y, sobre todo, cuándo NO.
const prismaMock = vi.hoisted(() => ({
  proxy: { findMany: vi.fn(async () => []) },
  waLine: { findMany: vi.fn(async () => []), findUnique: vi.fn(), update: vi.fn(async () => ({})) },
}));
const engineMock = vi.hoisted(() => ({ setProxy: vi.fn(async () => undefined) }));
vi.mock("./prisma.js", () => ({ prisma: prismaMock }));
vi.mock("./wa-engine.js", () => ({ getEngine: () => engineMock }));
vi.mock("./proxy-pool.js", () => ({ logProxyEvent: vi.fn(async () => undefined) }));

import {
  hayQueIrDirecto, hayProxySano, pasarLineaADirecto, modoEmergencia, textoEmergencia, EMERGENCIA_GB,
} from "./proxy-emergencia.js";

const linea = (extra: Record<string, unknown> = {}) => ({
  id: "l1", sessionId: null, provider: "baileys", status: "active", banned: false, proxyId: "p1", phone: "5491100000000", ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.PROXY_FALLBACK_DIRECTO;
});
afterEach(() => { delete process.env.PROXY_FALLBACK_DIRECTO; });

describe("cuándo salir a la IP directa", () => {
  it("con el saldo agotado, sí", () => {
    expect(hayQueIrDirecto(0.01, true)).toBe(true);
  });

  it("sin ningún proxy sano, sí (aunque haya saldo)", () => {
    expect(hayQueIrDirecto(5, false)).toBe(true);
  });

  it("con saldo y pool sano, NO (una línea suelta que falla se reintenta con otro proxy)", () => {
    expect(hayQueIrDirecto(5, true)).toBe(false);
  });

  it("si no se pudo leer el saldo, manda la salud del pool", () => {
    expect(hayQueIrDirecto(null, true)).toBe(false);
    expect(hayQueIrDirecto(null, false)).toBe(true);
  });

  it("el umbral es configurable y se respeta el límite exacto", () => {
    expect(hayQueIrDirecto(EMERGENCIA_GB, true)).toBe(false);      // justo en el umbral todavía no
    expect(hayQueIrDirecto(EMERGENCIA_GB - 0.001, true)).toBe(true);
  });

  it("apagado por env, NUNCA (vuelve al comportamiento viejo)", () => {
    process.env.PROXY_FALLBACK_DIRECTO = "off";
    expect(hayQueIrDirecto(0, false)).toBe(false);
  });
});

describe("hay proxy sano", () => {
  it("sano y con cupo → sí", async () => {
    prismaMock.proxy.findMany.mockResolvedValueOnce([{ maxLines: 40, _count: { lines: 9 } }] as never);
    expect(await hayProxySano()).toBe(true);
  });
  it("sano pero LLENO → no", async () => {
    prismaMock.proxy.findMany.mockResolvedValueOnce([{ maxLines: 10, _count: { lines: 10 } }] as never);
    expect(await hayProxySano()).toBe(false);
  });
  it("sin proxies activos → no", async () => {
    prismaMock.proxy.findMany.mockResolvedValueOnce([] as never);
    expect(await hayProxySano()).toBe(false);
  });
});

describe("pasar una línea a IP directa", () => {
  it("le saca el proxy a la sesión viva y la deja esperando uno nuevo", async () => {
    prismaMock.waLine.findUnique.mockResolvedValueOnce(linea() as never);
    expect(await pasarLineaADirecto("l1", "sin saldo")).toBe(true);
    expect(engineMock.setProxy).toHaveBeenCalledWith("line_l1", null);
    // proxyWait=true es lo que hace que el job de recupero le devuelva un proxy cuando vuelva el pool.
    expect(prismaMock.waLine.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { proxyId: null, proxySession: null, proxyWait: true } }),
    );
  });

  it("usa el sessionId real si la línea tiene uno", async () => {
    prismaMock.waLine.findUnique.mockResolvedValueOnce(linea({ sessionId: "line_vieja" }) as never);
    await pasarLineaADirecto("l1", "x");
    expect(engineMock.setProxy).toHaveBeenCalledWith("line_vieja", null);
  });

  it("NO toca una línea pausada por el cliente", async () => {
    prismaMock.waLine.findUnique.mockResolvedValueOnce(linea({ status: "paused" }) as never);
    expect(await pasarLineaADirecto("l1", "x")).toBe(false);
    expect(engineMock.setProxy).not.toHaveBeenCalled();
  });

  it("NO toca una línea baneada ni una de Cloud API", async () => {
    prismaMock.waLine.findUnique.mockResolvedValueOnce(linea({ banned: true }) as never);
    expect(await pasarLineaADirecto("l1", "x")).toBe(false);
    prismaMock.waLine.findUnique.mockResolvedValueOnce(linea({ provider: "cloud" }) as never);
    expect(await pasarLineaADirecto("l1", "x")).toBe(false);
    expect(engineMock.setProxy).not.toHaveBeenCalled();
  });

  it("si el motor falla, no marca nada en la base (no miente sobre el estado)", async () => {
    prismaMock.waLine.findUnique.mockResolvedValueOnce(linea() as never);
    engineMock.setProxy.mockRejectedValueOnce(new Error("timeout") as never);
    expect(await pasarLineaADirecto("l1", "x")).toBe(false);
    expect(prismaMock.waLine.update).not.toHaveBeenCalled();
  });
});

describe("barrido de emergencia", () => {
  it("mueve todas las líneas en servicio que tienen proxy", async () => {
    prismaMock.waLine.findMany.mockResolvedValueOnce([{ id: "a", phone: "1" }, { id: "b", phone: "2" }] as never);
    prismaMock.waLine.findUnique.mockResolvedValue(linea() as never);
    expect(await modoEmergencia("sin saldo")).toBe(2);
    expect(engineMock.setProxy).toHaveBeenCalledTimes(2);
  });

  it("apagado por env no mueve nada", async () => {
    process.env.PROXY_FALLBACK_DIRECTO = "off";
    expect(await modoEmergencia("sin saldo")).toBe(0);
    expect(prismaMock.waLine.findMany).not.toHaveBeenCalled();
  });

  it("sin líneas con proxy no hace nada", async () => {
    prismaMock.waLine.findMany.mockResolvedValueOnce([] as never);
    expect(await modoEmergencia("x")).toBe(0);
  });
});

describe("aviso al dueño", () => {
  it("dice cuántas líneas se movieron y que vuelven solas", () => {
    const t = textoEmergencia(9, "saldo agotado");
    expect(t).toContain("saldo agotado");
    expect(t).toContain("9 línea(s)");
    expect(t).toContain("vuelven solas");
  });
});
