import { describe, it, expect, vi, beforeEach } from "vitest";

// "No hay pool" NO es "el pool está lleno". Cuando el sistema corre a propósito por la IP del
// servidor no hay nada que avisar ni nada que sumar al pool: el 28/09 salieron 458 avisos de
// "pool lleno" en 12 horas por un pool que no existe, y entre tanto ruido se pierde lo importante.
const prismaMock = vi.hoisted(() => ({
  waLine: { findUnique: vi.fn(), findMany: vi.fn(async () => []), update: vi.fn(async () => ({})) },
  proxy: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0), findUnique: vi.fn() },
  user: { findMany: vi.fn(async () => []) },
  proxyEvent: { create: vi.fn(async () => ({})) },
}));
const notifyMock = vi.hoisted(() => ({ notify: vi.fn(async () => undefined) }));
vi.mock("./prisma.js", () => ({ prisma: prismaMock }));
vi.mock("./notifications.js", () => notifyMock);
vi.mock("./io.js", () => ({ emitToUser: vi.fn() }));
vi.mock("./admin-whatsapp.js", () => ({ sendAdminWhatsApp: vi.fn() }));
vi.mock("./wa-engine.js", () => ({ getEngine: () => ({ setProxy: vi.fn() }) }));
vi.mock("./secrets.js", () => ({ decryptSecret: (s: string) => s, encryptSecret: (s: string) => s }));

const { assignProxy } = await import("./proxy-pool.js");

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.waLine.findUnique.mockResolvedValue({ id: "l1", provider: "baileys", label: "FEDE", proxyBlockedUntil: null } as never);
});

describe("sin pool de proxies", () => {
  it("no avisa nada y devuelve sin_pool", async () => {
    prismaMock.proxy.findMany.mockResolvedValueOnce([] as never);
    const r = await assignProxy("l1");
    expect(r).toEqual({ ok: false, reason: "sin_pool" });
    expect(notifyMock.notify).not.toHaveBeenCalled(); // NADA de "pool lleno"
  });

  it("con pool pero LLENO sí avisa (ahí sí hay algo que hacer)", async () => {
    prismaMock.proxy.findMany.mockResolvedValueOnce([{ id: "p1", provider: "iproyal", maxLines: 5, _count: { lines: 5 } }] as never);
    prismaMock.user.findMany.mockResolvedValue([{ id: "admin1" }] as never);
    const r = await assignProxy("l1");
    expect(r.reason).toBe("pool_full");
    expect(notifyMock.notify).toHaveBeenCalled();
  });

  it("con pool y cupo, asigna normal", async () => {
    prismaMock.proxy.findMany.mockResolvedValueOnce([{ id: "p1", provider: "iproyal", maxLines: 40, _count: { lines: 9 } }] as never);
    prismaMock.proxy.findUnique.mockResolvedValue({ id: "p1", provider: "iproyal", host: "h", port: 1, username: "u", password: "p", country: "ar" } as never);
    prismaMock.waLine.update.mockResolvedValue({} as never);
    const r = await assignProxy("l1");
    expect(r.ok).toBe(true);
    expect(notifyMock.notify).not.toHaveBeenCalled();
  });
});
