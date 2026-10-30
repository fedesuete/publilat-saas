// Pedidos "C-" del grupo SOPORTE para Claude: qué cuenta como pedido, como aprobación, y qué se contesta.
import { describe, it, expect } from "vitest";
import { parsePedido, parseAprobacion, interpretar, clasificarEstado, listaDe, activo, recortar, textoRespuesta, ICONO } from "./claude-ops.js";

describe("interpretar (lo que se vio el primer día, 30/10)", () => {
  it("C- ok N / C- no N aprueban como ok N (Federico escribió 'C- ok 2' y no contó)", () => {
    expect(interpretar("C- ok 2")).toEqual({ tipo: "aprobacion", accion: "ok", numero: 2, nota: "" });
    expect(interpretar("c- OK #2 con el 549")).toEqual({ tipo: "aprobacion", accion: "ok", numero: 2, nota: "con el 549" });
    expect(interpretar("C- no 2 ya no hace falta")).toEqual({ tipo: "aprobacion", accion: "no", numero: 2, nota: "ya no hace falta" });
  });
  it("C- #N ok … es aprobación con el texto guardado por si el #N no estaba esperando ok", () => {
    expect(interpretar("C- #2 ok")).toEqual({ tipo: "aprobacion", accion: "ok", numero: 2, nota: "", seguimiento: "ok" });
    expect(interpretar("C- #2 dale, con el 549")).toEqual({ tipo: "aprobacion", accion: "ok", numero: 2, nota: "con el 549", seguimiento: "dale, con el 549" });
    expect(interpretar("C- #2 no")).toEqual({ tipo: "aprobacion", accion: "no", numero: 2, nota: "", seguimiento: "no" });
  });
  it("C- #N no funciona… es un seguimiento, no un rechazo", () => {
    expect(interpretar("C- #2 no funciona el botón")).toEqual({ tipo: "pedido", numero: 2, texto: "no funciona el botón" });
    expect(interpretar("C- #2 el número es 549111")).toEqual({ tipo: "pedido", numero: 2, texto: "el número es 549111" });
  });
  it("pedidos y aprobaciones de siempre, y lo que no es nada", () => {
    expect(interpretar("C- cambiá el número")).toEqual({ tipo: "pedido", numero: null, texto: "cambiá el número" });
    expect(interpretar("C- si podés mirá el log")).toEqual({ tipo: "pedido", numero: null, texto: "si podés mirá el log" });
    expect(interpretar("ok 47")).toEqual({ tipo: "aprobacion", accion: "ok", numero: 47, nota: "" });
    expect(interpretar("B- hola")).toBeNull();
    expect(interpretar("ok gracias")).toBeNull();
  });
});

describe("clasificarEstado: una pregunta no es un plan", () => {
  it("esperando_ok que termina preguntando → necesita_info", () => {
    expect(clasificarEstado("esperando_ok", "No me queda claro qué hay que cambiar.\n\n¿Qué querés cambiar de Eurofortuna?")).toBe("necesita_info");
    expect(clasificarEstado("esperando_ok", "¿Qué número?  ")).toBe("necesita_info");
  });
  it("un plan de verdad (dice cómo se revierte, o no termina preguntando) sigue esperando ok", () => {
    expect(clasificarEstado("esperando_ok", "Plan: cambio el número en Personalizar.\nSe revierte poniendo el anterior.\n¿Avanzo?")).toBe("esperando_ok");
    expect(clasificarEstado("esperando_ok", "Plan: cambio el número en Personalizar. Verifico en el sitio.")).toBe("esperando_ok");
  });
  it("los otros estados no se tocan", () => {
    expect(clasificarEstado("hecho", "¿Algo más?")).toBe("hecho");
    expect(clasificarEstado("error", "¿?")).toBe("error");
  });
});

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
