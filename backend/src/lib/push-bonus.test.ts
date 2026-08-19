import { describe, it, expect, afterEach } from "vitest";
import { pushBonusFor, pushOnMilestoneBody, appInstalledMilestoneBody } from "./push-bonus.js";

const prev = process.env.PUSH_BONUS_BY_SLUG;
afterEach(() => {
  if (prev === undefined) delete process.env.PUSH_BONUS_BY_SLUG;
  else process.env.PUSH_BONUS_BY_SLUG = prev;
});

describe("pushBonusFor", () => {
  it("cuenta en el piloto → monto; el resto → null", () => {
    process.env.PUSH_BONUS_BY_SLUG = '{"matias":2000}';
    expect(pushBonusFor("matias")).toBe(2000);
    expect(pushBonusFor("pulpo")).toBeNull();
  });
  it("sin env o env rota → null (nunca explota)", () => {
    delete process.env.PUSH_BONUS_BY_SLUG;
    expect(pushBonusFor("matias")).toBeNull();
    process.env.PUSH_BONUS_BY_SLUG = "esto no es json";
    expect(pushBonusFor("matias")).toBeNull();
  });
});

describe("cuerpos de hito (los ve el jugador Y el operador: redaccion neutra)", () => {
  it("notis con bono → menciona el monto y cómo reclamarlo", () => {
    const b = pushOnMilestoneBody(2000);
    expect(b).toContain("Notificaciones activadas");
    expect(b).toContain("2.000 fichas");
    expect(b).toContain("cajero");
  });
  it("notis sin bono → chip neutro sin fichas", () => {
    const b = pushOnMilestoneBody(null);
    expect(b).toContain("Notificaciones activadas");
    expect(b).not.toContain("fichas");
  });
  it("app instalada → chip neutro", () => {
    expect(appInstalledMilestoneBody()).toContain("App instalada");
  });
});
