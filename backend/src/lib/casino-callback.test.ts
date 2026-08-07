import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { verifyPartnerSignature, isCallbackTimestampFresh } from "./casino-callback.js";

const SECRET = "test-secret-abc123";
const TS = "2026-08-06T22:00:00.000Z";
const BODY = JSON.stringify({ status: "credited", referencia: "dep-abc", intentId: "int_1", monto: 15000 });
const sign = (secret: string, ts: string, body: string) =>
  crypto.createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");

describe("verifyPartnerSignature", () => {
  it("acepta una firma válida (sobre timestamp.body)", () => {
    expect(verifyPartnerSignature(SECRET, TS, sign(SECRET, TS, BODY), BODY)).toBe(true);
  });
  it("acepta el body como Buffer (req.rawBody)", () => {
    expect(verifyPartnerSignature(SECRET, TS, sign(SECRET, TS, BODY), Buffer.from(BODY, "utf8"))).toBe(true);
  });
  it("rechaza si firmaron SOLO el body (sin el timestamp adelante)", () => {
    const soloBody = crypto.createHmac("sha256", SECRET).update(BODY).digest("hex");
    expect(verifyPartnerSignature(SECRET, TS, soloBody, BODY)).toBe(false);
  });
  it("rechaza body adulterado", () => {
    const sig = sign(SECRET, TS, BODY);
    const tampered = BODY.replace("15000", "150000");
    expect(verifyPartnerSignature(SECRET, TS, sig, tampered)).toBe(false);
  });
  it("rechaza secreto incorrecto", () => {
    expect(verifyPartnerSignature("otro-secreto", TS, sign(SECRET, TS, BODY), BODY)).toBe(false);
  });
  it("rechaza timestamp distinto (replay con otra fecha)", () => {
    expect(verifyPartnerSignature(SECRET, "2026-08-06T23:00:00.000Z", sign(SECRET, TS, BODY), BODY)).toBe(false);
  });
  it("rechaza faltantes o firma no-hex", () => {
    expect(verifyPartnerSignature(SECRET, TS, undefined, BODY)).toBe(false);
    expect(verifyPartnerSignature(SECRET, undefined, sign(SECRET, TS, BODY), BODY)).toBe(false);
    expect(verifyPartnerSignature("", TS, sign(SECRET, TS, BODY), BODY)).toBe(false);
    expect(verifyPartnerSignature(SECRET, TS, "no-es-hex", BODY)).toBe(false);
  });
});

describe("isCallbackTimestampFresh", () => {
  const now = Date.parse("2026-08-06T22:00:00.000Z");
  it("acepta un timestamp reciente", () => {
    expect(isCallbackTimestampFresh("2026-08-06T21:58:00.000Z", 15 * 60 * 1000, now)).toBe(true);
  });
  it("rechaza un timestamp viejo (replay)", () => {
    expect(isCallbackTimestampFresh("2026-08-06T21:00:00.000Z", 15 * 60 * 1000, now)).toBe(false);
  });
  it("rechaza timestamp inválido o faltante", () => {
    expect(isCallbackTimestampFresh("no-es-fecha", 15 * 60 * 1000, now)).toBe(false);
    expect(isCallbackTimestampFresh(undefined, 15 * 60 * 1000, now)).toBe(false);
  });
});
