import { describe, it, expect } from "vitest";
import { jornadasRestantes, textoRitmo } from "./credit-rate.js";

// Un cliente compró 60 días creyendo que eran dos meses; con dos números prendidos le duraron 29.
describe("jornadas que aguanta el saldo", () => {
  it("con un solo número, días y jornadas son lo mismo", () => {
    expect(jornadasRestantes(26, 1)).toBe(26);
  });
  it("con varios números se divide (el caso del cliente)", () => {
    expect(jornadasRestantes(60, 2)).toBe(30);
    expect(jornadasRestantes(26, 3)).toBe(8);
  });
  it("redondea para abajo: no se prometen jornadas incompletas", () => {
    expect(jornadasRestantes(5, 2)).toBe(2);
    expect(jornadasRestantes(1, 3)).toBe(0);
  });
  it("sin números prendidos el saldo no se gasta", () => {
    expect(jornadasRestantes(10, 0)).toBe(10);
  });
  it("sin saldo, cero", () => {
    expect(jornadasRestantes(0, 3)).toBe(0);
    expect(jornadasRestantes(-2, 1)).toBe(0);
  });
});

describe("la frase que ve el cliente", () => {
  it("con 0 o 1 número no dice nada (no hay qué aclarar)", () => {
    expect(textoRitmo(26, 1)).toBeNull();
    expect(textoRitmo(26, 0)).toBeNull();
  });
  it("con varios explica el ritmo y las jornadas", () => {
    const t = textoRitmo(26, 3)!;
    expect(t).toContain("3 números");
    expect(t).toContain("3 días por jornada");
    expect(t).toContain("8 jornadas");
  });
  it("una sola jornada va en singular", () => {
    expect(textoRitmo(2, 2)!).toContain("1 jornada.");
  });
});
