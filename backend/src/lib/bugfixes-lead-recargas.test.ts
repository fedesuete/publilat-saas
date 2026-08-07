import { describe, it, expect, afterEach } from "vitest";
import { leadOnInboundDefault } from "./meta-events.js";
import { withinRecheckCooldown, rechargeEventId } from "./payment-detect.js";

// ===== BUG 1: el Lead se dispara en el PRIMER INBOUND por default, no en el clic =====
describe("leadOnInboundDefault (BUG 1)", () => {
  const prev = process.env.LEAD_ON_INBOUND_DEFAULT;
  afterEach(() => {
    if (prev === undefined) delete process.env.LEAD_ON_INBOUND_DEFAULT;
    else process.env.LEAD_ON_INBOUND_DEFAULT = prev;
  });

  it("por default está ON (Lead en el inbound, NO en el clic)", () => {
    delete process.env.LEAD_ON_INBOUND_DEFAULT;
    expect(leadOnInboundDefault()).toBe(true);
  });
  it("'off' vuelve al comportamiento viejo (Lead en el clic)", () => {
    process.env.LEAD_ON_INBOUND_DEFAULT = "off";
    expect(leadOnInboundDefault()).toBe(false);
  });
  it("'on' explícito = ON", () => {
    process.env.LEAD_ON_INBOUND_DEFAULT = "on";
    expect(leadOnInboundDefault()).toBe(true);
  });
});

// ===== BUG 2: cooldown de re-detección (reemplaza el guard "ya compró") =====
describe("withinRecheckCooldown (BUG 2)", () => {
  const H = 60 * 60 * 1000;
  const now = Date.parse("2026-08-07T12:00:00.000Z");

  it("nunca se detectó nada (null) → NO en cooldown → procesa", () => {
    expect(withinRecheckCooldown(null, now, H)).toBe(false);
    expect(withinRecheckCooldown(undefined, now, H)).toBe(false);
  });
  it("detección hace 10 min → EN cooldown → saltea (no dispara otro Purchase por el mismo pago)", () => {
    expect(withinRecheckCooldown(new Date(now - 10 * 60 * 1000), now, H)).toBe(true);
  });
  it("detección hace 2 h (cooldown 1h) → FUERA → la recarga SÍ se procesa (antes 'ya compró' la mataba)", () => {
    expect(withinRecheckCooldown(new Date(now - 2 * H), now, H)).toBe(false);
  });
  it("acepta el timestamp como string ISO", () => {
    expect(withinRecheckCooldown(new Date(now - 5 * 60 * 1000).toISOString(), now, H)).toBe(true);
  });
});

// ===== BUG 2: eventId único por comprobante para que Meta cuente cada recarga =====
describe("rechargeEventId (BUG 2)", () => {
  it("comprobantes distintos (waMessageId distinto) → eventId distinto (cada recarga cuenta)", () => {
    const a = rechargeEventId("ext-1", "msgA");
    const b = rechargeEventId("ext-1", "msgB");
    expect(a).not.toBe(b);
    expect(a).toBe("ext-1:purchase:msgA");
  });
  it("el MISMO comprobante → mismo eventId (Meta deduplica el re-envío de la misma imagen)", () => {
    expect(rechargeEventId("ext-1", "msgA")).toBe(rechargeEventId("ext-1", "msgA"));
  });
  it("nunca colisiona con el eventId estable del 'Compró' manual", () => {
    expect(rechargeEventId("ext-1", "msgA")).not.toBe("ext-1:purchase");
  });
});
