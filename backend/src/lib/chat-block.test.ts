import { describe, it, expect, vi, beforeEach } from "vitest";

// Bloqueo de jugadores del Chat App (05/11): el bloqueado no pasa requireChatClient, y "blocked_ip"
// frena registros nuevos desde su IP en ESA cuenta.
const prismaMock = vi.hoisted(() => ({
  chatPlayer: { findUnique: vi.fn(), count: vi.fn() },
}));
vi.mock("./prisma.js", () => ({ prisma: prismaMock }));

const { jugadorBloqueado, olvidarBloqueo, ipBloqueada, estaBloqueado } = await import("./chat-block.js");

beforeEach(() => vi.clearAllMocks());

describe("bloqueo de jugadores", () => {
  it("blocked y blocked_ip cuentan como bloqueado; active no", () => {
    expect(estaBloqueado("blocked")).toBe(true);
    expect(estaBloqueado("blocked_ip")).toBe(true);
    expect(estaBloqueado("active")).toBe(false);
    expect(estaBloqueado(undefined)).toBe(false);
  });

  it("cachea el estado y al desbloquear se vuelve a leer", async () => {
    prismaMock.chatPlayer.findUnique.mockResolvedValueOnce({ estatus: "blocked" } as never);
    expect(await jugadorBloqueado("p1")).toBe(true);
    expect(await jugadorBloqueado("p1")).toBe(true);
    expect(prismaMock.chatPlayer.findUnique).toHaveBeenCalledTimes(1);
    olvidarBloqueo("p1");
    prismaMock.chatPlayer.findUnique.mockResolvedValueOnce({ estatus: "active" } as never);
    expect(await jugadorBloqueado("p1")).toBe(false);
  });

  it("IP bloqueada solo en esa cuenta y solo con blocked_ip", async () => {
    prismaMock.chatPlayer.count.mockResolvedValueOnce(1 as never);
    expect(await ipBloqueada("acc1", "190.1.2.3")).toBe(true);
    expect(prismaMock.chatPlayer.count).toHaveBeenCalledWith({ where: { userId: "acc1", estatus: "blocked_ip", clientIp: "190.1.2.3" } });
    expect(await ipBloqueada("acc1", null)).toBe(false);
  });
});
