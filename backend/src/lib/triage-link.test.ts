import { describe, it, expect, vi, afterEach } from "vitest";

// El link decide una revisión de soporte SIN login, así que lo que importa es que no se pueda
// fabricar, ni reusar tocándole una letra, ni usar después de vencido.
process.env.JWT_SECRET = "secreto-de-prueba";
import { firmarDecision, verificarDecision } from "./triage-link.js";

afterEach(() => vi.useRealTimers());

describe("link firmado para decidir por mail", () => {
  it("ida y vuelta: devuelve la revisión y el admin", () => {
    const tok = firmarDecision("tri_1", "adm_1");
    expect(verificarDecision(tok)).toEqual({ triageId: "tri_1", adminId: "adm_1" });
  });

  it("firma cambiada = rechazado (no se puede fabricar)", () => {
    const tok = firmarDecision("tri_1", "adm_1");
    const [datos, mac] = tok.split(".");
    const otra = mac.slice(0, -1) + (mac.endsWith("A") ? "B" : "A");
    expect(verificarDecision(`${datos}.${otra}`)).toBeNull();
  });

  it("datos cambiados = rechazado (no se puede apuntar a otra revisión)", () => {
    const tok = firmarDecision("tri_1", "adm_1");
    const mac = tok.split(".")[1];
    const otros = Buffer.from(JSON.stringify({ t: "tri_OTRA", a: "adm_1", exp: 9999999999 }))
      .toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(verificarDecision(`${otros}.${mac}`)).toBeNull();
  });

  it("vencido = rechazado", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-25T00:00:00Z"));
    const tok = firmarDecision("tri_1", "adm_1", 7);
    vi.setSystemTime(new Date("2026-10-03T00:01:00Z")); // 8 días después
    expect(verificarDecision(tok)).toBeNull();
  });

  it("todavía dentro del plazo = válido", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-25T00:00:00Z"));
    const tok = firmarDecision("tri_1", "adm_1", 7);
    vi.setSystemTime(new Date("2026-09-30T00:00:00Z"));
    expect(verificarDecision(tok)).not.toBeNull();
  });

  it("basura y formatos raros no rompen nada", () => {
    for (const malo of ["", ".", "abc", "a.b", "....", "null", "{}"]) {
      expect(verificarDecision(malo)).toBeNull();
    }
  });

  it("dos revisiones distintas dan links distintos", () => {
    expect(firmarDecision("tri_1", "adm_1")).not.toBe(firmarDecision("tri_2", "adm_1"));
  });
});
