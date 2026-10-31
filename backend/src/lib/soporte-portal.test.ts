import { describe, it, expect } from "vitest";
import { firmar, firmaValida, textoDesdePortal, resolverDestino } from "./soporte-portal.js";

describe("destino de un envío del portal", () => {
  const grupos = [
    { jid: "111@g.us", nombre: "Casino Millonarios - LuckySoft" },
    { jid: "222@g.us", nombre: "Casino Millonarios" },
    { jid: "333@g.us", nombre: "Repetido" },
    { jid: "444@g.us", nombre: "repetido " },
  ];
  it("grupo por nombre exacto, sin espacios a los costados e ignorando mayúsculas", () => {
    expect(resolverDestino("  casino millonarios - luckysoft ", "", grupos)).toEqual({ ok: true, chatId: "111@g.us", log: "111@g.us" });
  });
  it("no adivina: parecido = no encontrado; dos iguales = ambiguo", () => {
    expect(resolverDestino("Casino Millonarios LuckySoft", "", grupos)).toMatchObject({ ok: false, status: 404, error: "grupo no encontrado" });
    expect(resolverDestino("Repetido", "", grupos)).toMatchObject({ ok: false, status: 404, error: "grupo ambiguo" });
  });
  it("un JID se usa tal cual", () => {
    expect(resolverDestino("120363012345678901@g.us", "", [])).toMatchObject({ ok: true, chatId: "120363012345678901@g.us" });
  });
  it("sin grupo va al 1 a 1 y solo loguea los últimos 4 dígitos", () => {
    expect(resolverDestino("", "595981234567", grupos)).toEqual({ ok: true, chatId: "595981234567@c.us", log: "…4567" });
    expect(resolverDestino("", "+595 981", grupos)).toMatchObject({ ok: false, status: 422 });
    expect(resolverDestino("", "", grupos)).toMatchObject({ ok: false, status: 422 });
  });
});

const S = "secreto-de-prueba-0123456789abcdef";

describe("firma HMAC con el portal", () => {
  const cuerpo = Buffer.from(JSON.stringify({ ticketId: "12", mensaje: "hola" }));
  it("acepta la firma correcta, con o sin 'sha256='", () => {
    const f = firmar(cuerpo, S);
    expect(firmaValida(cuerpo, f, S)).toBe(true);
    expect(firmaValida(cuerpo, "sha256=" + f, S)).toBe(true);
    expect(firmaValida(cuerpo, f.toUpperCase(), S)).toBe(true);
  });
  it("rechaza firma de otro cuerpo, vacía, o sin secreto configurado", () => {
    expect(firmaValida(cuerpo, firmar(Buffer.from("otro"), S), S)).toBe(false);
    expect(firmaValida(cuerpo, "", S)).toBe(false);
    expect(firmaValida(cuerpo, firmar(cuerpo, S), "")).toBe(false);
  });
});

describe("mensaje del portal en SOPORTE", () => {
  it("lleva el código, el ticket, el cliente y cómo responder", () => {
    const t = textoDesdePortal({ code: "K7M", ticketId: "12", cliente: "Bet17", email: "a@b.com", asunto: "No carga", mensaje: "Hola, no me anda", categoria: "tecnico", prioridad: "alta", url: "https://softlucky.com/portal/ticket.php?id=12" });
    expect(t.startsWith("🆕 #K7M · Portal · Ticket 12 · No carga")).toBe(true);
    expect(t).toContain("👤 Bet17 (a@b.com)");
    expect(t).toContain("🏷️ tecnico · prioridad alta");
    expect(t).toContain("🔗 https://softlucky.com/portal/ticket.php?id=12");
    expect(t).toContain("empezá con B-");
  });
});
