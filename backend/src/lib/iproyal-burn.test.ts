import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./line-weights.js", () => ({ recentFlaps: vi.fn(() => 0) }));
import { recentFlaps } from "./line-weights.js";
import { ritmoGbDia, horasRestantes, culpables, textoAviso, MB_POR_RECONEXION } from "./iproyal-burn.js";

const t = (min: number) => ({ gb: 0, at: Date.parse("2026-09-24T00:00:00Z") + min * 60_000 });

describe("ritmo de consumo", () => {
  it("calcula GB por día entre dos lecturas", () => {
    // 0,1 GB en 1 hora = 2,4 GB/día
    const r = ritmoGbDia({ ...t(0), gb: 2.0 }, { ...t(60), gb: 1.9 });
    expect(r).toBeCloseTo(2.4, 1);
  });

  it("ignora ventanas demasiado cortas (el ruido domina)", () => {
    expect(ritmoGbDia({ ...t(0), gb: 2.0 }, { ...t(5), gb: 1.99 })).toBeNull();
  });

  it("una RECARGA no se confunde con consumo negativo", () => {
    expect(ritmoGbDia({ ...t(0), gb: 0.5 }, { ...t(60), gb: 10 })).toBeNull();
  });

  it("sin lectura previa no inventa un ritmo", () => {
    expect(ritmoGbDia(null, { ...t(60), gb: 1 })).toBeNull();
  });

  it("saldo quieto no es consumo", () => {
    expect(ritmoGbDia({ ...t(0), gb: 2 }, { ...t(60), gb: 2 })).toBeNull();
  });
});

describe("cuánto queda", () => {
  it("horas restantes al ritmo actual", () => {
    expect(horasRestantes(1, 2)).toBeCloseTo(12, 5); // 1 GB con 2 GB/día = 12 h
  });
  it("sin ritmo no estima", () => {
    expect(horasRestantes(1, null)).toBeNull();
    expect(horasRestantes(1, 0)).toBeNull();
  });
});

describe("a quién señalar", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ordena por caídas y estima los MB", () => {
    (recentFlaps as unknown as ReturnType<typeof vi.fn>).mockImplementation((id: string) =>
      ({ a: 3, b: 12, c: 0 }[id] ?? 0));
    const r = culpables(["a", "b", "c"]);
    expect(r.map((x) => x.lineId)).toEqual(["b", "a"]); // c queda fuera: no se cayó
    expect(r[0].mbHora).toBe(12 * MB_POR_RECONEXION);
  });

  it("sin caídas no señala a nadie", () => {
    (recentFlaps as unknown as ReturnType<typeof vi.fn>).mockReturnValue(0);
    expect(culpables(["a", "b"])).toEqual([]);
  });
});

describe("texto del aviso", () => {
  it("dice el ritmo, lo que queda y los culpables", () => {
    const txt = textoAviso(1.2, 2.4, [{ nombre: "freydis …7450", caidas: 12 }]);
    expect(txt).toContain("2.40 GB por día");
    expect(txt).toContain("1.20 GB");
    expect(txt).toContain("~12 h");
    expect(txt).toContain("freydis …7450: 12 caídas");
  });

  it("sin culpables no inventa una lista", () => {
    const txt = textoAviso(1.2, 2.4, []);
    expect(txt).not.toContain("caídas en la última hora");
    expect(txt).toContain("2.40 GB por día");
  });
});
