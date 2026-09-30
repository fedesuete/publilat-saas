import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import express from "express";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// La cuenta de Pagopar la comparten Publi.lat y smartrun.lat (fotos de carreras). Lo que se prueba: que el aviso y la
// vuelta de un pedido AJENO vayan a su sitio, y que los de Publi.lat sigan exactamente igual que antes.
process.env.PAGOPAR_PUBLIC_KEY = "pub-test";
process.env.PAGOPAR_PRIVATE_KEY = "priv-test";

const prismaMock = vi.hoisted(() => ({
  payment: { findFirst: vi.fn(), updateMany: vi.fn() },
}));
vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));
const approveMock = vi.hoisted(() => ({ approvePayment: vi.fn(async () => undefined), ensureCredit: vi.fn() }));
vi.mock("../lib/billing-approve.js", () => approveMock);

const { pagoparWebhookRouter, pagoparReturnRedirect } = await import("./billing.js");

const AJENO = "a".repeat(64);
const PROPIO = "b".repeat(64);
const token = (hash: string) => createHash("sha1").update("priv-test" + hash).digest("hex");
const aviso = (hash: string) => ({ respuesta: true, resultado: [{ hash_pedido: hash, token: token(hash), pagado: true, cancelado: false, monto: "20000.00" }] });

let server: Server;
let base = "";
const realFetch = globalThis.fetch;
const forwarded: { url: string; body: unknown }[] = [];

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/billing/webhook/pagopar", pagoparWebhookRouter);
  app.get("/billing", pagoparReturnRedirect);
  app.get("/billing", (_req, res) => res.send("panel")); // el SPA de siempre
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // Pagopar (consulta del pedido) y el sitio de reenvío se simulan; los pedidos a este server de prueba van de verdad.
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith(base)) return realFetch(input, init);
    if (url.includes("api.pagopar.com")) {
      const hash = JSON.parse(String(init?.body)).hash_pedido;
      return new Response(JSON.stringify({ respuesta: true, resultado: [{ hash_pedido: hash, pagado: true, cancelado: false }] }));
    }
    forwarded.push({ url, body: JSON.parse(String(init?.body)) });
    return new Response("[]", { status: 200 });
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
  server.close();
});
beforeEach(() => {
  forwarded.length = 0;
  process.env.PAGOPAR_REENVIO_URL = "https://smartrun.lat/";
  prismaMock.payment.findFirst.mockReset().mockImplementation(async ({ where }: { where: { externalId: string } }) =>
    where.externalId === PROPIO ? { id: "pay1", status: "pending" } : null);
  approveMock.approvePayment.mockClear();
});

const postAviso = (hash: string) =>
  fetch(`${base}/api/billing/webhook/pagopar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(aviso(hash)) });

describe("aviso de pago de Pagopar", () => {
  it("de un pedido ajeno: se reenvía tal cual al otro sitio y a Pagopar se le responde el eco igual", async () => {
    const res = await postAviso(AJENO);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(aviso(AJENO).resultado);
    expect(forwarded).toEqual([{ url: "https://smartrun.lat/api/pagopar/webhook", body: aviso(AJENO) }]);
    expect(approveMock.approvePayment).not.toHaveBeenCalled();
  });

  it("de un pedido de Publi.lat: se acredita como siempre y no se reenvía", async () => {
    await postAviso(PROPIO);
    expect(approveMock.approvePayment).toHaveBeenCalledWith("pay1", "Pagopar");
    expect(forwarded).toEqual([]);
  });

  it("sin PAGOPAR_REENVIO_URL (o con una que no es https): como antes, no se reenvía nada", async () => {
    for (const v of ["", "http://smartrun.lat", "javascript:alert(1)"]) {
      process.env.PAGOPAR_REENVIO_URL = v;
      expect((await postAviso(AJENO)).status).toBe(200);
    }
    expect(forwarded).toEqual([]);
  });

  it("un aviso con token falso no se reenvía", async () => {
    const falso = aviso(AJENO);
    falso.resultado[0].token = "x".repeat(40);
    const res = await fetch(`${base}/api/billing/webhook/pagopar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(falso) });
    expect(res.status).toBe(400);
    expect(forwarded).toEqual([]);
  });
});

describe("vuelta del comprador (/billing?pagopar=<hash>)", () => {
  const vuelta = (q: string) => fetch(`${base}/billing${q}`, { redirect: "manual" });

  it("pedido ajeno: a la página de su pedido en el otro sitio", async () => {
    const res = await vuelta(`?pagopar=${AJENO}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`https://smartrun.lat/pedido/${AJENO}`);
  });

  it("pedido de Publi.lat, sin hash, hash raro o sin reenvío configurado: el panel de siempre", async () => {
    for (const q of [`?pagopar=${PROPIO}`, "", "?pagopar=../../evil", "?pagopar=https://evil.com"]) {
      const res = await vuelta(q);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("panel");
    }
    process.env.PAGOPAR_REENVIO_URL = "";
    expect(await (await vuelta(`?pagopar=${AJENO}`)).text()).toBe("panel");
  });
});
