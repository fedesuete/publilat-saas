import { describe, it, expect, beforeEach } from "vitest";
import { registrarCaida, clientesCaidos, lineasCaidas, reclamaAlarma, reiniciarManada, textoManada, MANADA_UMBRAL } from "./caida-en-manada.js";

// Ahora todas las líneas salen por la IP del servidor. Si WhatsApp la limitara, caerían TODAS juntas
// y hoy nada lo distingue de "se cayó una línea". Esto es la red de seguridad de esa decisión.
const T = Date.parse("2026-09-26T12:00:00Z");
const min = (m: number) => T + m * 60_000;

beforeEach(() => reiniciarManada());

describe("detección de caída en manada", () => {
  it("una línea suelta NO da alarma", () => {
    registrarCaida("l1", "u1", T);
    expect(reclamaAlarma(T)).toBeNull();
  });

  it("muchas líneas del MISMO cliente tampoco (es él haciendo algo)", () => {
    for (let i = 0; i < 8; i++) registrarCaida(`l${i}`, "u1", T);
    expect(clientesCaidos(T)).toBe(1);
    expect(reclamaAlarma(T)).toBeNull();
  });

  it("líneas de CLIENTES distintos a la vez: alarma", () => {
    for (let i = 0; i < MANADA_UMBRAL; i++) registrarCaida(`l${i}`, `u${i}`, T);
    const r = reclamaAlarma(T);
    expect(r).not.toBeNull();
    expect(r!.clientes).toBe(MANADA_UMBRAL);
  });

  it("si están repartidas en el tiempo, no es manada", () => {
    for (let i = 0; i < MANADA_UMBRAL; i++) registrarCaida(`l${i}`, `u${i}`, min(i * 20));
    // Al final, en la ventana solo entra la última.
    expect(clientesCaidos(min((MANADA_UMBRAL - 1) * 20))).toBe(1);
    expect(reclamaAlarma(min((MANADA_UMBRAL - 1) * 20))).toBeNull();
  });

  it("no repite la alarma cada minuto", () => {
    for (let i = 0; i < MANADA_UMBRAL; i++) registrarCaida(`l${i}`, `u${i}`, T);
    expect(reclamaAlarma(T)).not.toBeNull();
    for (let i = 0; i < MANADA_UMBRAL; i++) registrarCaida(`x${i}`, `u${i}`, min(2));
    expect(reclamaAlarma(min(2))).toBeNull(); // ya avisamos hace 2 min
  });

  it("pasada una hora vuelve a poder avisar (si sigue pasando)", () => {
    for (let i = 0; i < MANADA_UMBRAL; i++) registrarCaida(`l${i}`, `u${i}`, T);
    reclamaAlarma(T);
    for (let i = 0; i < MANADA_UMBRAL; i++) registrarCaida(`y${i}`, `u${i}`, min(65));
    expect(reclamaAlarma(min(65))).not.toBeNull();
  });

  it("la misma línea cayéndose dos veces no cuenta doble", () => {
    registrarCaida("l1", "u1", T);
    registrarCaida("l1", "u1", min(1));
    expect(lineasCaidas(min(1))).toBe(1);
  });
});

describe("texto del aviso", () => {
  it("dice qué pasó y qué mirar", () => {
    const t = textoManada(6, 9, 10);
    expect(t).toContain("9 líneas de 6 clientes");
    expect(t).toContain("IP del servidor");
    expect(t).toContain("¿Vuelven solas");
  });
});
