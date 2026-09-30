// Respuestas automáticas por palabra clave: lo que el jugador escribe contra lo que configuró el operador.
import { describe, it, expect } from "vitest";
import { parseReglas, elegirRespuesta, normalizar, MAX_REGLAS, MAX_KEYWORDS } from "./chat-auto-reply.js";

const reglas = parseReglas([
  { keywords: ["alias", "cbu", "cvu"], reply: "Alias: blackwin.mp\nTitular: Juan Pérez" },
  { keywords: ["bono"], reply: "El bono es del 50% en tu primera carga 🎁" },
]);

describe("normalizar", () => {
  it("minúsculas y sin tildes", () => {
    expect(normalizar("DEPÓSITO")).toBe("deposito");
    expect(normalizar("  Alias ")).toBe("alias");
  });
});

describe("parseReglas (lo que guardó el operador)", () => {
  it("lee reglas bien formadas", () => {
    expect(reglas).toHaveLength(2);
    expect(reglas[0].keywords).toEqual(["alias", "cbu", "cvu"]);
  });
  it("ignora basura sin tirar (una config rota no tumba el bot)", () => {
    expect(parseReglas(null)).toEqual([]);
    expect(parseReglas("x")).toEqual([]);
    expect(parseReglas([{ keywords: [], reply: "a" }, { keywords: ["a"], reply: "" }, 5, null, { keywords: ["ok"], reply: "ok" }])).toHaveLength(1);
  });
  it("recorta a los topes", () => {
    const muchas = Array.from({ length: MAX_REGLAS + 5 }, (_, i) => ({ keywords: ["k" + i], reply: "r" }));
    expect(parseReglas(muchas)).toHaveLength(MAX_REGLAS);
    const kws = Array.from({ length: MAX_KEYWORDS + 5 }, (_, i) => "k" + i);
    expect(parseReglas([{ keywords: kws, reply: "r" }])[0].keywords).toHaveLength(MAX_KEYWORDS);
  });
});

describe("elegirRespuesta", () => {
  it("contiene, no igual: 'hola quiero el alias' → los datos de pago", () => {
    expect(elegirRespuesta("hola quiero el alias", reglas)).toContain("blackwin.mp");
  });
  it("no distingue mayúsculas ni tildes", () => {
    expect(elegirRespuesta("PASAME EL CBU", reglas)).toContain("blackwin.mp");
    expect(elegirRespuesta("Tenés BONÓ?", parseReglas([{ keywords: ["bono"], reply: "sí" }]))).toBe("sí");
  });
  it("gana la primera regla en orden", () => {
    expect(elegirRespuesta("el alias del bono", reglas)).toContain("blackwin.mp");
  });
  it("sin coincidencia, null (el bot de carga o el cajero siguen como siempre)", () => {
    expect(elegirRespuesta("hola buen día", reglas)).toBeNull();
    expect(elegirRespuesta("", reglas)).toBeNull();
    expect(elegirRespuesta(null, reglas)).toBeNull();
    expect(elegirRespuesta("alias", [])).toBeNull();
  });
});
