import { describe, it, expect } from "vitest";
import { pixelHead, goHref, footer18, fill } from "./shared.js";
import type { TplCtx, TplDef } from "./types.js";

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
