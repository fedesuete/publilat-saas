import { describe, it, expect, vi, beforeEach } from "vitest";

// El aviso por WhatsApp al dueño: sale una vez por tipo cada 6 h, desde una línea en servicio, y
// nunca rompe nada si no hay línea (mail + campanita siguen por su lado).
const prismaMock = vi.hoisted(() => ({ waLine: { findFirst: vi.fn() } }));
const engineMock = vi.hoisted(() => ({ sendText: vi.fn(async () => ({})) }));
vi.mock("./prisma.js", () => ({ prisma: prismaMock }));
vi.mock("./wa-engine.js", () => ({ getEngine: () => engineMock }));

import { sendAdminWhatsApp, resetAdminWhatsAppThrottle } from "./admin-whatsapp.js";

beforeEach(() => {
  vi.clearAllMocks();
  resetAdminWhatsAppThrottle();
});

describe("aviso al dueño por WhatsApp", () => {
  it("manda desde la línea configurada al número del dueño", async () => {
    prismaMock.waLine.findFirst.mockResolvedValueOnce({ id: "l1", sessionId: null, phone: "5492236020072" } as never);
    expect(await sendAdminWhatsApp("iproyal_low", "Quedan 0.3 GB")).toBe(true);
    expect(engineMock.sendText).toHaveBeenCalledWith("line_l1", "595975112248", expect.stringContaining("Quedan 0.3 GB"));
  });

  it("freno: el mismo tipo de aviso NO se repite dentro de las 6 h", async () => {
    prismaMock.waLine.findFirst.mockResolvedValue({ id: "l1", sessionId: null, phone: "5492236020072" } as never);
    expect(await sendAdminWhatsApp("iproyal_low", "1")).toBe(true);
    expect(await sendAdminWhatsApp("iproyal_low", "2")).toBe(false);
    expect(engineMock.sendText).toHaveBeenCalledTimes(1);
  });

  it("otro tipo de aviso sí sale aunque el anterior esté frenado", async () => {
    prismaMock.waLine.findFirst.mockResolvedValue({ id: "l1", sessionId: null, phone: "5492236020072" } as never);
    await sendAdminWhatsApp("iproyal_low", "1");
    expect(await sendAdminWhatsApp("line_storm", "2")).toBe(true);
    expect(engineMock.sendText).toHaveBeenCalledTimes(2);
  });

  it("si la línea configurada no está en servicio, usa otra línea de un ADMIN", async () => {
    prismaMock.waLine.findFirst
      .mockResolvedValueOnce(null as never) // la preferida no está
      .mockResolvedValueOnce({ id: "l9", sessionId: "line_l9", phone: "5491100000000" } as never);
    expect(await sendAdminWhatsApp("x", "hola")).toBe(true);
    expect(engineMock.sendText).toHaveBeenCalledWith("line_l9", "595975112248", expect.any(String));
    // La segunda búsqueda excluye el número destino: mandarse a uno mismo no notifica.
    expect(prismaMock.waLine.findFirst.mock.calls[1][0]).toMatchObject({ where: { phone: { not: "595975112248" } } });
  });

  it("sin ninguna línea en servicio no manda y no rompe (y NO gasta el freno)", async () => {
    prismaMock.waLine.findFirst.mockResolvedValue(null as never);
    expect(await sendAdminWhatsApp("x", "hola")).toBe(false);
    expect(engineMock.sendText).not.toHaveBeenCalled();
    // Cuando aparezca una línea, el aviso tiene que poder salir sin esperar 6 h.
    prismaMock.waLine.findFirst.mockResolvedValue({ id: "l1", sessionId: null, phone: "5492236020072" } as never);
    expect(await sendAdminWhatsApp("x", "hola")).toBe(true);
  });

  it("si el motor falla, devuelve false sin lanzar", async () => {
    prismaMock.waLine.findFirst.mockResolvedValue({ id: "l1", sessionId: null, phone: "5492236020072" } as never);
    engineMock.sendText.mockRejectedValueOnce(new Error("422") as never);
    await expect(sendAdminWhatsApp("x", "hola")).resolves.toBe(false);
  });
});
