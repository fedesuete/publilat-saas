// Quién es del equipo: lo que escriben ellos en el grupo de un cliente NO se relayea.
import { describe, it, expect } from "vitest";
import { normalizarId, remitenteDe, esDelEquipo } from "./soporte-relay.js";

describe("normalizarId", () => {
  it("un LID queda como lid, un teléfono como dígitos", () => {
    expect(normalizarId("273689006338271@lid")).toBe("273689006338271@lid");
    expect(normalizarId("5491168315055@s.whatsapp.net")).toBe("5491168315055");
    expect(normalizarId("5491168315055@c.us")).toBe("5491168315055");
    expect(normalizarId("+54 9 11 6831-5055")).toBe("5491168315055");
  });
  it("basura → null", () => {
    expect(normalizarId("")).toBeNull();
    expect(normalizarId(null)).toBeNull();
    expect(normalizarId("abc")).toBeNull();
  });
});

describe("remitenteDe (las formas en que WhatsApp manda quién escribió en un grupo)", () => {
  it("participant como LID + participantPn con el teléfono", () => {
    const r = remitenteDe({ participant: "40506457342147@lid", _data: { key: { participant: "40506457342147@lid", participantPn: "5491168315055@s.whatsapp.net" } } });
    expect(r).toContain("40506457342147@lid");
    expect(r).toContain("5491168315055");
  });
  it("solo teléfono (grupos sin modo LID)", () => {
    expect(remitenteDe({ participant: "5491124547768@c.us" })).toEqual(["5491124547768"]);
  });
  it("sin remitente → vacío (y entonces no es del equipo)", () => {
    expect(remitenteDe({})).toEqual([]);
    expect(remitenteDe(null)).toEqual([]);
  });
});

describe("esDelEquipo", () => {
  const equipo = new Set(["40506457342147@lid", "5491168315055", "5491124547768"]);
  it("matchea por LID aunque el teléfono venga oculto", () => {
    expect(esDelEquipo(["40506457342147@lid"], equipo)).toBe(true);
  });
  it("matchea por teléfono aunque el LID sea otro", () => {
    expect(esDelEquipo(["999@lid", "5491124547768"], equipo)).toBe(true);
  });
  it("un cliente no matchea", () => {
    expect(esDelEquipo(["123@lid", "5492235385161"], equipo)).toBe(false);
    expect(esDelEquipo([], equipo)).toBe(false);
  });
});
