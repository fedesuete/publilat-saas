import { describe, it, expect, afterEach } from "vitest";
import { lineWeights, pickWeighted } from "./line-weights.js";

const prev = process.env.LINE_WEIGHTS;
afterEach(() => {
  if (prev === undefined) delete process.env.LINE_WEIGHTS;
  else process.env.LINE_WEIGHTS = prev;
});

describe("lineWeights", () => {
  it("parsea el JSON del env", () => {
    process.env.LINE_WEIGHTS = '{"a":0.2}';
    expect(lineWeights()).toEqual({ a: 0.2 });
  });
  it("env vacío o roto → {} (nunca explota)", () => {
    delete process.env.LINE_WEIGHTS;
    expect(lineWeights()).toEqual({});
    process.env.LINE_WEIGHTS = "no es json";
    expect(lineWeights()).toEqual({});
  });
});

describe("pickWeighted", () => {
  const L = (id: string, t: number | null) => ({ id, lastUsedAt: t === null ? null : new Date(t) });

  it("sin pesos → elige la menos usada (LRU normal)", () => {
    expect(pickWeighted([L("a", 100), L("b", 50)], {}, 200)!.id).toBe("b");
  });

  it("con pesos iguales, la nunca-usada (null) gana a una usada recién", () => {
    expect(pickWeighted([L("a", 900), L("n", null)], {}, 1000)!.id).toBe("n");
  });

  it("peso bajo: la línea frágil necesita estar MUCHO más vieja para ganar", () => {
    // c (peso 0.2) usada hace 100ms → score 100*0.2=20 ; a (peso 1) usada hace 50ms → score 50.
    // Gana a pese a estar menos vieja: c recibe menos turnos.
    expect(pickWeighted([L("a", 950), L("c", 900)], { c: 0.2 }, 1000)!.id).toBe("a");
  });

  it("una sola elegible → la devuelve aunque tenga peso bajo", () => {
    expect(pickWeighted([L("c", null)], { c: 0.1 }, 1000)!.id).toBe("c");
  });

  it("lista vacía → null", () => {
    expect(pickWeighted([], {}, 1)).toBeNull();
  });
});
