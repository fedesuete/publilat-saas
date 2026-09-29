// Ventas a medio hacer: que el link se pueda recuperar, que el aviso no se repita y que el texto
// diga lo que hay que hacer.
import { describe, it, expect, beforeEach } from "vitest";
import {
  checkoutUrl,
  paraAvisarPago,
  reiniciarAvisosPago,
  textoPagosColgados,
  type PagoColgado,
} from "./pago-pendiente.js";

const pago = (over: Partial<PagoColgado> = {}): PagoColgado => ({
  paymentId: "p1",
  userId: "u1",
  email: "cliente@test.com",
  provider: "pagopar",
  days: 30,
  amount: 450000,
  currency: "PYG",
  minutos: 45,
  estado: "abierto",
  url: checkoutUrl("abc123"),
  ...over,
});

describe("checkoutUrl", () => {
  it("reconstruye el link de Pagopar desde el hash que ya guardamos", () => {
    // Es lo que permite devolverle el pago al cliente sin guardar una columna nueva.
    expect(checkoutUrl("abc123")).toBe("https://www.pagopar.com/pagos/abc123");
  });
});

describe("paraAvisarPago", () => {
  beforeEach(() => reiniciarAvisosPago());

  it("avisa la primera vez", () => {
    expect(paraAvisarPago([pago()])).toHaveLength(1);
  });

  it("no repite el aviso del mismo pago (el job corre cada 15 min)", () => {
    const ahora = Date.now();
    paraAvisarPago([pago()], ahora);
    expect(paraAvisarPago([pago()], ahora + 60_000)).toHaveLength(0);
  });

  it("vuelve a avisar pasadas las horas de reaviso", () => {
    const ahora = Date.now();
    paraAvisarPago([pago()], ahora);
    expect(paraAvisarPago([pago()], ahora + 13 * 3600_000)).toHaveLength(1);
  });

  it("un pago nuevo del mismo cliente sí avisa", () => {
    const ahora = Date.now();
    paraAvisarPago([pago()], ahora);
    expect(paraAvisarPago([pago({ paymentId: "p2" })], ahora + 60_000)).toHaveLength(1);
  });
});

describe("textoPagosColgados", () => {
  beforeEach(() => reiniciarAvisosPago());

  it("incluye el link para poder pasárselo al cliente", () => {
    const t = textoPagosColgados([pago()]);
    expect(t).toContain("https://www.pagopar.com/pagos/abc123");
    expect(t).toContain("cliente@test.com");
    expect(t).toContain("30 días");
  });

  it("singular con uno, plural con varios", () => {
    expect(textoPagosColgados([pago()])).toContain("Hay 1 cliente");
    expect(textoPagosColgados([pago(), pago({ paymentId: "p2" })])).toContain("Hay 2 clientes");
  });

  it("muestra minutos hasta hora y media, después horas", () => {
    expect(textoPagosColgados([pago({ minutos: 45 })])).toContain("hace 45 min");
    expect(textoPagosColgados([pago({ minutos: 180 })])).toContain("hace 3 h");
  });

  it("corta a 5 y dice cuántos más quedan", () => {
    const muchos = Array.from({ length: 8 }, (_, i) => pago({ paymentId: `p${i}` }));
    expect(textoPagosColgados(muchos)).toContain("y 3 más");
  });

  it("el pendiente de USDT se explica distinto (no hay link que mandar)", () => {
    const t = textoPagosColgados([
      pago({ provider: "usdt", url: undefined, usdt: { address: "TR...", amountUsdt: 60 } }),
    ]);
    expect(t).toContain("nunca pegó el comprobante");
    expect(t).not.toContain("pagopar.com");
  });
});
