import { describe, it, expect } from "vitest";
import { armarVcf, telefonoVcard } from "./vcard.js";

describe("agenda .vcf", () => {
  it("una tarjeta por número, con etiqueta y etapa", () => {
    const { vcf, total } = armarVcf([
      { name: "Juan Pérez", phone: "595981234567", stage: "INTERESADO" },
      { name: "Juan otra vez", phone: "+595 981 234567", stage: "NUEVO" }, // mismo número → se saltea
      { name: null, phone: "5491122334455", stage: "COMPRO" },
    ]);
    expect(total).toBe(2);
    expect(vcf).toContain("FN:Juan Pérez - Publi");
    expect(vcf).toContain("TEL;TYPE=CELL:+595981234567");
    expect(vcf).toContain("CATEGORIES:Publi,Interesado");
    expect(vcf).toContain("FN:Cliente 4455 - Publi");
    expect(vcf).not.toContain("Juan otra vez");
    expect(vcf.match(/BEGIN:VCARD/g)).toHaveLength(2);
  });
  it("escapa comas y punto y coma del nombre", () => {
    expect(armarVcf([{ name: "Ana; Tienda, Centro", phone: "595981000000", stage: "NUEVO" }]).vcf).toContain("FN:Ana\\; Tienda\\, Centro - Publi");
  });
  it("descarta números que no son reales", () => {
    expect(telefonoVcard("123")).toBeNull();
    expect(telefonoVcard("1234567890123456789")).toBeNull(); // LID largo
    expect(telefonoVcard(null)).toBeNull();
    expect(armarVcf([{ name: "x", phone: "12", stage: "NUEVO" }])).toEqual({ vcf: "", total: 0 });
  });
});
