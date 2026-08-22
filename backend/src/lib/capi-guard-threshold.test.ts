import { describe, it, expect, vi } from "vitest";

// capi-guard.ts importa prisma/notifications/mailer (no en el runner): mock para importar la fn pura.
vi.mock("./prisma.js", () => ({ prisma: {} }));
vi.mock("./notifications.js", () => ({ notify: vi.fn() }));
vi.mock("./mailer.js", () => ({ sendAdminMail: vi.fn() }));

import { shouldAlertToken } from "./capi-guard.js";

describe("shouldAlertToken (no gritar 'token vencido' por 1 fallo suelto)", () => {
  it("1 fallo entre 300 OK → NO alerta (ruido)", () => {
    expect(shouldAlertToken(1, 300)).toBe(false);
  });
  it("muchos fallos y casi 0 OK → SÍ alerta (token probablemente muerto)", () => {
    expect(shouldAlertToken(20, 1)).toBe(true);
  });
  it("sin envíos exitosos y varios fallos → alerta", () => {
    expect(shouldAlertToken(5, 0)).toBe(true);
  });
  it("tasa de fallo alta con volumen → alerta", () => {
    expect(shouldAlertToken(10, 5)).toBe(true); // 10/15 = 67% falla
  });
  it("pocos fallos aislados sin envíos → NO alerta todavía (1-2 puede ser transitorio)", () => {
    expect(shouldAlertToken(2, 0)).toBe(false);
  });
});
