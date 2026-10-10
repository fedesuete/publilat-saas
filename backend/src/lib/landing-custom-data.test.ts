import { describe, it, expect, vi } from "vitest";
import axios from "axios";
import { customDataLanding } from "./landing-custom-data.js";

vi.mock("axios", () => ({ default: { post: vi.fn(async () => ({ data: { events_received: 1 } })), isAxiosError: () => false } }));
vi.mock("./pixel.js", () => ({ resolveShadowPixels: vi.fn(async () => []) }));

describe("customDataLanding (respuestas del formulario → custom_data)", () => {
  it("Plataforma con inversión: valores fijos en minúscula + origen landing", () => {
    expect(customDataLanding({ categoria: "Plataforma", plazo: "ya", inversion: "simple" }))
      .toEqual({ content_category: "plataforma_enlatada", plazo: "ya", inversion: "simple", origen: "landing" });
  });
  it("Fichas / CRM / A medida (y un tipo nuevo con espacios)", () => {
    expect(customDataLanding({ categoria: "Juegos  Propios" })).toMatchObject({ content_category: "juegos_propios" });
    expect(customDataLanding({ categoria: "Fichas", plazo: "mes" })).toMatchObject({ content_category: "fichas" });
    expect(customDataLanding({ categoria: "CRM" })).toMatchObject({ content_category: "crm" });
    expect(customDataLanding({ categoria: "A medida" })).toMatchObject({ content_category: "a_medida" });
  });
  it("sin respuestas (landing vieja) → nada, el Lead sale como siempre", () => {
    expect(customDataLanding({})).toBeUndefined();
  });
});

describe("sendCapiEvent manda el custom_data", async () => {
  const { sendCapiEvent } = await import("./meta-capi.js");
  const body = () => (axios.post as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1] as { data: Array<{ custom_data?: Record<string, unknown> }> };
  it("Lead con customData", async () => {
    await sendCapiEvent({ eventName: "Lead", externalId: "x", pixelId: "p", capiToken: "t", customData: { content_category: "fichas", plazo: "ya" } });
    expect(body().data[0].custom_data).toEqual({ content_category: "fichas", plazo: "ya" });
  });
  it("Purchase: se suma a value/currency sin pisarlos", async () => {
    await sendCapiEvent({ eventName: "Purchase", externalId: "x", pixelId: "p", capiToken: "t", value: 200, currency: "USD", customData: { content_category: "crm", value: 1 } });
    expect(body().data[0].custom_data).toEqual({ content_category: "crm", value: 200, currency: "USD" });
  });
  it("sin customData: el Lead sigue sin custom_data", async () => {
    await sendCapiEvent({ eventName: "Lead", externalId: "x", pixelId: "p", capiToken: "t" });
    expect(body().data[0].custom_data).toBeUndefined();
  });
});

describe("contentCategory (producto marcado → valor exacto de Meta)", async () => {
  const { contentCategory, CATEGORIAS } = await import("./landing-custom-data.js");
  it("los 4 productos del selector del Inbox", () => {
    expect(CATEGORIAS.map((c) => contentCategory(c))).toEqual(["plataforma_enlatada", "a_medida", "fichas", "crm"]);
  });
  it("vacío → nada", () => {
    expect(contentCategory(null)).toBeUndefined();
    expect(contentCategory("  ")).toBeUndefined();
  });
});

describe("sendCapiEvent: Schedule con content_category", async () => {
  const { sendCapiEvent } = await import("./meta-capi.js");
  it("sale como Schedule con su custom_data", async () => {
    await sendCapiEvent({ eventName: "Schedule", externalId: "x", pixelId: "p", capiToken: "t", customData: { content_category: "a_medida" } });
    const ev = ((axios.post as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1] as { data: Array<{ event_name: string; custom_data?: Record<string, unknown> }> }).data[0];
    expect(ev.event_name).toBe("Schedule");
    expect(ev.custom_data).toEqual({ content_category: "a_medida" });
  });
});
