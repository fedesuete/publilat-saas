// Clientes sin respuesta + resumen de la noche: la parte pura (textos, tiempos, qué se avisa).
import { describe, it, expect } from "vitest";
import { patronResumen, textoEspera, fechaAR, inicioDiaAR, textoAlerta, paraAlertar, resumirJobs, textoResumen } from "./soporte-resumen.js";

describe("patronResumen", () => {
  it("hora configurada → patrón de cron; raro → 23:00", () => {
    expect(patronResumen(undefined)).toBe("0 23 * * *");
    expect(patronResumen("22:30")).toBe("30 22 * * *");
    expect(patronResumen("7")).toBe("0 7 * * *");
    expect(patronResumen("99")).toBe("0 23 * * *");
    expect(patronResumen("a las 9")).toBe("0 23 * * *");
  });
});

describe("tiempos en hora argentina", () => {
  it("textoEspera", () => {
    expect(textoEspera(35 * 60_000)).toBe("35 min");
    expect(textoEspera((2 * 60 + 5) * 60_000)).toBe("2 h 05 min");
    expect(textoEspera(3 * 3600_000)).toBe("3 h");
    expect(textoEspera(26 * 3600_000)).toBe("1 día 2 h");
    expect(textoEspera(-5)).toBe("0 min");
  });
  it("inicioDiaAR: las 22:30 AR del 30/10 (01:30Z del 31) siguen siendo el 30", () => {
    expect(inicioDiaAR(new Date("2026-10-31T01:30:00Z")).toISOString()).toBe("2026-10-30T03:00:00.000Z");
    expect(inicioDiaAR(new Date("2026-10-31T03:00:00Z")).toISOString()).toBe("2026-10-31T03:00:00.000Z");
  });
  it("fechaAR", () => {
    expect(fechaAR(new Date("2026-10-31T01:30:00Z"))).toBe("vie 30/10"); // el 30/10/2026 es viernes
  });
});

const esperando = (desde: string, alertedAt: string | null = null) => ({
  code: "K7M", nombre: "Eurofortuna", quien: "J.K.", texto: "v=DMARC1; p=none; rua=mailto:dmarc@eurofortuna.com; pct=100", desde: new Date(desde), alertedAt: alertedAt ? new Date(alertedAt) : null,
});

describe("paraAlertar", () => {
  const ahora = new Date("2026-10-30T22:39:00Z");
  it("pasa el tope y todavía no se avisó", () => {
    const lista = [esperando("2026-10-30T20:39:00Z"), esperando("2026-10-30T21:30:00Z"), esperando("2026-10-30T19:00:00Z", "2026-10-30T21:00:00Z")];
    expect(paraAlertar(lista, ahora, 120).map((e) => e.desde.toISOString())).toEqual(["2026-10-30T20:39:00.000Z"]);
  });
  it("con el tope en 0 avisa de todos los que no se avisaron", () => {
    expect(paraAlertar([esperando("2026-10-30T22:38:00Z")], ahora, 0)).toHaveLength(1);
  });
});

describe("textoAlerta", () => {
  it("dice quién, cuánto lleva y cómo contestarle", () => {
    const t = textoAlerta(esperando("2026-10-30T20:39:00Z"), new Date("2026-10-30T23:19:00Z"));
    expect(t).toContain("#K7M · Eurofortuna");
    expect(t).toContain("J.K. lleva *2 h 40 min* sin respuesta");
    expect(t).toContain("v=DMARC1");
    expect(t).toContain("empezá con B-");
  });
  it("imagen sin texto", () => {
    expect(textoAlerta({ ...esperando("2026-10-30T20:39:00Z"), texto: "" }, new Date("2026-10-30T23:19:00Z"))).toContain("«(imagen)»");
  });
});

describe("resumirJobs", () => {
  const inicio = new Date("2026-10-30T03:00:00Z");
  const j = (numero: number, estado: string, dia = "2026-10-30T15:00:00Z") => ({ numero, estado, texto: `pedido ${numero}  con   espacios`, createdAt: new Date(dia) });
  it("los del día por resultado; los abiertos de cualquier día", () => {
    const r = resumirJobs([j(1, "hecho"), j(2, "esperando_ok", "2026-10-29T15:00:00Z"), j(3, "hecho"), j(4, "error"), j(5, "trabajando"), j(6, "rechazado")], inicio);
    expect(r.total).toBe(5);
    expect(r.hechos).toBe(2);
    expect(r.rechazados).toBe(1);
    expect(r.errores).toEqual([{ numero: 4, texto: "pedido 4 con espacios" }]);
    expect(r.esperandoOk).toEqual([{ numero: 2, texto: "pedido 2 con espacios" }]);
    expect(r.enCurso).toEqual([{ numero: 5, texto: "pedido 5 con espacios" }]);
  });
});

describe("textoResumen", () => {
  const ahora = new Date("2026-10-31T02:00:00Z"); // 23:00 AR del 30/10
  it("con pedidos, clientes esperando y movimiento", () => {
    const t = textoResumen({
      ahora,
      jobs: { total: 9, hechos: 7, rechazados: 0, errores: [], esperandoOk: [{ numero: 2, texto: "Quiero cambiar a el cliente de Eurofortuna" }], enCurso: [] },
      esperando: [esperando("2026-10-30T20:39:00Z")],
      movimiento: [{ nombre: "Bet17", mensajes: 3 }, { nombre: "Eurofortuna", mensajes: 12 }],
    });
    expect(t).toContain("Resumen del día · vie 30/10");
    expect(t).toContain("9 en el día — 7 hechos · 1 esperando ok");
    expect(t).toContain("⏳ #2 Quiero cambiar a el cliente de Eurofortuna → *ok 2* o *no 2*");
    expect(t).toContain("Clientes esperando respuesta:* 1");
    expect(t).toContain("#K7M Eurofortuna — J.K., hace 5 h 21 min");
    expect(t).toContain("15 en 2 chats");
    expect(t).toContain("Eurofortuna 12 · Bet17 3");
  });
  it("día tranquilo", () => {
    const t = textoResumen({ ahora, jobs: { total: 0, hechos: 0, rechazados: 0, errores: [], esperandoOk: [], enCurso: [] }, esperando: [], movimiento: [] });
    expect(t).toContain("0 en el día — 0 hechos");
    expect(t).toContain("Ningún cliente esperando respuesta");
    expect(t).toContain("ninguno");
  });
});
