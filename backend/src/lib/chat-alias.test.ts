// Login por alias: lo que escribe el jugador contra lo que agendó el cajero.
import { describe, it, expect } from "vitest";
import { normalizarAlias, aliasCoincide } from "./chat-alias.js";

describe("normalizarAlias", () => {
  it("saca mayúsculas, espacios de más y el ' vip' de los cajeros", () => {
    expect(normalizarAlias("  AleeFischer1  VIP ")).toBe("aleefischer1");
    expect(normalizarAlias("aleefischer1 vip")).toBe("aleefischer1");
    expect(normalizarAlias("Jjuancarh1")).toBe("jjuancarh1");
  });
  it("no rompe un usuario que contiene 'vip' en el medio", () => {
    expect(normalizarAlias("vipjuan")).toBe("vipjuan");
    expect(normalizarAlias("juanvip")).toBe("juanvip");
  });
  it("aguanta vacío", () => {
    expect(normalizarAlias(null)).toBe("");
    expect(normalizarAlias("")).toBe("");
  });
});

describe("aliasCoincide", () => {
  it("el caso real: el jugador escribe su usuario del casino, el cajero lo agendó con ' vip'", () => {
    expect(aliasCoincide("aleefischer1 vip", "aleefischer1")).toBe(true);
    expect(aliasCoincide("aleefischer1 vip", "AleeFischer1")).toBe(true);
  });
  it("tiene que ser el mismo, no un pedazo (no meter a nadie en el chat de otro)", () => {
    expect(aliasCoincide("aleefischer1 vip", "aleefischer")).toBe(false);
    expect(aliasCoincide("aleefischer12 vip", "aleefischer1")).toBe(false);
  });
  it("sin alias o con texto muy corto, nunca coincide", () => {
    expect(aliasCoincide(null, "ale")).toBe(false);
    expect(aliasCoincide("a", "a")).toBe(false);
  });
});
