import { describe, it, expect, vi } from "vitest";

// purchase.ts arrastra prisma/meta-capi/etc (no generados en el runner de tests): mockeados
// para poder importar la función pura choosePayerName.
vi.mock("./prisma.js", () => ({ prisma: {} }));
vi.mock("./meta-capi.js", () => ({ sendCapiEvent: vi.fn(), globalPixelAllowed: () => false, contactFbc: vi.fn() }));
vi.mock("./pixel.js", () => ({ resolveUserPixel: vi.fn() }));
vi.mock("./integrations.js", () => ({ fireIntegration: vi.fn() }));
vi.mock("./io.js", () => ({ emitToUser: vi.fn() }));
vi.mock("./notifications.js", () => ({ notify: vi.fn() }));
vi.mock("./capi-guard.js", () => ({ notifyMissingPixel: vi.fn() }));

import { choosePayerName } from "./purchase.js";

describe("choosePayerName (nombre para fn/ln del Purchase)", () => {
  it("usa el nombre del OCR si trae apellido (≥2 palabras)", () => {
    expect(choosePayerName("JIMENA SOLEDAD LENCINAS", "Jimena")).toBe("JIMENA SOLEDAD LENCINAS");
  });
  it("cae al nombre del contacto si el OCR no trajo nombre", () => {
    expect(choosePayerName(null, "Jimena")).toBe("Jimena");
  });
  it("ignora un OCR de una sola palabra (no aporta apellido)", () => {
    expect(choosePayerName("Jimena", "Jime")).toBe("Jime");
  });
  it("si no hay ni OCR ni contacto → undefined", () => {
    expect(choosePayerName(null, null)).toBeUndefined();
  });
  it("OCR de una palabra y contacto vacío → usa el OCR igual (mejor que nada)", () => {
    expect(choosePayerName("Jimena", null)).toBe("Jimena");
  });
});
