import { describe, it, expect } from "vitest";
import { elegirPorcion, segmentosSchema, PLANTILLA, inicioDelDiaAR, ruletaActiva, ventanaDeGiros, puedeGirar, MAX_GIROS_POR_VENTANA, porcionesPublicas, type Segmento } from "./chat-wheel.js";

const seg = (weight: number, type: Segmento["type"] = "fichas", amount = 100): Segmento => ({ label: `p${weight}`, color: "#112233", icon: "", type, amount, weight });

describe("segmentosSchema", () => {
  it("la plantilla es válida y suma 100%", () => {
    expect(segmentosSchema.safeParse(PLANTILLA).success).toBe(true);
  });
  it("rechaza si no suma 100%", () => {
    expect(segmentosSchema.safeParse([seg(50), seg(40)]).success).toBe(false);
  });
  it("rechaza fichas con monto 0 y menos de 2 porciones", () => {
    expect(segmentosSchema.safeParse([seg(50), { ...seg(50), amount: 0 }]).success).toBe(false);
    expect(segmentosSchema.safeParse([seg(100)]).success).toBe(false);
  });
  it("'giro' y 'nada' pueden tener monto 0", () => {
    expect(segmentosSchema.safeParse([seg(50, "giro", 0), seg(50, "nada", 0)]).success).toBe(true);
  });
});

describe("elegirPorcion (probabilidades acumuladas)", () => {
  const s = [seg(10), seg(0), seg(60), seg(30)];
  it("respeta los cortes", () => {
    expect(elegirPorcion(s, 0)).toBe(0);
    expect(elegirPorcion(s, 9.99)).toBe(0);
    expect(elegirPorcion(s, 10)).toBe(2); // la de 0% nunca sale
    expect(elegirPorcion(s, 69.99)).toBe(2);
    expect(elegirPorcion(s, 70)).toBe(3);
    expect(elegirPorcion(s, 99.99)).toBe(3);
  });
  it("aleatorio real: siempre devuelve una porción con probabilidad > 0", () => {
    for (let i = 0; i < 500; i++) expect([0, 2, 3]).toContain(elegirPorcion(s));
  });
});

describe("ventana de giros", () => {
  it("el día de Argentina arranca a las 03:00 UTC", () => {
    expect(inicioDelDiaAR(new Date("2026-10-11T02:59:00Z")).toISOString()).toBe("2026-10-10T03:00:00.000Z");
    expect(inicioDelDiaAR(new Date("2026-10-11T03:00:00Z")).toISOString()).toBe("2026-10-11T03:00:00.000Z");
  });
  it("activa solo si está prendida y no venció", () => {
    const now = new Date("2026-10-11T12:00:00Z");
    expect(ruletaActiva({ status: "active", endsAt: null, durationMin: 0, round: 1 }, now)).toBe(true);
    expect(ruletaActiva({ status: "active", endsAt: new Date("2026-10-11T11:59:00Z"), durationMin: 16, round: 1 }, now)).toBe(false);
    expect(ruletaActiva({ status: "draft", endsAt: null, durationMin: 0, round: 1 }, now)).toBe(false);
    expect(ruletaActiva(null, now)).toBe(false);
  });
  it("con duración cuenta la activación; sin duración, el día", () => {
    const now = new Date("2026-10-11T12:00:00Z");
    expect(ventanaDeGiros({ status: "active", endsAt: null, durationMin: 16, round: 4 }, now)).toEqual({ round: 4 });
    expect(ventanaDeGiros({ status: "active", endsAt: null, durationMin: 0, round: 4 }, now)).toEqual({ round: 4, createdAt: { gte: new Date("2026-10-11T03:00:00Z") } });
  });
});

describe("puedeGirar", () => {
  const t = (min: number) => new Date(Date.UTC(2026, 9, 11, 12, min));
  it("sin giros → sí; con premio → no; último 'Gira Gratis' → sí", () => {
    expect(puedeGirar([])).toBe(true);
    expect(puedeGirar([{ prizeType: "fichas", createdAt: t(1) }])).toBe(false);
    expect(puedeGirar([{ prizeType: "fichas", createdAt: t(1) }, { prizeType: "giro", createdAt: t(0) }])).toBe(false);
    expect(puedeGirar([{ prizeType: "giro", createdAt: t(2) }, { prizeType: "nada", createdAt: t(0) }])).toBe(true);
  });
  it("tope de giros aunque salgan 'Gira Gratis' seguidos", () => {
    const giros = Array.from({ length: MAX_GIROS_POR_VENTANA }, (_, i) => ({ prizeType: "giro", createdAt: t(i) }));
    expect(puedeGirar(giros)).toBe(false);
  });
});

it("el jugador no ve las probabilidades ni los montos", () => {
  expect(porcionesPublicas([seg(100)])[0]).toEqual({ label: "p100", color: "#112233", icon: "" });
});
