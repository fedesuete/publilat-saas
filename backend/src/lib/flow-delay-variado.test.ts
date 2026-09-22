import { describe, it, expect } from "vitest";
import { delaySeconds } from "./flow-engine.js";

// "Esperamos unos 3-4 min variado así no parece un bot" (pedido del dueño, 2026-09-22).
// Mandar la respuesta SIEMPRE al mismo minuto exacto es lo que delata una automatización.

describe("espera variable entre pasos", () => {
  it("sin rango se comporta como siempre: espera fija", () => {
    expect(delaySeconds({ minutes: 3 })).toBe(180);
    expect(delaySeconds({ minutes: 60 })).toBe(3600);
  });

  it("con rango cae entre el mínimo y el máximo", () => {
    for (let i = 0; i < 200; i++) {
      const s = delaySeconds({ minutes: 3, minutesTo: 4 });
      expect(s).toBeGreaterThanOrEqual(180);
      expect(s).toBeLessThanOrEqual(240);
    }
  });

  it("de verdad varía (no devuelve siempre lo mismo)", () => {
    const vistos = new Set<number>();
    for (let i = 0; i < 100; i++) vistos.add(delaySeconds({ minutes: 3, minutesTo: 4 }));
    expect(vistos.size).toBeGreaterThan(10); // decenas de valores distintos, no 2 o 3
  });

  it("cae en segundos sueltos, no en minutos redondos", () => {
    let redondos = 0;
    for (let i = 0; i < 100; i++) if (delaySeconds({ minutes: 3, minutesTo: 4 }) % 60 === 0) redondos++;
    expect(redondos).toBeLessThan(20); // la mayoría NO son minutos exactos
  });

  it("los extremos del rango funcionan", () => {
    expect(delaySeconds({ minutes: 3, minutesTo: 4 }, () => 0)).toBe(180);
    expect(delaySeconds({ minutes: 3, minutesTo: 4 }, () => 0.999999)).toBe(240);
  });

  it("un rango al revés no rompe nada (toma el mínimo)", () => {
    expect(delaySeconds({ minutes: 5, minutesTo: 2 })).toBe(300);
  });

  it("nunca espera menos de 1 segundo", () => {
    expect(delaySeconds({ minutes: 0 })).toBe(1);
    expect(delaySeconds({})).toBe(60); // sin datos: 1 minuto, como antes
  });
});
