import { describe, it, expect, vi } from "vitest";
import crypto from "node:crypto";
import axios from "axios";

vi.mock("axios", () => ({
  default: { post: vi.fn(async () => ({ data: { events_received: 1 } })), isAxiosError: () => false },
}));
vi.mock("./pixel.js", () => ({ resolveShadowPixels: vi.fn(async () => []) }));

import { sendCapiEvent } from "./meta-capi.js";

const sha = (v: string) => crypto.createHash("sha256").update(v.trim().toLowerCase()).digest("hex");
const lastUserData = () => {
  const body = (axios.post as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1] as {
    data: Array<{ user_data: Record<string, string> }>;
  };
  return body.data[0].user_data;
};

describe("sendCapiEvent email", () => {
  it("manda em hasheado (normalizado) cuando viene email", async () => {
    await sendCapiEvent({ eventName: "Purchase", externalId: "u1", email: " Cli@X.com ", pixelId: "p", capiToken: "t", value: 10, currency: "PYG" });
    expect(lastUserData().em).toBe(sha("cli@x.com"));
  });
  it("sin email no manda em", async () => {
    await sendCapiEvent({ eventName: "Lead", externalId: "u1", pixelId: "p", capiToken: "t" });
    expect(lastUserData().em).toBeUndefined();
  });
});
