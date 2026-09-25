import { describe, it, expect, vi, beforeEach } from "vitest";

// El QR no puede depender del proxy: una sesión que arrastra un proxy muerto se queda en STARTING
// para siempre, el cliente cree que la línea está rota, la BORRA y pierde el día que pagó.
// (Pasó en prod el 2026-09-25 con la línea de Frijolito, apuntando a un IPRoyal sin saldo.)
process.env.WA_ENGINE = "waha";
process.env.WAHA_BASE_URL = "http://waha:3000";
process.env.WAHA_API_KEY = "k";

const prismaMock = vi.hoisted(() => ({ waLine: { findUnique: vi.fn() } }));
const engineMock = vi.hoisted(() => ({
  setProxy: vi.fn(async () => undefined),
  createInstance: vi.fn(async () => ({})),
}));
const sanoMock = vi.hoisted(() => ({ hayProxySano: vi.fn(async () => true) }));
vi.mock("./prisma.js", () => ({ prisma: prismaMock }));
vi.mock("./wa-engine.js", () => ({ getEngine: () => engineMock }));
vi.mock("./proxy-pool.js", () => ({ applyLineProxy: vi.fn(async () => undefined) }));
vi.mock("./session-guard.js", () => ({ markUserConnecting: vi.fn() }));
vi.mock("./proxy-emergencia.js", () => sanoMock);

const { conectarSesion } = await import("./qr-connect.js");

// Simula a WAHA: estado de la sesión, si la config arrastra proxy, y el QR.
function servidorFalso(opts: { estados: string[]; conProxy: boolean; qr?: boolean }) {
  let i = 0;
  return vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("/auth/qr")) {
      return opts.qr === false
        ? ({ ok: false, status: 422, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) } as unknown as Response)
        : ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(64), headers: new Map() } as unknown as Response);
    }
    // GET /api/sessions/<inst>
    const estado = opts.estados[Math.min(i, opts.estados.length - 1)];
    i++;
    return {
      ok: true,
      status: 200,
      json: async () => ({ status: estado, config: opts.conProxy ? { proxy: { server: "geo.iproyal.com:12321" } } : {} }),
    } as unknown as Response;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  sanoMock.hayProxySano.mockResolvedValue(true as never);
  prismaMock.waLine.findUnique.mockResolvedValue({ proxyId: null } as never);
});

describe("sesión colgada en STARTING por un proxy que ya no aplica", () => {
  it("la línea NO tiene proxy pero la sesión sí: se lo saca para destrabar el QR", async () => {
    globalThis.fetch = servidorFalso({ estados: ["STARTING", "SCAN_QR_CODE"], conProxy: true }) as never;
    await conectarSesion("line_x", "l1", { maxWaitMs: 50 });
    expect(engineMock.setProxy).toHaveBeenCalledWith("line_x", null);
  });

  it("la línea tiene proxy y el pool está SANO: no se toca nada (no reiniciamos al pedo)", async () => {
    prismaMock.waLine.findUnique.mockResolvedValue({ proxyId: "p1" } as never);
    globalThis.fetch = servidorFalso({ estados: ["SCAN_QR_CODE"], conProxy: true }) as never;
    await conectarSesion("line_x", "l1", { maxWaitMs: 50 });
    expect(engineMock.setProxy).not.toHaveBeenCalled();
  });

  it("la línea tiene proxy pero el POOL ESTÁ CAÍDO: se lo saca igual (mejor sin proxy que sin QR)", async () => {
    prismaMock.waLine.findUnique.mockResolvedValue({ proxyId: "p1" } as never);
    sanoMock.hayProxySano.mockResolvedValue(false as never);
    globalThis.fetch = servidorFalso({ estados: ["STARTING", "SCAN_QR_CODE"], conProxy: true }) as never;
    await conectarSesion("line_x", "l1", { maxWaitMs: 50 });
    expect(engineMock.setProxy).toHaveBeenCalledWith("line_x", null);
  });

  it("la sesión NO arrastra proxy: no se toca nada", async () => {
    globalThis.fetch = servidorFalso({ estados: ["STARTING", "SCAN_QR_CODE"], conProxy: false }) as never;
    await conectarSesion("line_x", "l1", { maxWaitMs: 50 });
    expect(engineMock.setProxy).not.toHaveBeenCalled();
  });

  it("una sesión que YA ANDA no se toca nunca, aunque el pool esté caído", async () => {
    prismaMock.waLine.findUnique.mockResolvedValue({ proxyId: "p1" } as never);
    sanoMock.hayProxySano.mockResolvedValue(false as never);
    globalThis.fetch = servidorFalso({ estados: ["WORKING"], conProxy: true }) as never;
    const r = await conectarSesion("line_x", "l1", { maxWaitMs: 50 });
    expect(r.status).toBe("connected");
    expect(engineMock.setProxy).not.toHaveBeenCalled();
  });
});
