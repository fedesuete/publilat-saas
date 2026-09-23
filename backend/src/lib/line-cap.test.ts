import { describe, it, expect } from "vitest";
import { diaLocal, usadoHoy, tieneCupo, sumarClic, elegibles } from "./line-cap.js";

// Tope diario por línea: "a este número mandale como mucho N personas por día". Lo pidió maripinkwin
// para repartir entre muchos números sin quemar los nuevos.
const linea = (dailyCap: number, routedToday = 0, routedTodayAt: Date | null = null) => ({ dailyCap, routedToday, routedTodayAt });

describe("día del negocio (AR/PY, UTC-3)", () => {
  it("las 23:00 de Argentina siguen siendo el MISMO día (aunque en UTC ya sea el siguiente)", () => {
    // 2026-09-23 23:30 AR = 2026-09-24 02:30 UTC
    expect(diaLocal(new Date("2026-09-24T02:30:00Z"))).toBe("2026-09-23");
  });
  it("las 00:30 de Argentina ya son el día nuevo", () => {
    expect(diaLocal(new Date("2026-09-24T03:30:00Z"))).toBe("2026-09-24");
  });
});

describe("contador del día", () => {
  const ahora = new Date("2026-09-23T15:00:00Z");
  it("sin contador previo: cero", () => {
    expect(usadoHoy(linea(30), ahora)).toBe(0);
  });
  it("contador de hoy: cuenta", () => {
    expect(usadoHoy(linea(30, 12, new Date("2026-09-23T10:00:00Z")), ahora)).toBe(12);
  });
  it("contador de AYER: se ignora (arranca de cero solo)", () => {
    expect(usadoHoy(linea(30, 30, new Date("2026-09-22T10:00:00Z")), ahora)).toBe(0);
  });
  it("sumar un clic reinicia si el contador era de otro día", () => {
    expect(sumarClic(linea(30, 30, new Date("2026-09-22T10:00:00Z")), ahora).routedToday).toBe(1);
    expect(sumarClic(linea(30, 12, new Date("2026-09-23T10:00:00Z")), ahora).routedToday).toBe(13);
  });
});

describe("cupo por línea", () => {
  const ahora = new Date("2026-09-23T15:00:00Z");
  it("sin tope (0) siempre tiene cupo", () => {
    expect(tieneCupo(linea(0, 9999, ahora), ahora)).toBe(true);
  });
  it("con tope: hay cupo hasta llegar al número exacto", () => {
    expect(tieneCupo(linea(30, 29, ahora), ahora)).toBe(true);
    expect(tieneCupo(linea(30, 30, ahora), ahora)).toBe(false);
    expect(tieneCupo(linea(30, 31, ahora), ahora)).toBe(false);
  });
  it("al día siguiente vuelve a tener cupo", () => {
    const manana = new Date("2026-09-24T15:00:00Z");
    expect(tieneCupo(linea(30, 30, ahora), manana)).toBe(true);
  });
});

describe("reparto de candidatas", () => {
  const ahora = new Date("2026-09-23T15:00:00Z");
  it("deja fuera a las que llegaron al tope", () => {
    const a = { id: "a", ...linea(10, 10, ahora) };
    const b = { id: "b", ...linea(10, 3, ahora) };
    const c = { id: "c", ...linea(0, 500, ahora) };
    const { pool, todasAlTope } = elegibles([a, b, c], ahora);
    expect(pool.map((l) => l.id)).toEqual(["b", "c"]);
    expect(todasAlTope).toBe(false);
  });

  it("si TODAS llegaron al tope, se reparte igual (un clic sin línea es un lead pago perdido)", () => {
    const a = { id: "a", ...linea(10, 10, ahora) };
    const b = { id: "b", ...linea(5, 5, ahora) };
    const { pool, todasAlTope } = elegibles([a, b], ahora);
    expect(pool.map((l) => l.id)).toEqual(["a", "b"]);
    expect(todasAlTope).toBe(true); // esto es lo que dispara el aviso al cliente
  });

  it("sin líneas no avisa nada", () => {
    expect(elegibles([], ahora)).toEqual({ pool: [], todasAlTope: false });
  });

  it("cuentas sin tope configurado se comportan como siempre", () => {
    const ls = [{ id: "a", ...linea(0) }, { id: "b", ...linea(0) }];
    const { pool, todasAlTope } = elegibles(ls, ahora);
    expect(pool).toHaveLength(2);
    expect(todasAlTope).toBe(false);
  });
});
