import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { cloudflareRealIp, isCloudflareIp, trustProxyDetrasDeCloudflare } from "./cloudflare-ip.js";

// Simula lo que llega a la app DESPUÉS de Traefik: Traefik siempre agrega la IP del que le habló al
// FINAL de X-Forwarded-For. Acá el socket es 127.0.0.1 (salto 0 = "Traefik") y X-Forwarded-For se
// arma a mano con lo que Traefik habría dejado.
let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.set("trust proxy", trustProxyDetrasDeCloudflare);
  app.use(cloudflareRealIp);
  app.get("/ip", (req, res) => res.json({ ip: req.ip, xff: req.headers["x-forwarded-for"] ?? null }));
  await new Promise<void>((ok) => { server = app.listen(0, "127.0.0.1", ok); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((ok) => server.close(() => ok())));

async function ip(headers: Record<string, string>): Promise<{ ip: string; xff: string | null }> {
  const r = await fetch(`${base}/ip`, { headers });
  return (await r.json()) as { ip: string; xff: string | null };
}

describe("isCloudflareIp", () => {
  it("reconoce los rangos de Cloudflare (v4, v6 y v4 mapeada en v6)", () => {
    expect(isCloudflareIp("104.16.1.1")).toBe(true);
    expect(isCloudflareIp("172.64.0.9")).toBe(true);
    expect(isCloudflareIp("2606:4700::1")).toBe(true);
    expect(isCloudflareIp("::ffff:104.16.1.1")).toBe(true);
  });
  it("rechaza lo que no es Cloudflare", () => {
    expect(isCloudflareIp("187.77.33.164")).toBe(false); // el VPS
    expect(isCloudflareIp("8.8.8.8")).toBe(false);
    expect(isCloudflareIp("2001:db8::1")).toBe(false);
    expect(isCloudflareIp("")).toBe(false);
    expect(isCloudflareIp("no-es-ip")).toBe(false);
    expect(isCloudflareIp(undefined)).toBe(false);
  });
});

describe("IP real del visitante", () => {
  it("sin proxy adelante (dev): la IP del socket", async () => {
    expect((await ip({})).ip).toBe("127.0.0.1");
  });

  it("nube GRIS (hoy): visitante directo a Traefik → su IP", async () => {
    expect((await ip({ "x-forwarded-for": "203.0.113.5" })).ip).toBe("203.0.113.5");
  });

  it("nube NARANJA: visitante → Cloudflare → Traefik → la IP real, no la del borde", async () => {
    const r = await ip({ "x-forwarded-for": "203.0.113.5, 104.16.1.1", "cf-connecting-ip": "203.0.113.5" });
    expect(r.ip).toBe("203.0.113.5");
  });

  it("si Traefik pisara X-Forwarded-For (modo seguro), la recupera de CF-Connecting-IP", async () => {
    const r = await ip({ "x-forwarded-for": "104.16.1.1", "cf-connecting-ip": "203.0.113.5" });
    expect(r.ip).toBe("203.0.113.5");
    expect(r.xff).toBe("203.0.113.5, 104.16.1.1");
  });

  it("el visitante manda su propio X-Forwarded-For trucho a través de Cloudflare: gana CF-Connecting-IP", async () => {
    // Cloudflare AGREGA la IP real detrás de lo que mandó el cliente; Traefik agrega el borde.
    const r = await ip({ "x-forwarded-for": "6.6.6.6, 203.0.113.5, 104.16.1.1", "cf-connecting-ip": "203.0.113.5" });
    expect(r.ip).toBe("203.0.113.5");
    // Y la PRIMERA entrada (la que lee chatAttribution) también es la real, no la trucha.
    expect(r.xff?.split(",")[0].trim()).toBe("203.0.113.5");
  });

  it("FALSIFICACIÓN: alguien le pega al VPS directo con CF-Connecting-IP inventada → se ignora", async () => {
    // Traefik dejó la IP real del atacante (198.51.100.7) al final; no es de Cloudflare.
    const r = await ip({ "x-forwarded-for": "1.2.3.4, 198.51.100.7", "cf-connecting-ip": "9.9.9.9" });
    expect(r.ip).toBe("198.51.100.7");
  });

  it("FALSIFICACIÓN con una IP de Cloudflare metida en el medio → sigue ganando la IP real", async () => {
    const r = await ip({ "x-forwarded-for": "9.9.9.9, 104.16.1.1, 198.51.100.7", "cf-connecting-ip": "9.9.9.9" });
    expect(r.ip).toBe("198.51.100.7");
  });

  it("CF-Connecting-IP con basura no rompe nada", async () => {
    const r = await ip({ "x-forwarded-for": "203.0.113.5, 104.16.1.1", "cf-connecting-ip": "<script>" });
    expect(r.ip).toBe("203.0.113.5");
  });

  it("IPv6: borde de Cloudflare v6 y visitante v6", async () => {
    const r = await ip({ "x-forwarded-for": "2001:db8::1, 2606:4700::1", "cf-connecting-ip": "2001:db8::1" });
    expect(r.ip).toBe("2001:db8::1");
  });

  it("borde de Cloudflare como IPv4 mapeada en IPv6 (sockets dual-stack)", async () => {
    const r = await ip({ "x-forwarded-for": "::ffff:104.16.1.1", "cf-connecting-ip": "203.0.113.9" });
    expect(r.ip).toBe("203.0.113.9");
  });
});
