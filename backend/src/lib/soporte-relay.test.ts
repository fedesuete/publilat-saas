// Lo que se puede probar sin red ni base: el parseo de la orden B-, el id citado, y los textos que
// ve el equipo en SOPORTE.
import { describe, it, expect } from "vitest";
import {
  textoParaGrupo, textoDesdeGrupo, telefonoLegible, parseComando, idCola, idCitado,
  ACK_POR_DEFECTO, ACK_CARGA, ACK_CONSULTA, type Consulta, type ConsultaDeGrupo,
} from "./soporte-relay.js";

const consulta = (over: Partial<Consulta> = {}): Consulta => ({
  code: "K7M", nombre: "Tomás", phone: "5492235385161", texto: "no me anda el QR de la línea", esImagen: false, ...over,
});
const deGrupo = (over: Partial<ConsultaDeGrupo> = {}): ConsultaDeGrupo => ({
  code: "K7M", grupo: "Bet17.pro - (OFICIAL)", quien: "Emi", texto: "¿Al mismo CBU para fichas?", esImagen: false, ...over,
});

describe("parseComando (la orden B- del grupo de soporte)", () => {
  it("B- mensaje → el mensaje", () => {
    expect(parseComando("B- Hola, ya te lo acreditamos")).toBe("Hola, ya te lo acreditamos");
  });
  it("acepta minúscula, espacios y guiones raros del teclado del celular", () => {
    expect(parseComando("b-listo")).toBe("listo");
    expect(parseComando("B - listo")).toBe("listo");
    expect(parseComando("B– listo")).toBe("listo");
    expect(parseComando("  B-  listo  ")).toBe("listo");
  });
  it("respeta saltos de línea del mensaje", () => {
    expect(parseComando("B- Hola\nSegunda línea")).toBe("Hola\nSegunda línea");
  });
  it("la charla del equipo NO es una orden", () => {
    // Sin esto, hablar entre ellos en SOPORTE le llegaría al cliente.
    expect(parseComando("Bueno, lo veo mañana")).toBeNull();
    expect(parseComando("bancame que lo miro")).toBeNull();
    expect(parseComando("🆕 #K7M · Bet17")).toBeNull();
    expect(parseComando("")).toBeNull();
    expect(parseComando(null)).toBeNull();
  });
  it("B- sin texto no manda nada", () => {
    expect(parseComando("B-   ")).toBeNull();
  });
});

describe("idCola", () => {
  it("saca la cola del id serializado y deja el crudo como está", () => {
    expect(idCola("true_120363293702102259@g.us_3EB0ABC")).toBe("3EB0ABC");
    expect(idCola("3EB0ABC")).toBe("3EB0ABC");
    expect(idCola(null)).toBe("");
  });
});

describe("idCitado (a quién le contestan)", () => {
  it("lee replyTo como string o como objeto", () => {
    expect(idCitado({ replyTo: "true_x@g.us_AAA" })).toBe("AAA");
    expect(idCitado({ replyTo: { id: "false_x@g.us_BBB", body: "…" } })).toBe("BBB");
  });
  it("lee el stanzaId crudo de Baileys si WAHA no armó replyTo", () => {
    expect(idCitado({ _data: { message: { extendedTextMessage: { text: "B- hola", contextInfo: { stanzaId: "CCC" } } } } })).toBe("CCC");
  });
  it("sin cita devuelve null (y el bot pide que citen en vez de mandarle a cualquiera)", () => {
    expect(idCitado({ body: "B- hola" })).toBeNull();
    expect(idCitado(null)).toBeNull();
  });
});

describe("telefonoLegible", () => {
  it("lo deja copiable, con +", () => expect(telefonoLegible("5492235385161")).toBe("+5492235385161"));
  it("limpia lo que no sea número", () => expect(telefonoLegible("+54 9 223 538-5161")).toBe("+5492235385161"));
  it("aguanta que no haya teléfono", () => {
    expect(telefonoLegible(null)).toBe("sin teléfono");
    expect(telefonoLegible("")).toBe("sin teléfono");
  });
});

describe("textoParaGrupo (consulta 1 a 1)", () => {
  it("lleva el código, el nombre, el teléfono y la consulta", () => {
    const t = textoParaGrupo(consulta());
    expect(t).toContain("#K7M");
    expect(t).toContain("Tomás");
    expect(t).toContain("+5492235385161");
    expect(t).toContain("no me anda el QR de la línea");
  });
  it("explica cómo contestarle (citando + B-)", () => {
    const t = textoParaGrupo(consulta());
    expect(t).toContain("B-");
    expect(t.toLowerCase()).toContain("citándolo");
  });
  it("sin nombre, el teléfono es el título", () => {
    expect(textoParaGrupo(consulta({ nombre: "" })).split("\n")[0]).toBe("🆕 #K7M · +5492235385161");
  });
  it("una imagen sin texto se anuncia, no queda en blanco", () => {
    expect(textoParaGrupo(consulta({ texto: "", esImagen: true }))).toContain("(mandó una imagen)");
  });
  it("no recorta la consulta", () => {
    const largo = "a".repeat(1200);
    expect(textoParaGrupo(consulta({ texto: largo }))).toContain(largo);
  });
});

describe("textoDesdeGrupo (mensaje en el grupo de un cliente)", () => {
  it("dice de qué grupo viene y quién escribió", () => {
    const t = textoDesdeGrupo(deGrupo());
    expect(t.split("\n")[0]).toBe("🆕 #K7M · Bet17.pro - (OFICIAL)");
    expect(t).toContain("👤 Emi");
    expect(t).toContain("¿Al mismo CBU para fichas?");
    expect(t).toContain("B-");
  });
  it("un comprobante sin texto se anuncia como tal", () => {
    expect(textoDesdeGrupo(deGrupo({ texto: "", esImagen: true }))).toContain("(comprobante sin texto)");
  });
});

describe("acuses", () => {
  it("prometen que se está procesando, sin un plazo que no controlamos", () => {
    for (const t of [ACK_POR_DEFECTO, ACK_CARGA, ACK_CONSULTA]) {
      expect(t).toMatch(/procesando|viendo/i);
      expect(t).not.toMatch(/\b\d+\s*(minutos|horas)\b/i);
    }
  });
  it("la carga y la consulta tienen textos distintos", () => {
    expect(ACK_CARGA).toMatch(/carga/i);
    expect(ACK_CONSULTA).toMatch(/consulta/i);
  });
});
