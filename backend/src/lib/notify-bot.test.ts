import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { notifyBotOperatorActive } from "./notify-bot.js";

// 12/09: el aviso "operador activo" (el bot cajero se calla 30 min) solo resolvía BOT_FORWARD por
// lineId. Las líneas actuales de matias (4) y de raul (2) están mapeadas por cuenta (`user:<userId>`,
// mismo mapa que usa forwardInboundToBot) → el aviso nunca salía y el bot pisaba al operador.
const fetchMock = vi.fn().mockResolvedValue({ ok: true });
beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.BOT_FORWARD;
});

describe("notifyBotOperatorActive", () => {
  it("línea mapeada por lineId → POST /operator-active con instance publilat-<lineId> y el teléfono en dígitos", () => {
    process.env.BOT_FORWARD = JSON.stringify({ lineA: "https://bot.example/api/wa/webhook?token=x" });
    notifyBotOperatorActive("lineA", "+54 9 11 6100-1815", "userZ");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(url).toBe("https://bot.example/api/wa/operator-active?token=x");
    expect(JSON.parse(init.body)).toEqual({ instance: "publilat-lineA", phone: "5491161001815" });
  });

  it("línea mapeada SOLO por cuenta (user:<userId>) → también avisa (líneas nuevas de matias/raul)", () => {
    process.env.BOT_FORWARD = JSON.stringify({ "user:userZ": "https://bot.example/api/wa/webhook?token=x" });
    notifyBotOperatorActive("lineNueva", "5491161001815", "userZ");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(url).toBe("https://bot.example/api/wa/operator-active?token=x");
    expect(JSON.parse(init.body)).toEqual({ instance: "publilat-lineNueva", phone: "5491161001815" });
  });

  it("el mapa por lineId gana sobre el de la cuenta", () => {
    process.env.BOT_FORWARD = JSON.stringify({ lineA: "https://bot-a/api/wa/webhook?token=a", "user:userZ": "https://bot-z/api/wa/webhook?token=z" });
    notifyBotOperatorActive("lineA", "5491161001815", "userZ");
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe("https://bot-a/api/wa/operator-active?token=a");
  });

  it("sin mapa para la línea ni para la cuenta → no avisa", () => {
    process.env.BOT_FORWARD = JSON.stringify({ "user:otro": "https://bot.example/api/wa/webhook?token=x" });
    notifyBotOperatorActive("lineNueva", "5491161001815", "userZ");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sin teléfono → no avisa", () => {
    process.env.BOT_FORWARD = JSON.stringify({ "user:userZ": "https://bot.example/api/wa/webhook?token=x" });
    notifyBotOperatorActive("lineNueva", null, "userZ");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
