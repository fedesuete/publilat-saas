import { describe, it, expect } from "vitest";
import { phoneGeo } from "./phone-geo.js";

// Esperados sacados a mano de la tabla de Google (libphonenumber, geocoding/es/54.txt) y escritos
// como los pide Meta: minúsculas, sin tildes, sin espacios ni signos.
describe("phoneGeo: Argentina → país, provincia y ciudad por la característica", () => {
  it("celular del interior (549 + característica de 3 dígitos)", () => {
    expect(phoneGeo("5493511234567")).toEqual({ country: "ar", st: "cordoba", ct: "cordoba" });
  });

  it("característica de 4 dígitos, con tildes y espacios en el nombre", () => {
    expect(phoneGeo("5492944593478")).toEqual({ country: "ar", st: "rionegro", ct: "sancarlosdebariloche" });
  });

  it("la 11 → Buenos Aires (la tabla no trae provincia: va Buenos Aires)", () => {
    expect(phoneGeo("5491164523774")).toEqual({ country: "ar", st: "buenosaires", ct: "buenosaires" });
  });

  it("sin el 9 de celular (54 + 10 dígitos) da lo mismo", () => {
    expect(phoneGeo("543511234567")).toEqual({ country: "ar", st: "cordoba", ct: "cordoba" });
  });

  it("con +, espacios y guiones da lo mismo", () => {
    expect(phoneGeo("+54 9 351 123-4567")).toEqual({ country: "ar", st: "cordoba", ct: "cordoba" });
  });

  it("gana el prefijo más largo (sub-zonas dentro de una característica)", () => {
    expect(phoneGeo("5492982412345")).toEqual({ country: "ar", st: "buenosaires", ct: "claromeco" });
    expect(phoneGeo("5492982497123")).toEqual({ country: "ar", st: "buenosaires", ct: "sanfranciscodebellocq" });
  });

  it("característica de varias localidades (Glew/Guernica) → solo provincia", () => {
    expect(phoneGeo("5492224123456")).toEqual({ country: "ar", st: "buenosaires" });
  });

  it("el paréntesis del nombre no va a la ciudad (La Dulce (Nicanor Olivera))", () => {
    expect(phoneGeo("5492264123456")).toEqual({ country: "ar", st: "buenosaires", ct: "ladulce" });
  });

  it("Cosquín: el original trae 'Cosquin/Córdoba' sin coma → Cosquín, Córdoba", () => {
    expect(phoneGeo("5493541712345")).toEqual({ country: "ar", st: "cordoba", ct: "cosquin" });
  });

  it("dos localidades unidas con 'y' (Ranchillos y San Miguel) → solo provincia", () => {
    expect(phoneGeo("5493869123456")).toEqual({ country: "ar", st: "tucuman" });
  });

  it("característica de dos provincias (Cruz Alta, Córdoba / San José de la Esquina, Santa Fe) → solo país", () => {
    expect(phoneGeo("5493467123456")).toEqual({ country: "ar" });
  });

  it("3404 figura como departamento (Dpto. Las Colonias) → su ciudad, San Carlos Centro", () => {
    expect(phoneGeo("5493404123456")).toEqual({ country: "ar", st: "santafe", ct: "sancarloscentro" });
  });

  it("formato argentino válido pero característica inexistente → solo país", () => {
    expect(phoneGeo("5492000123456")).toEqual({ country: "ar" });
  });
});

describe("phoneGeo: otros países → solo país (el prefijo del celular es de la empresa, no de la ciudad)", () => {
  it.each([
    ["595981123456", "py"],
    ["593991234567", "ec"],
    ["59899123456", "uy"],
    ["59171234567", "bo"],
    ["5511987654321", "br"],
    ["56912345678", "cl"],
    ["51912345678", "pe"],
    ["573001234567", "co"],
    ["5215512345678", "mx"],
    ["584121234567", "ve"],
    ["34612345678", "es"],
  ])("%s → %s", (tel, pais) => {
    expect(phoneGeo(tel)).toEqual({ country: pais });
  });
});

describe("phoneGeo: lo que no es un teléfono reconocible → nada", () => {
  it.each([
    ["ID interno de WhatsApp (LID, 15 dígitos)", "181234567890123"],
    ["LID que empieza como un número argentino", "549351123456789"],
    ["número cortado", "5493511234"],
    ["argentino con característica que empieza en 0", "5490123456789"],
    ["vacío", ""],
    ["país fuera de la lista (Alemania)", "4915112345678"],
  ])("%s", (_caso, tel) => {
    expect(phoneGeo(tel)).toEqual({});
  });

  it("null / undefined", () => {
    expect(phoneGeo(null)).toEqual({});
    expect(phoneGeo(undefined)).toEqual({});
  });
});
