import { describe, it, expect } from "vitest";
import { textoAvisoCarga, paisDeTelefono, horaParaguay, origenCarga } from "./landing-carga.js";

describe("aviso de carga de la landing", () => {
  const base = { marca: "Lucky Soft", creada: new Date("2026-10-18T21:46:00Z") };

  it("calificada: wa.me sin + ni espacios, país, plan y hora de Paraguay", () => {
    const t = textoAvisoCarga({
      ...base, nombre: "David", telefono: "+595 981 123-456", califica: true, fbclid: "IwAR",
      respuestas: { rubro: "casino", que: "Plataforma", cuando: "mes", inv: "simple" },
    });
    expect(t).toContain("Escribirle: https://wa.me/595981123456");
    expect(t).toContain("Teléfono: +595981123456");
    expect(t).toContain("País: Paraguay");
    expect(t).toContain("Plan: Plan Simple USD 200/mes");
    expect(t).toContain("Lead calificado — Lucky Soft");
    expect(t).not.toContain("CALIFICA");
    expect(t).toContain("Vino de: anuncio (Meta)");
    expect(t).toContain("Cargado: 18/10/2026 18:46 (hora Paraguay)");
  });

  it("no calificada: dice el motivo; fichas/CRM no tienen plan", () => {
    const t = textoAvisoCarga({
      ...base, nombre: "Ana", telefono: "5491155554444", califica: false, motivo: "solo está averiguando",
      respuestas: { rubro: "cajero", que: "Fichas", cuando: "mirando" },
    });
    expect(t).toContain("CALIFICA: NO — solo está averiguando");
    expect(t).toContain("Plan: No aplica");
    expect(t).toContain("País: Argentina");
    expect(t).toContain("Vino de: orgánico / directo");
  });

  it("sin teléfono válido no arma un link roto", () => {
    const t = textoAvisoCarga({ ...base, telefono: "", califica: false, motivo: "otro rubro", respuestas: { rubro: "otro" } });
    expect(t).not.toContain("wa.me/\n");
    expect(t).toContain("Escribirle: — (no dejó un número válido)");
  });
});

describe("helpers", () => {
  it("país por prefijo (el más largo gana)", () => {
    expect(paisDeTelefono("598991234567")).toBe("Uruguay");
    expect(paisDeTelefono("59899")).toBe("Uruguay");
    expect(paisDeTelefono("5491100000000")).toBe("Argentina");
    expect(paisDeTelefono("1234")).toBe("Otro");
  });
  it("hora Paraguay = UTC−3", () => {
    expect(horaParaguay(new Date("2026-10-14T00:30:00Z"))).toBe("13/10/2026 21:30");
  });
  it("origen: utm sin fbclid", () => {
    expect(origenCarga({ utm: "meta/b2b" })).toBe("campaña (meta/b2b)");
  });
});

describe("correo del aviso", async () => {
  const { htmlAvisoCarga } = await import("./landing-carga.js");
  it("el wa.me es un link clickeable y se escapa el HTML del nombre", () => {
    const h = htmlAvisoCarga({ marca: "Lucky Soft", nombre: "<b>Jose</b>", telefono: "595981123456", califica: true, respuestas: { que: "CRM" }, creada: new Date("2026-10-14T17:04:00Z") });
    expect(h).toContain('<a href="https://wa.me/595981123456"');
    expect(h).toContain("&lt;b&gt;Jose&lt;/b&gt;");
    expect(h).toContain("Lead calificado — Lucky Soft");
    expect(h).toContain("14/10/2026 14:04 (hora Paraguay)");
  });
});
