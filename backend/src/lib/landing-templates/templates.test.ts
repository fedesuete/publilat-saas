import { describe, it, expect, vi } from "vitest";
import { pixelHead, goHref, footer18, fill } from "./shared.js";
import { TEMPLATES, getTemplate, renderTemplate } from "./index.js";
import type { TplCtx, TplDef } from "./types.js";

// Mocks para poder importar routes/landings.js (el runner de tests no tiene el prisma
// client generado y no queremos side-effects reales de S3/CloudFront en tests).
vi.mock("../prisma.js", () => ({ prisma: {} }));
vi.mock("../pixel.js", () => ({ resolveUserPixel: vi.fn(async () => undefined), resolveShadowPixels: vi.fn(async () => []) }));
vi.mock("../s3.js", () => ({ publishToS3: vi.fn(), uploadHtml: vi.fn(), s3Enabled: () => false }));
vi.mock("../cloudfront.js", () => ({ ensureClientCdn: vi.fn(), reprovisionClientDomain: vi.fn(), invalidate: vi.fn() }));
vi.mock("../auth.js", () => ({ slugify: (s: string) => s.toLowerCase() }));
vi.mock("../access.js", () => ({ getAvailableDays: vi.fn(async () => 0) }));

const CTX: TplCtx = { pixelId: "123", userSlug: "matias", goBase: "https://app.publi.lat", values: {} };

describe("shared", () => {
  it("pixelHead trae PageView y NUNCA Lead", () => {
    const h = pixelHead("999");
    expect(h).toContain("fbq('track','PageView')");
    expect(h).not.toMatch(/fbq\(\s*['"]track['"]\s*,\s*['"]Lead['"]/);
  });

  it("pixelHead sin pixel → vacío", () => expect(pixelHead("")).toBe(""));

  it("goHref arma /go con u, msg y line opcional", () => {
    expect(goHref(CTX, "hola")).toBe("https://app.publi.lat/go?u=matias&msg=hola");
    expect(goHref({ ...CTX, line: "5491111" }, "hola")).toContain("&line=5491111");
  });

  it("footer18 tiene el texto legal completo", () =>
    expect(footer18()).toContain("El juego compulsivo es perjudicial para la salud"));

  it("fill: aplica defaults, recorta al max, escapa HTML y valida color", () => {
    const def: TplDef = {
      id: "x", name: "x", desc: "", category: "casino",
      fields: [
        { key: "brand", label: "", type: "text", max: 5, default: "Casa" },
        { key: "accent", label: "", type: "color", max: 7, default: "#25d366" },
      ],
      render: () => "",
    };
    expect(fill(def, {})).toEqual({ brand: "Casa", accent: "#25d366" });
    // clamp del RAW primero ("<scri"), esc después: el límite protege la UI, no parte entidades.
    expect(fill(def, { brand: "<script>alert(1)</script>" }).brand).toBe("&lt;scri");
    expect(fill(def, { accent: "red" }).accent).toBe("#25d366"); // color inválido → default
  });
});

describe("config del CRUD acepta modo plantilla", () => {
  it("template+values válidos pasan; values gigantes no", async () => {
    const { configTemplateFields } = await import("../../routes/landings.js");
    expect(configTemplateFields.safeParse({ template: "casino-bono", values: { brand: "X" } }).success).toBe(true);
    expect(configTemplateFields.safeParse({ values: { brand: "y".repeat(401) } }).success).toBe(false);
  });
});

// Invariantes que TODA plantilla del registro (presente y futura) tiene que cumplir.
// Si alguien agrega una plantilla que dispara Lead browser o pierde el +18, esto la frena.
describe("invariantes de TODAS las plantillas", () => {
  const ctx: TplCtx = { pixelId: "777", userSlug: "matias", goBase: "https://app.publi.lat", line: "555", values: {} };

  it("hay 4 y los ids son únicos", () => {
    expect(TEMPLATES.length).toBe(4);
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(4);
  });

  for (const name of ["casino-simple", "casino-bono", "casino-urgencia", "casino-vip"]) {
    it(`${name} existe en el registro`, () => expect(getTemplate(name)).toBeDefined());
  }

  it("getTemplate inexistente → undefined", () => expect(getTemplate("nope")).toBeUndefined());

  for (const t of TEMPLATES) {
    describe(t.id, () => {
      const html = () => renderTemplate(t, ctx);
      it("NO dispara Lead browser", () => expect(html()).not.toMatch(/fbq\(\s*['"]track['"]\s*,\s*['"]Lead['"]/));
      it("SÍ trae PageView del pixel", () => expect(html()).toContain("fbq('track','PageView')"));
      it("CTA apunta a /go con u y line", () => {
        expect(html()).toContain("https://app.publi.lat/go?u=matias");
        expect(html()).toContain("&line=555");
      });
      it("footer +18 presente", () => expect(html()).toContain("El juego compulsivo es perjudicial"));
      it("inputs con <script> quedan escapados", () => {
        const out = renderTemplate(t, { ...ctx, values: { headline: "<script>x()</script>" } });
        expect(out).not.toContain("<script>x()");
      });
      it("viewport mobile presente", () => expect(html()).toContain("width=device-width"));
    });
  }
});
