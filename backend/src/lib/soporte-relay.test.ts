// El texto que cae en el grupo es lo único que ve el equipo: tiene que decir quién escribió,
// cómo contestarle, y no romperse con mensajes vacíos o imágenes.
import { describe, it, expect } from "vitest";
import { textoParaGrupo, telefonoLegible, ACK_POR_DEFECTO, type Consulta } from "./soporte-relay.js";

const consulta = (over: Partial<Consulta> = {}): Consulta => ({
  code: "K7M",
  nombre: "Tomás",
  phone: "5492235385161",
  texto: "no me anda el QR de la línea",
  esImagen: false,
  ...over,
});

describe("telefonoLegible", () => {
  it("lo deja copiable, con +", () => {
    expect(telefonoLegible("5492235385161")).toBe("+5492235385161");
  });
  it("limpia lo que no sea número", () => {
    expect(telefonoLegible("+54 9 223 538-5161")).toBe("+5492235385161");
  });
  it("aguanta que no haya teléfono", () => {
    expect(telefonoLegible(null)).toBe("sin teléfono");
    expect(telefonoLegible("")).toBe("sin teléfono");
  });
});

describe("textoParaGrupo", () => {
  it("lleva el código, el nombre, el teléfono y la consulta", () => {
    const t = textoParaGrupo(consulta());
    expect(t).toContain("#K7M");
    expect(t).toContain("Tomás");
    expect(t).toContain("+5492235385161");
    expect(t).toContain("no me anda el QR de la línea");
  });

  it("explica cómo contestarle (citando + B-)", () => {
    // Sin esta línea, el equipo no tiene forma de saber que existe el atajo.
    const t = textoParaGrupo(consulta());
    expect(t).toContain("B-");
    expect(t.toLowerCase()).toContain("citándolo");
  });

  it("sin nombre, se muestra el teléfono como título", () => {
    const t = textoParaGrupo(consulta({ nombre: "" }));
    expect(t.split("\n")[0]).toBe("🆕 #K7M · +5492235385161");
  });

  it("una imagen sin texto se anuncia, no queda en blanco", () => {
    const t = textoParaGrupo(consulta({ texto: "", esImagen: true }));
    expect(t).toContain("(mandó una imagen)");
  });

  it("un mensaje vacío que no es imagen tampoco queda en blanco", () => {
    expect(textoParaGrupo(consulta({ texto: "   ", esImagen: false }))).toContain("(mensaje vacío)");
  });

  it("no recorta la consulta del cliente", () => {
    // El equipo tiene que leer el reclamo entero para no pedirle que lo repita.
    const largo = "a".repeat(1200);
    expect(textoParaGrupo(consulta({ texto: largo }))).toContain(largo);
  });
});

describe("acuse al cliente", () => {
  it("avisa que está en camino sin prometer un plazo que no controlamos", () => {
    expect(ACK_POR_DEFECTO).toMatch(/consulta/i);
    expect(ACK_POR_DEFECTO).not.toMatch(/\b\d+\s*(minutos|horas)\b/i);
  });
});
