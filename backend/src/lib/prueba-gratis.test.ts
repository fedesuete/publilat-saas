import { describe, it, expect } from "vitest";
import { pasoPendiente, textoPaso, claveInicial } from "./prueba-gratis.js";

const inicio = new Date("2026-10-22T12:00:00Z");
const en = (h: number) => new Date(inicio.getTime() + h * 3600e3);

describe("mensajes de la prueba de 5 días", () => {
  it("día 1 a las 2 h, día 3 a las 48 h, día 5 a las 96 h", () => {
    expect(pasoPendiente(inicio, 0, en(1))).toBeNull();
    expect(pasoPendiente(inicio, 0, en(2))).toBe(1);
    expect(pasoPendiente(inicio, 1, en(30))).toBeNull();
    expect(pasoPendiente(inicio, 1, en(48))).toBe(2);
    expect(pasoPendiente(inicio, 2, en(96))).toBe(3);
    expect(pasoPendiente(inicio, 3, en(200))).toBeNull();
  });
  it("si se atrasó (server caído), manda solo el más reciente", () => {
    expect(pasoPendiente(inicio, 0, en(100))).toBe(3);
  });
  it("el día 5 avisa que termina y lleva al pago; textos sin palabras prohibidas", () => {
    const t = textoPaso(3, "Ana María");
    expect(t.texto).toContain("Hola Ana!");
    expect(t.texto).toContain("/billing");
    for (const s of [1, 2, 3]) expect(textoPaso(s, null).texto).not.toMatch(/casino|apuesta|ficha|ruleta|premio/i);
  });
  it("la clave inicial tiene 8 caracteres legibles", () => {
    const c = claveInicial();
    expect(c).toMatch(/^[a-km-np-z2-9]{8}$/);
  });
});
