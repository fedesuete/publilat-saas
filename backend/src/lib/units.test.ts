import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { slugify } from "./auth.js";
import { signPayload } from "./integrations.js";
import { priceFor } from "./payments.js";
import { renderTrackedLanding, injectCurrentPixel, injectInAppEscape } from "./landing-template.js";
import { buildProxyConfig } from "./proxy-pool.js";
import { credentialsSignal } from "./funnel-detect.js";
import type { Proxy } from "@prisma/client";
import { textSignalsPayment } from "./payment-detect.js";
import { parseInboundAmount, normalizeRef } from "../routes/integrations.js";

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

describe("injectCurrentPixel (pixel vigente al servir /p/:slug)", () => {
  it("reemplaza el pixel horneado por el vigente (init + noscript)", () => {
    const baked = renderTrackedLanding({
      pixelId: "111111", userSlug: "d", goBase: "", title: "T",
      headline: "H", subtitle: "S", buttonText: "B", msg: "m",
    });
    const out = injectCurrentPixel(baked, "999999");
    expect(out).toContain("fbq('init', '999999')");
    expect(out).not.toContain("111111");
    expect(out).toContain("facebook.com/tr?id=999999");
  });
  it("inyecta el snippet si el HTML no tenía pixel", () => {
    const out = injectCurrentPixel("<html><head></head><body>hola</body></html>", "555");
    expect(out).toContain("fbq('init','555')");
    expect(out).toContain("connect.facebook.net/en_US/fbevents.js");
  });
  it("no toca nada si no hay pixel vigente o el id no es numérico", () => {
    const src = "<html><head></head><body>x</body></html>";
    expect(injectCurrentPixel(src, "")).toBe(src);
    expect(injectCurrentPixel(src, "abc")).toBe(src);
  });
});

describe("credentialsSignal (patrón: operador entrega usuario+clave)", () => {
  it("detecta usuario + clave en el mismo mensaje", () => {
    expect(credentialsSignal("Tu usuario: juan123 y la clave: 4567")).toBe(true);
    expect(credentialsSignal("user: pedro pass: abcd")).toBe(true);
    expect(credentialsSignal("ingreso con contraseña 9999")).toBe(true);
  });
  it("NO dispara con solo uno de los dos (ni texto suelto)", () => {
    expect(credentialsSignal("hola, tu usuario está listo")).toBe(false);
    expect(credentialsSignal("mandame la clave")).toBe(false);
    expect(credentialsSignal("gracias por escribir")).toBe(false);
    expect(credentialsSignal("")).toBe(false);
  });
});

describe("buildProxyConfig (username sticky por proveedor)", () => {
  const base: Proxy = {
    id: "p1", label: "x", provider: "dataimpulse", host: "gw.dataimpulse.com", port: 823,
    username: "USER", password: "PASS", protocol: "http", country: "ar", sticky: true,
    sessTime: 120, maxLines: 4, active: true, healthy: true, lastCheckAt: null, createdAt: new Date(),
  };
  it("DataImpulse: username con país + sessid (misma IP por sesión, SIN sesstime)", () => {
    // Confirmado en docs.dataimpulse.com: sticky = LOGIN__cr.<país>;sessid.<s> en puerto 823.
    // NO existe 'sesstime' (la duración es fija ~30 min); mandarlo rompe la auth.
    const cfg = buildProxyConfig(base, "abc123");
    expect(cfg.username).toBe("USER__cr.ar;sessid.abc123");
    expect(cfg.host).toBe("gw.dataimpulse.com");
    expect(cfg.port).toBe("823"); // el motor pide string
    expect(cfg.password).toBe("PASS");
  });
  it("sin sesión: solo el país (no sticky)", () => {
    expect(buildProxyConfig(base, null).username).toBe("USER__cr.ar");
  });
  it("DataImpulse MÓVIL: mismo formato que el residencial (__cr.ar;sessid)", () => {
    const cfg = buildProxyConfig({ ...base, provider: "dataimpulse_mobile" }, "m1");
    expect(cfg.username).toBe("USER__cr.ar;sessid.m1");
    expect(cfg.port).toBe("823");
  });
  it("proveedor genérico: sufijo de sesión en el usuario", () => {
    expect(buildProxyConfig({ ...base, provider: "otro", country: null }, "s1").username).toBe("USER-session-s1");
  });
});

