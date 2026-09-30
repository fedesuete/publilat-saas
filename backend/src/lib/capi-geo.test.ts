import { describe, it, expect, vi } from "vitest";
import crypto from "node:crypto";
import axios from "axios";

vi.mock("axios", () => ({
  default: { post: vi.fn(async () => ({ data: { events_received: 1 } })), isAxiosError: () => false },
}));
vi.mock("./pixel.js", () => ({ resolveShadowPixels: vi.fn(async () => []) }));

import { sendCapiEvent } from "./meta-capi.js";

const sha = (v: string) => crypto.createHash("sha256").update(v).digest("hex");
const lastUserData = () => {
  const body = (axios.post as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1] as {
    data: Array<{ user_data: Record<string, string> }>;
  };
  return body.data[0].user_data;
};

// País/provincia/ciudad salen del prefijo del teléfono: más claves de match → sube el EMQ.
describe("sendCapiEvent: country, st y ct desde el teléfono", () => {
  it("celular de Córdoba → country, st y ct hasheados", async () => {
    await sendCapiEvent({ eventName: "Purchase", externalId: "u1", phone: "5493511234567", pixelId: "p", capiToken: "t", value: 10 });
    const ud = lastUserData();
    expect(ud.country).toBe(sha("ar"));
    expect(ud.st).toBe(sha("cordoba"));
    expect(ud.ct).toBe(sha("cordoba"));
    // lo que ya se mandaba no cambia
    expect(ud.ph).toBe(sha("5493511234567"));
    expect(ud.external_id).toBe(sha("u1"));
  });

  it("ID interno de WhatsApp (LID, 15 dígitos) → ph como siempre, sin country/st/ct", async () => {
    await sendCapiEvent({ eventName: "Lead", externalId: "u4", phone: "181234567890123", pixelId: "p", capiToken: "t" });
    const ud = lastUserData();
    expect(ud.ph).toBe(sha("181234567890123"));
    expect(ud.country).toBeUndefined();
    expect(ud.st).toBeUndefined();
    expect(ud.ct).toBeUndefined();
  });

  it("teléfono paraguayo → solo country", async () => {
    await sendCapiEvent({ eventName: "Lead", externalId: "u2", phone: "595981123456", pixelId: "p", capiToken: "t" });
    const ud = lastUserData();
    expect(ud.country).toBe(sha("py"));
    expect(ud.st).toBeUndefined();
    expect(ud.ct).toBeUndefined();
  });

  it("sin teléfono → ni country ni st ni ct", async () => {
    await sendCapiEvent({ eventName: "Lead", externalId: "u3", pixelId: "p", capiToken: "t" });
    const ud = lastUserData();
    expect(ud.country).toBeUndefined();
    expect(ud.st).toBeUndefined();
    expect(ud.ct).toBeUndefined();
  });
});
