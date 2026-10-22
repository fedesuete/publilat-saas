import { describe, it, expect } from "vitest";
import { firmar, firmaValida, textoDesdePortal } from "./soporte-portal.js";

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
