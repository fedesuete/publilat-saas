import { describe, it, expect, vi, beforeEach } from "vitest";

// Barrido de proxies huérfanos: una línea que no está en uso tiene que DEVOLVER su proxy al pool.
// Sin esto se acumulaban líneas muertas con el cupo tomado (16 de 25 el 2026-09-19, y 3 más que ya
// estaban `inactive` y el primer arreglo no alcanzaba). El riesgo del lado opuesto es peor: sacarle
// el proxy a una línea VIVA le cambia la IP y WhatsApp la restringe. Por eso los filtros son duros.
const prismaMock = vi.hoisted(() => ({
  waLine: { findMany: vi.fn(async () => []), update: vi.fn(async () => ({})) },
  inboundDedup: { deleteMany: vi.fn(async () => ({ count: 0 })) },
}));
vi.mock("./prisma.js", () => ({ prisma: prismaMock }));
vi.mock("./io.js", () => ({ emitToUser: vi.fn() }));
vi.mock("./access.js", () => ({ consumeDayAndActivate: vi.fn(async () => false), consumeChatDayAndActivate: vi.fn(async () => false) }));
const releaseProxyMock = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("./proxy-pool.js", () => ({
  releaseProxy: releaseProxyMock,
  rotateProxy: vi.fn(), applyLineProxy: vi.fn(), logProxyEvent: vi.fn(), alertAdminProxy: vi.fn(),
  probeProxy: vi.fn(), assignFallback: vi.fn(), assignProxyPreferred: vi.fn(), setLineWaitingProxy: vi.fn(),
  verifyIproyalLine: vi.fn(), IPROYAL_PROVIDER: "iproyal_residential_ar",
}));

import { releaseProxiesFromDeadLines } from "./queue.js";

beforeEach(() => vi.clearAllMocks());

describe("releaseProxiesFromDeadLines", () => {
  it("devuelve el proxy de cada línea sin uso", async () => {
    prismaMock.waLine.findMany.mockResolvedValueOnce([{ id: "l1" }, { id: "l2" }, { id: "l3" }] as never);
    const n = await releaseProxiesFromDeadLines();
    expect(n).toBe(3);
    expect(releaseProxyMock).toHaveBeenCalledTimes(3);
    expect(releaseProxyMock).toHaveBeenCalledWith("l1");
  });

  it("no toca nada si no hay líneas huérfanas", async () => {
    prismaMock.waLine.findMany.mockResolvedValueOnce([] as never);
    expect(await releaseProxiesFromDeadLines()).toBe(0);
    expect(releaseProxyMock).not.toHaveBeenCalled();
  });

  it("sólo busca líneas DESCONECTADAS, con proxy, no-cloud y sin día vigente", async () => {
    prismaMock.waLine.findMany.mockResolvedValueOnce([] as never);
    await releaseProxiesFromDeadLines();
    const where = prismaMock.waLine.findMany.mock.calls[0][0].where;
    // Nunca le saca el proxy a una sesión viva ni a una línea Cloud API.
    expect(where.connected).toBe(false);
    expect(where.proxyId).toEqual({ not: null });
    expect(where.provider).toEqual({ not: "cloud" });
    // Vencida, o creada hace rato y nunca activada (expiresAt null).
    expect(where.OR).toHaveLength(2);
    expect(where.OR[0].expiresAt.lt).toBeInstanceOf(Date);
    expect(where.OR[1].expiresAt).toBeNull();
    expect(where.OR[1].createdAt.lt).toBeInstanceOf(Date);
    // El corte de "nunca activada" es de 24 h, no del momento (una línea recién creada conserva su proxy).
    const margen = Date.now() - where.OR[1].createdAt.lt.getTime();
    expect(margen).toBeGreaterThan(23 * 3600_000);
    expect(margen).toBeLessThan(25 * 3600_000);
  });

  it("si un release falla, sigue con las demás", async () => {
    prismaMock.waLine.findMany.mockResolvedValueOnce([{ id: "l1" }, { id: "l2" }] as never);
    releaseProxyMock.mockRejectedValueOnce(new Error("pool caído") as never);
    expect(await releaseProxiesFromDeadLines()).toBe(2);
    expect(releaseProxyMock).toHaveBeenCalledTimes(2);
  });
});
