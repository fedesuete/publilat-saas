import { describe, it, expect } from "vitest";
import { usdtCubre } from "./payments.js";

// Tolerancia de comisiones del USDT directo (5%): un pago real no rebota por lo que se come el exchange.
describe("usdtCubre", () => {
  it("acepta el monto exacto, un poco de más y hasta 5% menos", () => {
    expect(usdtCubre(8, 8)).toBe(true);
    expect(usdtCubre(8.01, 8)).toBe(true);
    expect(usdtCubre(77, 80)).toBe(true);
  });
  it("rechaza si falta más del 5% (ej. 8 USDT para un paquete de 16)", () => {
    expect(usdtCubre(8, 16)).toBe(false);
    expect(usdtCubre(75, 80)).toBe(false);
  });
});
