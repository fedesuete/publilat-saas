// La auto-carga decide si las fichas las acredita el callback del socio o el cajero a mano, así que
// un cambio acá mueve plata. Estos tests fijan que el interruptor NUEVO por cuenta
// (`User.casinoAutoCredit`) no altere el comportamiento de las cuentas que ya están funcionando:
// con el campo en null todo tiene que decidirse igual que antes, por el secreto global del .env.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./prisma.js", () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));
vi.mock("./notifications.js", () => ({ notify: vi.fn() }));

import { prisma } from "./prisma.js";
import { casinoAutoCreditForAccount } from "./casino-cashier.js";

const p = prisma as unknown as { user: { findUnique: ReturnType<typeof vi.fn> } };
const secretoOriginal = process.env.CHAT_PAY_WEBHOOK_SECRET;

const conFlag = (casinoAutoCredit: boolean | null) => p.user.findUnique.mockResolvedValue({ casinoAutoCredit });

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  if (secretoOriginal === undefined) delete process.env.CHAT_PAY_WEBHOOK_SECRET;
  else process.env.CHAT_PAY_WEBHOOK_SECRET = secretoOriginal;
});

describe("casinoAutoCreditForAccount", () => {
  it("sin el secreto del callback no hay auto-carga, ni siquiera con el flag en true", async () => {
    delete process.env.CHAT_PAY_WEBHOOK_SECRET;
    conFlag(true);
    expect(await casinoAutoCreditForAccount("u1")).toBe(false);
  });

  it("sin el secreto ni consulta la cuenta (no hay nada que decidir)", async () => {
    delete process.env.CHAT_PAY_WEBHOOK_SECRET;
    await casinoAutoCreditForAccount("u1");
    expect(p.user.findUnique).not.toHaveBeenCalled();
  });

  it("flag en null = comportamiento de siempre: con el secreto puesto, auto-carga", async () => {
    process.env.CHAT_PAY_WEBHOOK_SECRET = "s3cr3t";
    conFlag(null);
    expect(await casinoAutoCreditForAccount("u1")).toBe(true);
  });

  it("flag en false: el cajero acredita a mano aunque el secreto global esté puesto", async () => {
    process.env.CHAT_PAY_WEBHOOK_SECRET = "s3cr3t";
    conFlag(false);
    expect(await casinoAutoCreditForAccount("u1")).toBe(false);
  });

  it("flag en true con el secreto puesto: auto-carga", async () => {
    process.env.CHAT_PAY_WEBHOOK_SECRET = "s3cr3t";
    conFlag(true);
    expect(await casinoAutoCreditForAccount("u1")).toBe(true);
  });

  it("cuenta inexistente: cae al comportamiento global (no rompe)", async () => {
    process.env.CHAT_PAY_WEBHOOK_SECRET = "s3cr3t";
    p.user.findUnique.mockResolvedValue(null);
    expect(await casinoAutoCreditForAccount("fantasma")).toBe(true);
  });
});
