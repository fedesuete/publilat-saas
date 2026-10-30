// Pedidos "C-" del grupo SOPORTE para Claude: qué cuenta como pedido, como aprobación, y qué se contesta.
import { describe, it, expect } from "vitest";
import { parsePedido, parseAprobacion, listaDe, activo, recortar, textoRespuesta, ICONO } from "./claude-ops.js";

describe("parsePedido", () => {
  it("C- con variantes de guion y espacios", () => {
    expect(parsePedido("C- cambiá el número")).toEqual({ numero: null, texto: "cambiá el número" });
    expect(parsePedido("c - fijate el log")).toEqual({ numero: null, texto: "fijate el log" });
    expect(parsePedido("  C– algo")).toEqual({ numero: null, texto: "algo" });
  });
  it("seguimiento C- #N", () => {
    expect(parsePedido("C- #47 el número es 549111")).toEqual({ numero: 47, texto: "el número es 549111" });
    expect(parsePedido("C-#47")).toEqual({ numero: 47, texto: "" });
  });
  it("vacío (captura sola con C-) sigue siendo pedido", () => {
    expect(parsePedido("C-")).toEqual({ numero: null, texto: "" });
  });
  it("lo que no empieza con C- no es pedido (B-, charla, mensajes del bot)", () => {
    expect(parsePedido("B- hola cliente")).toBeNull();
    expect(parsePedido("che, C- esto no")).toBeNull();
    expect(parsePedido(`${ICONO} *#47* recibido`)).toBeNull();
    expect(parsePedido("Cambiá esto")).toBeNull();
    expect(parsePedido(null)).toBeNull();
  });
});

describe("parseAprobacion", () => {
  it("ok N / no N con y sin #", () => {
    expect(parseAprobacion("ok 47")).toEqual({ accion: "ok", numero: 47, nota: "" });
    expect(parseAprobacion("OK #47")).toEqual({ accion: "ok", numero: 47, nota: "" });
    expect(parseAprobacion("no 47 ya no hace falta")).toEqual({ accion: "no", numero: 47, nota: "ya no hace falta" });
    expect(parseAprobacion("dale 12")).toEqual({ accion: "ok", numero: 12, nota: "" });
  });
  it("ok N con ajuste", () => {
    expect(parseAprobacion("ok 47 pero con el 5491100000000")).toEqual({ accion: "ok", numero: 47, nota: "pero con el 5491100000000" });
  });
  it("sin número no es aprobación (un 'ok' suelto en la charla no dispara nada)", () => {
    expect(parseAprobacion("ok")).toBeNull();
    expect(parseAprobacion("ok gracias")).toBeNull();
    expect(parseAprobacion("noooo 4")).toBeNull();
    expect(parseAprobacion(`${ICONO} #47 aprobado`)).toBeNull();
  });
});

describe("listaDe / activo", () => {
  it("teléfonos en dígitos y la palabra soporte", () => {
    expect([...listaDe("+54 9 11 2547-8824, 5491168315055 ,soporte,,x")]).toEqual(["5491125478824", "5491168315055", "soporte"]);
  });
  it("apagado sin secreto o sin pedidores", () => {
    expect(activo({})).toBe(false);
    expect(activo({ CLAUDE_OPS_SECRET: "x" })).toBe(false);
    expect(activo({ CLAUDE_OPS_PEDIDOS: "5491125478824" })).toBe(false);
    expect(activo({ CLAUDE_OPS_SECRET: "x", CLAUDE_OPS_PEDIDOS: "5491125478824" })).toBe(true);
  });
});

describe("textos al grupo", () => {
  it("plan con ok/no del mismo número", () => {
    const t = textoRespuesta(47, "esperando_ok", "Cambio el WhatsApp de vipganamos.");
    expect(t).toContain("#47");
    expect(t).toContain("ok 47");
    expect(t).toContain("no 47");
    expect(t.startsWith(ICONO)).toBe(true);
  });
  it("hecho, error y pedido de dato", () => {
    expect(textoRespuesta(5, "hecho", "Listo")).toContain("✅");
    expect(textoRespuesta(5, "error", "Falló")).toContain("❌");
    expect(textoRespuesta(5, "necesita_info", "¿Qué número?")).toContain("C- #5");
  });
  it("recorta lo largo para WhatsApp", () => {
    const largo = Array.from({ length: 400 }, (_, i) => `línea ${i} con texto`).join("\n");
    const r = recortar(largo, 500);
    expect(r.length).toBeLessThanOrEqual(520);
    expect(r.endsWith("(recortado)")).toBe(true);
    expect(recortar("corto")).toBe("corto");
  });
});
