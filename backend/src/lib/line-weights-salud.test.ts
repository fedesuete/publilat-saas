import { describe, it, expect, beforeEach, vi } from "vitest";
import { recordLineFlap, recentFlaps, healthWeight, lineWeights, pickWeighted } from "./line-weights.js";

// La rotación de clics tiene que mandar MENOS tráfico a las líneas que se están cayendo.
// Caso real que lo motivó (naturalcosmetica, 2026-09-21): tres líneas, reparto parejo
// (291/290/252 clics en 2 h), pero la más nueva tenía 128 caídas en 6 h y solo recibió 7 mensajes
// contra 45 de la estable. Un tercio del tráfico iba a una línea que no entregaba.

beforeEach(() => {
  delete process.env.LINE_WEIGHTS;
  vi.useRealTimers();
});

describe("peso por salud de la línea", () => {
  it("una línea sana (pocas caídas) no se penaliza", () => {
    expect(healthWeight(0)).toBe(1);
    expect(healthWeight(2)).toBe(1);
  });

  it("cuantas más caídas, menos tráfico", () => {
    expect(healthWeight(3)).toBe(0.5);
    expect(healthWeight(8)).toBe(0.25);
    expect(healthWeight(50)).toBe(0.1);
  });

  it("NUNCA llega a cero: una línea castigada sigue recibiendo algo y puede recuperarse", () => {
    for (const n of [11, 100, 1000]) expect(healthWeight(n)).toBeGreaterThan(0);
  });
});

describe("registro de caídas", () => {
  it("cuenta las caídas de la última hora", () => {
    const id = "linea-" + Math.random();
    expect(recentFlaps(id)).toBe(0);
    recordLineFlap(id);
    recordLineFlap(id);
    expect(recentFlaps(id)).toBe(2);
  });

  it("olvida las caídas viejas (ventana de 1 h): la línea se rehabilita sola", () => {
    const id = "linea-" + Math.random();
    recordLineFlap(id);
    expect(recentFlaps(id)).toBe(1);
    // Dos horas después esa caída ya no cuenta.
    expect(recentFlaps(id, Date.now() + 2 * 3600_000)).toBe(0);
  });

  it("las líneas son independientes entre sí", () => {
    const a = "a-" + Math.random(), b = "b-" + Math.random();
    recordLineFlap(a); recordLineFlap(a); recordLineFlap(a); recordLineFlap(a);
    recordLineFlap(b);
    expect(recentFlaps(a)).toBe(4);
    expect(recentFlaps(b)).toBe(1);
  });
});

describe("lineWeights: automático + manual", () => {
  it("penaliza sola a la línea que se cae, sin configurar nada", () => {
    const mala = "mala-" + Math.random();
    for (let i = 0; i < 12; i++) recordLineFlap(mala);
    expect(lineWeights()[mala]).toBe(0.1);
  });

  it("el peso manual del env pisa al automático (decisión explícita del admin)", () => {
    const id = "manual-" + Math.random();
    for (let i = 0; i < 12; i++) recordLineFlap(id);
    process.env.LINE_WEIGHTS = JSON.stringify({ [id]: 2 });
    expect(lineWeights()[id]).toBe(2);
  });

  it("un env roto no rompe la rotación: quedan los pesos automáticos", () => {
    const id = "roto-" + Math.random();
    for (let i = 0; i < 4; i++) recordLineFlap(id);
    process.env.LINE_WEIGHTS = "{ esto no es json";
    expect(lineWeights()[id]).toBe(0.5);
  });
});

describe("efecto real sobre el reparto de clics", () => {
  it("la línea que se cae recibe muchos menos clics que la sana", () => {
    const sana = "sana-" + Math.random(), rota = "rota-" + Math.random();
    for (let i = 0; i < 15; i++) recordLineFlap(rota); // peso 0.1
    const estado = [
      { id: sana, lastUsedAt: null as Date | null },
      { id: rota, lastUsedAt: null as Date | null },
    ];
    const conteo: Record<string, number> = { [sana]: 0, [rota]: 0 };
    let t = Date.now();
    for (let clic = 0; clic < 100; clic++) {
      t += 1000; // pasa un segundo entre clics
      const elegida = pickWeighted(estado, lineWeights(), t)!;
      conteo[elegida.id]++;
      estado.find((e) => e.id === elegida.id)!.lastUsedAt = new Date(t);
    }
    expect(conteo[sana]).toBeGreaterThan(conteo[rota] * 5); // la sana se lleva la gran mayoría
    expect(conteo[rota]).toBeGreaterThan(0); // pero la rota NO queda aislada
  });

  it("con todas las líneas sanas el reparto sigue siendo parejo", () => {
    const a = "p1-" + Math.random(), b = "p2-" + Math.random();
    const estado = [{ id: a, lastUsedAt: null as Date | null }, { id: b, lastUsedAt: null as Date | null }];
    const conteo: Record<string, number> = { [a]: 0, [b]: 0 };
    let t = Date.now();
    for (let clic = 0; clic < 50; clic++) {
      t += 1000;
      const elegida = pickWeighted(estado, lineWeights(), t)!;
      conteo[elegida.id]++;
      estado.find((e) => e.id === elegida.id)!.lastUsedAt = new Date(t);
    }
    expect(Math.abs(conteo[a] - conteo[b])).toBeLessThanOrEqual(1);
  });
});
