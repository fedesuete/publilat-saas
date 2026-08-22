import { describe, it, expect, vi } from "vitest";

// meta-capi.ts importa pixel.js → prisma (no generado en el runner): mock para poder importar.
vi.mock("./pixel.js", () => ({ resolveShadowPixels: vi.fn(async () => []) }));

import { metaErrorDetail } from "./meta-capi.js";

describe("metaErrorDetail", () => {
  it("extrae el error real de Meta (mensaje + subcode + type) del axios error", () => {
    const e = {
      isAxiosError: true,
      response: { data: { error: { message: "Invalid parameter", code: 100, error_subcode: 2804005, type: "OAuthException" } } },
      message: "Request failed with status code 400",
    };
    const d = metaErrorDetail(e);
    expect(d.message).toContain("Invalid parameter");
    expect(d.subcode).toBe(2804005);
    expect(d.type).toBe("OAuthException");
  });

  it("sin body de Meta → cae al message genérico", () => {
    expect(metaErrorDetail(new Error("boom")).message).toBe("boom");
  });

  it("string suelto → lo usa como message", () => {
    expect(metaErrorDetail("explotó").message).toBe("explotó");
  });
});
