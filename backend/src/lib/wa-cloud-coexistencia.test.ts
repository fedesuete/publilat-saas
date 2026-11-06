import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import axios from "axios";
import { activarNumeroCloud, coexistenciaHabilitada } from "./wa-cloud.js";

// 06/11: coexistencia = el número sigue en la app WhatsApp Business del celular y además entra a la
// Cloud API (Embedded Signup con featureType whatsapp_business_app_onboarding). Ese número YA está
// registrado por la app: no se le hace /register con PIN; se pide la sincronización de contactos
// e historial (/smb_app_data), que Meta solo acepta dentro de las 24 h del alta.
let postSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  postSpy = vi.spyOn(axios, "post").mockResolvedValue({ data: { success: true } });
});
afterEach(() => {
  postSpy.mockRestore();
});

const urls = () => postSpy.mock.calls.map((c) => String(c[0]));

describe("activarNumeroCloud", () => {
  it("alta normal → registra el número con el PIN (como siempre)", async () => {
    const r = await activarNumeroCloud({ phoneNumberId: "111", token: "tk", pin: "123456", coexistencia: false });
    expect(r.ok).toBe(true);
    expect(urls()).toEqual([expect.stringMatching(/\/111\/register$/)]);
    expect(postSpy.mock.calls[0][1]).toEqual({ messaging_product: "whatsapp", pin: "123456" });
  });

  it("coexistencia → NO registra con PIN; pide la sync de contactos y después la de historial", async () => {
    const r = await activarNumeroCloud({ phoneNumberId: "222", token: "tk", pin: "123456", coexistencia: true });
    expect(r.ok).toBe(true);
    expect(urls().some((u) => u.endsWith("/register"))).toBe(false);
    expect(urls()).toEqual([
      expect.stringMatching(/\/222\/smb_app_data$/),
      expect.stringMatching(/\/222\/smb_app_data$/),
    ]);
    expect(postSpy.mock.calls.map((c) => (c[1] as { sync_type: string }).sync_type)).toEqual([
      "smb_app_state_sync",
      "history",
    ]);
  });

  it("coexistencia y Meta rechaza la sync → la línea igual queda activa (ok) y se informa el error", async () => {
    postSpy.mockRejectedValue(new Error("sync fuera de ventana"));
    const r = await activarNumeroCloud({ phoneNumberId: "333", token: "tk", pin: "123456", coexistencia: true });
    expect(r.ok).toBe(true);
    expect(r.error).toMatch(/sync fuera de ventana/);
  });
});

// Mientras se prueba, la coexistencia solo se habilita a las cuentas de COEXISTENCIA_USERS (ids separados por coma).
describe("coexistenciaHabilitada", () => {
  afterEach(() => {
    delete process.env.COEXISTENCIA_USERS;
  });

  it("sin la variable → nadie la tiene", () => {
    expect(coexistenciaHabilitada("userA")).toBe(false);
  });

  it("solo las cuentas listadas (con espacios tolerados)", () => {
    process.env.COEXISTENCIA_USERS = "userA, userB";
    expect(coexistenciaHabilitada("userA")).toBe(true);
    expect(coexistenciaHabilitada("userB")).toBe(true);
    expect(coexistenciaHabilitada("userC")).toBe(false);
    expect(coexistenciaHabilitada(undefined)).toBe(false);
  });
});
