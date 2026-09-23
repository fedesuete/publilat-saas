import { describe, it, expect, vi, beforeEach } from "vitest";

// Freno de TORMENTA: una línea que se cae y reconecta sin parar (69 veces en 20 min el 23/09) no se
// recupera sola reintentando; quema el proxy, hace ruido y WhatsApp restringe el número. Se detiene
// y queda en manos del cliente ("Conectar / Ver QR"). Ningún automatismo la vuelve a levantar.
vi.mock("./wa-engine.js", () => ({ getEngine: () => ({ restartInstance: vi.fn(async () => true) }) }));

import { markStormStopped, stormStopped, clearStorm, autoRestartAllowed, markUserConnecting, STORM_FLAPS_PER_HOUR, esTormenta } from "./session-guard.js";

beforeEach(() => {
  vi.useRealTimers();
  clearStorm("line_a");
  clearStorm("line_b");
});

describe("freno de tormenta", () => {
  it("umbral: 10 caídas por hora es tormenta; menos no", () => {
    expect(STORM_FLAPS_PER_HOUR).toBe(10);
    expect(esTormenta(9)).toBe(false);
    expect(esTormenta(10)).toBe(true);
    expect(esTormenta(69)).toBe(true);
  });

  it("marcada como tormenta, ningún automatismo la reinicia", () => {
    expect(autoRestartAllowed("line_a")).toBe("ok");
    markStormStopped("line_a");
    expect(stormStopped("line_a")).toBe(true);
    expect(autoRestartAllowed("line_a")).toBe("tormenta");
  });

  it("no contagia a otras líneas", () => {
    markStormStopped("line_a");
    expect(stormStopped("line_b")).toBe(false);
    expect(autoRestartAllowed("line_b")).toBe("ok");
  });

  it("cuando el USUARIO toca Conectar, el freno se levanta", () => {
    markStormStopped("line_a");
    markUserConnecting("line_a");
    expect(stormStopped("line_a")).toBe(false);
    // (mientras el usuario está en eso, el veredicto es "usuario", no "tormenta")
    expect(autoRestartAllowed("line_a")).toBe("usuario");
  });

  it("el freno vence solo a las 6 h (por si nadie la atiende, se vuelve a intentar)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-23T12:00:00Z"));
    markStormStopped("line_a");
    vi.setSystemTime(new Date("2026-09-23T17:59:00Z"));
    expect(stormStopped("line_a")).toBe(true);
    vi.setSystemTime(new Date("2026-09-23T18:01:00Z"));
    expect(stormStopped("line_a")).toBe(false);
  });
});