describe("injectInAppEscape (recupera tráfico CTWA del webview)", () => {
  it("inyecta el escape una sola vez (idempotente) con la detección de in-app", () => {
    const src = "<html><head></head><body>hola</body></html>";
    const once = injectInAppEscape(src);
    expect(once).toContain("pl-inapp-escape");
    expect(once).toContain("FBAN|FBAV");
    // idempotente: no lo duplica
    expect(injectInAppEscape(once)).toBe(once);
  });
});

describe("webhook entrante de compra (Kommo → Purchase)", () => {
  it("parsea montos en formatos varios", () => {
    expect(parseInboundAmount(15000)).toBe(15000);
    expect(parseInboundAmount("15000")).toBe(15000);
    expect(parseInboundAmount("15.000")).toBe(15000);       // miles con punto (es-AR/PY)
    expect(parseInboundAmount("15.000,50")).toBe(15000.5);   // miles + decimal con coma
    expect(parseInboundAmount("Gs 15000")).toBe(15000);      // con prefijo de moneda
    expect(parseInboundAmount("1500,50")).toBe(1500.5);
    expect(Number.isNaN(parseInboundAmount(""))).toBe(true);
    expect(Number.isNaN(parseInboundAmount("abc"))).toBe(true);
  });
  it("normaliza el ref (mayúsculas, sin símbolos)", () => {
    expect(normalizeRef("28c4b1a2")).toBe("28C4B1A2");
    expect(normalizeRef(" 28C4B1A2 ")).toBe("28C4B1A2");
    expect(normalizeRef("ref: 28C4B1A2")).toBe("REF28C4B1A2"); // el llamador manda solo el code; defensivo
    expect(normalizeRef(undefined)).toBe("");
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

// ============ Integración Kommo (estilo ScaleOS) ============
describe("kommo", () => {
  it("normalizeKommoBase: solo https en *.kommo.com (guard SSRF)", async () => {
    const { normalizeKommoBase } = await import("./kommo.js");
    expect(normalizeKommoBase("https://miempresa.kommo.com")).toBe("https://miempresa.kommo.com");
    expect(normalizeKommoBase("https://MiEmpresa.kommo.com/algo?x=1")).toBe("https://miempresa.kommo.com");
    expect(normalizeKommoBase("http://miempresa.kommo.com")).toBeNull();       // sin TLS no
    expect(normalizeKommoBase("https://kommo.com.evil.io")).toBeNull();        // dominio ajeno
    expect(normalizeKommoBase("https://localhost")).toBeNull();                // host interno
    expect(normalizeKommoBase("https://169.254.169.254")).toBeNull();          // metadata AWS
    expect(normalizeKommoBase("no es una url")).toBeNull();
  });

  it("isWonStageName: etapas ganadas sí, perdidas no", async () => {
    const { isWonStageName } = await import("./kommo.js");
    expect(isWonStageName("Ganado")).toBe(true);
    expect(isWonStageName("Compró")).toBe(true);
    expect(isWonStageName("Venta cerrada")).toBe(true);
    expect(isWonStageName("Closed - won")).toBe(true);
    expect(isWonStageName("Pagado ✔")).toBe(true);
    expect(isWonStageName("Logrado con éxito")).toBe(true);
    expect(isWonStageName("Cerrado perdido")).toBe(false); // "cerrad" pero PERDIDO
    expect(isWonStageName("Closed - lost")).toBe(false);
    expect(isWonStageName("Contacto inicial")).toBe(false);
    expect(isWonStageName("Negociación")).toBe(false);
  });

  it("extractRefFromText: agarra el (ref: XXXX) del /go en sus variantes", async () => {
    const { extractRefFromText } = await import("./kommo.js");
    expect(extractRefFromText("Hola! Quiero el bono (ref: 28C4B1A2)")).toBe("28C4B1A2");
    expect(extractRefFromText("hola ref:ab12cd34")).toBe("AB12CD34");
    expect(extractRefFromText("REF #F00DBEEF llegó")).toBe("F00DBEEF");
    expect(extractRefFromText("Hola, quiero más información")).toBeNull();
    expect(extractRefFromText("prefiero el otro")).toBeNull(); // "ref" adentro de palabra NO cuenta
  });
});
