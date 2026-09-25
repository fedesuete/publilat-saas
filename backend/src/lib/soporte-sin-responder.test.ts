import { describe, it, expect, vi, beforeEach } from "vitest";

// Una clienta esperó 35 h y el tablero decía "0 esperando": el acuse del robot hacía parecer que el
// ticket estaba atendido. Lo que se prueba acá es justamente que el robot NO cuente como respuesta.
const prismaMock = vi.hoisted(() => ({
  supportMessage: { findMany: vi.fn(async () => []) },
  user: { findUnique: vi.fn(async () => ({ email: "cliente@x.com" })) },
}));
vi.mock("./prisma.js", () => ({ prisma: prismaMock }));

import { ticketsSinResponder, textoTicketsColgados } from "./soporte-sin-responder.js";

const hs = (h: number) => new Date(Date.now() - h * 3600e3);
const msg = (userId: string, fromAdmin: boolean, auto: boolean, horas: number, body = "texto") =>
  ({ userId, fromAdmin, auto, body, createdAt: hs(horas) });

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.user.findUnique.mockResolvedValue({ email: "cliente@x.com" } as never);
});

describe("tickets sin responder de verdad", () => {
  it("el ACUSE del robot NO cuenta como respuesta (el caso real)", async () => {
    prismaMock.supportMessage.findMany.mockResolvedValueOnce([
      msg("u1", false, false, 35, "no me explicás el anti baneo?"),
      msg("u1", true, true, 35, "🤖 Mensaje automático: recibimos su mensaje…"),
    ] as never);
    const r = await ticketsSinResponder(4);
    expect(r).toHaveLength(1);
    expect(r[0].horas).toBe(35);
    expect(r[0].ultimoDelCliente).toContain("anti baneo");
  });

  it("una respuesta HUMANA posterior sí cierra el ticket", async () => {
    prismaMock.supportMessage.findMany.mockResolvedValueOnce([
      msg("u1", false, false, 10),
      msg("u1", true, true, 10, "🤖 acuse"),
      msg("u1", true, false, 9, "Hola, te cuento…"),
    ] as never);
    expect(await ticketsSinResponder(4)).toHaveLength(0);
  });

  it("si el cliente vuelve a escribir DESPUÉS de nuestra respuesta, queda abierto otra vez", async () => {
    prismaMock.supportMessage.findMany.mockResolvedValueOnce([
      msg("u1", false, false, 30),
      msg("u1", true, false, 29, "te respondo…"),
      msg("u1", false, false, 8, "gracias, pero sigue sin andar"),
    ] as never);
    const r = await ticketsSinResponder(4);
    expect(r).toHaveLength(1);
    expect(r[0].horas).toBe(8);
  });

  it("respeta el plazo: recién escrito no se avisa", async () => {
    prismaMock.supportMessage.findMany.mockResolvedValueOnce([msg("u1", false, false, 1)] as never);
    expect(await ticketsSinResponder(4)).toHaveLength(0);
  });

  it("un cliente que nunca escribió no aparece", async () => {
    prismaMock.supportMessage.findMany.mockResolvedValueOnce([msg("u1", true, false, 20, "aviso nuestro")] as never);
    expect(await ticketsSinResponder(4)).toHaveLength(0);
  });

  it("ordena por quien más espera", async () => {
    prismaMock.supportMessage.findMany.mockResolvedValueOnce([
      msg("u1", false, false, 6),
      msg("u2", false, false, 40),
      msg("u3", false, false, 20),
    ] as never);
    const r = await ticketsSinResponder(4);
    expect(r.map((t) => t.horas)).toEqual([40, 20, 6]);
  });
});

describe("texto del aviso", () => {
  it("nombra a los clientes y aclara lo del acuse", () => {
    const t = textoTicketsColgados([{ userId: "u1", email: "a@x.com", horas: 35, ultimoDelCliente: "no anda" }]);
    expect(t).toContain("1 cliente esperando");
    expect(t).toContain("a@x.com — hace 35 h");
    expect(t).toContain("no anda");
    expect(t).toContain("acuse automático no cuenta");
  });
  it("con muchos, muestra los 5 primeros y cuenta el resto", () => {
    const muchos = Array.from({ length: 7 }, (_, i) => ({ userId: `u${i}`, email: `c${i}@x.com`, horas: 10, ultimoDelCliente: "x" }));
    expect(textoTicketsColgados(muchos)).toContain("y 2 más");
  });
});
