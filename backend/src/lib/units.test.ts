import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { slugify } from "./auth.js";
import { signPayload } from "./integrations.js";
import { priceFor } from "./payments.js";
import { renderTrackedLanding } from "./landing-template.js";
import { textSignalsPayment } from "./payment-detect.js";

describe("slugify", () => {
  it("normaliza acentos, espacios y mayúsculas", () => {
    expect(slugify("Cerrajería 24h")).toBe("cerrajeria-24h");
    expect(slugify("  Hola   Mundo  ")).toBe("hola-mundo");
    expect(slugify("a/b\\c?d")).toBe("a-b-c-d");
  });
  it("limita el largo a 40", () => {
    expect(slugify("x".repeat(60)).length).toBe(40);
  });
});

describe("signPayload (HMAC-SHA256)", () => {
  it("es determinístico y con prefijo sha256=", () => {
    const a = signPayload('{"a":1}', "secreto");
    const b = signPayload('{"a":1}', "secreto");
    expect(a).toBe(b);
    expect(a.startsWith("sha256=")).toBe(true);
  });
  it("cambia con el secret o el payload", () => {
    expect(signPayload("x", "s1")).not.toBe(signPayload("x", "s2"));
    expect(signPayload("x", "s")).not.toBe(signPayload("y", "s"));
  });
});

describe("priceFor", () => {
  it("MercadoPago: días por precio local", () => {
    const { amount, currency } = priceFor("mercadopago", 10);
    expect(amount).toBe(10 * Number(process.env.MP_PRICE_PER_DAY ?? 1000));
    expect(typeof currency).toBe("string");
  });
  it("Stripe y USDT cobran en USD", () => {
    expect(priceFor("stripe", 3).currency).toBe("USD");
    expect(priceFor("usdt", 3).currency).toBe("USD");
    expect(priceFor("usdt", 3).amount).toBe(3 * Number(process.env.PRICE_PER_DAY_USD ?? 1));
  });
  it("el pack de 90 días tiene descuento por volumen (precio/día menor o igual)", () => {
    const perDay90 = priceFor("usdt", 90).amount / 90;
    const perDay10 = priceFor("usdt", 10).amount / 10;
    expect(perDay90).toBeLessThanOrEqual(perDay10);
  });
});

describe("pagopar", () => {
  const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");

  it("monto como PHP strval(floatval(x)): sin decimales de más", async () => {
    const p = await import("./payments.js");
    expect(p.pagoparAmountString(7500)).toBe("7500");
    expect(p.pagoparAmountString(7500.5)).toBe("7500.5");
    expect(p.pagoparAmountString(7500.0)).toBe("7500");
  });

  it("priceFor pagopar: guaraníes enteros, mínimo Gs. 1.000", async () => {
    const p = await import("./payments.js");
    const q = p.priceFor("pagopar", 3);
    expect(q.currency).toBe("PYG");
    expect(Number.isInteger(q.amount)).toBe(true);
    expect(p.priceFor("pagopar", 1).amount).toBeGreaterThanOrEqual(1000);
  });

  it("token del pedido y validación del webhook (SHA1 clave privada)", async () => {
    vi.stubEnv("PAGOPAR_PRIVATE_KEY", "clave-privada-test");
    vi.stubEnv("PAGOPAR_PUBLIC_KEY", "clave-publica-test");
    vi.resetModules();
    const p = await import("./payments.js");

    // iniciar-transaccion: sha1(privada + id_pedido + monto)
    expect(p.pagoparToken("PED1", p.pagoparAmountString(7500))).toBe(sha1("clave-privada-testPED17500"));

    // consulta de pedido: sha1(privada + "CONSULTA")
    expect(p.pagoparToken("CONSULTA")).toBe(sha1("clave-privada-testCONSULTA"));

    // webhook: sha1(privada + hash_pedido) === token recibido
    const hash = "ad57c9c94f745fdd9bc9093bb409297607264af1";
    expect(p.verifyPagoparWebhook(hash, sha1("clave-privada-test" + hash))).toBe(true);
    expect(p.verifyPagoparWebhook(hash, sha1("otra-clave" + hash))).toBe(false);
    expect(p.verifyPagoparWebhook(hash, "")).toBe(false);
    expect(p.verifyPagoparWebhook("", sha1("clave-privada-test"))).toBe(false);

    vi.unstubAllEnvs();
    vi.resetModules();
  });
});

describe("renderTrackedLanding", () => {
  const html = renderTrackedLanding({
    pixelId: "123456",
    userSlug: "demo",
    goBase: "http://localhost:4000",
    title: "T",
    headline: "Hola <b>",
    subtitle: "Sub",
    buttonText: "Click",
    msg: "Hola",
  });
  it("incluye el pixel y el evento Lead deduplicado", () => {
    expect(html).toContain("fbq('init', '123456')");
    expect(html).toContain("fbq('track', 'Lead', {}, { eventID: eid })");
  });
  it("escapa HTML en el contenido (anti-XSS)", () => {
    expect(html).toContain("Hola &lt;b&gt;");
    expect(html).not.toContain("Hola <b>");
  });
});

describe("textSignalsPayment", () => {
  it("detecta avisos de pago", () => {
    expect(textSignalsPayment("Ya pagué, te paso el comprobante")).toBe(true);
    expect(textSignalsPayment("Hice la transferencia recién")).toBe(true);
    expect(textSignalsPayment("listo el pago")).toBe(true);
    expect(textSignalsPayment("aboné los 150000")).toBe(true);
  });
  it("no marca mensajes que no son de pago (evita Purchase falso)", () => {
    expect(textSignalsPayment("Hola, cuánto cuesta?")).toBe(false);
    expect(textSignalsPayment("Me interesa el producto")).toBe(false);
    expect(textSignalsPayment("")).toBe(false);
  });
});
