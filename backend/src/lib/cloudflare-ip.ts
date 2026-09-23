// IP real del visitante cuando app.publi.lat / chat.publi.lat pasan por Cloudflare (nube naranja).
//
// Cadena: visitante → Cloudflare → Traefik (EasyPanel) → esta app. Sin esto, `req.ip` sería la IP
// del borde de Cloudflare para TODO el mundo y se rompen dos cosas graves:
//   1) los rate limits (todos los usuarios comparten un solo cupo → 429 para todos en minutos);
//   2) el `client_ip_address` que mandamos a Meta en Lead/Purchase (cae el Event Match Quality).
//
// Cloudflare manda la IP real en `CF-Connecting-IP`. Pero esa cabecera la puede escribir cualquiera
// que le pegue al VPS directo (saltándose Cloudflare), así que SOLO se la creemos cuando el que nos
// habla es de verdad una IP de Cloudflare. Traefik siempre agrega la IP del que le habló al FINAL de
// X-Forwarded-For (esté en modo insecure o no), y esa última entrada es lo único no falsificable.
//
// No depende del Traefik de EasyPanel ni de su config: se resuelve acá y funciona igual con la nube
// gris (sin Cloudflare no hay CF-Connecting-IP → no cambia nada).
import net from "node:net";
import type { NextFunction, Request, Response } from "express";

// Rangos oficiales: https://www.cloudflare.com/ips-v4 y /ips-v6 (2026-09-23). Cambian muy rara vez.
export const CLOUDFLARE_RANGES: readonly string[] = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18",
  "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17",
  "162.158.0.0/15", "104.16.0.0/13", "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
  "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32",
  "2a06:98c0::/29", "2c0f:f248::/32",
];

type Parsed = { bits: 32 | 128; n: bigint };

// IPv4 o IPv6 → entero. Una IPv6 "mapeada" (::ffff:1.2.3.4, así llega IPv4 en sockets dual-stack)
// se trata como la IPv4 que envuelve.
function parseIp(raw: string): Parsed | null {
  const ip = raw.trim();
  const kind = net.isIP(ip);
  if (kind === 4) return { bits: 32, n: v4ToInt(ip) };
  if (kind !== 6) return null;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return { bits: 32, n: v4ToInt(mapped[1]) };
  return { bits: 128, n: v6ToInt(ip) };
}

function v4ToInt(ip: string): bigint {
  return ip.split(".").reduce((acc, o) => (acc << 8n) + BigInt(Number(o)), 0n);
}

function v6ToInt(ip: string): bigint {
  // Expandir "::" a los grupos que falten para llegar a 8.
  const [head, tail = ""] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const faltan = 8 - h.length - t.length;
  const grupos = [...h, ...Array<string>(Math.max(0, faltan)).fill("0"), ...t];
  return grupos.reduce((acc, g) => (acc << 16n) + BigInt(parseInt(g || "0", 16)), 0n);
}

const REDES = CLOUDFLARE_RANGES.map((cidr) => {
  const [base, len] = cidr.split("/");
  const p = parseIp(base)!;
  return { bits: p.bits, prefix: Number(len), n: p.n };
});

export function isCloudflareIp(raw: string | undefined | null): boolean {
  if (!raw) return false;
  const ip = parseIp(raw);
  if (!ip) return false;
  return REDES.some((r) => r.bits === ip.bits && (ip.n >> BigInt(r.bits - r.prefix)) === (r.n >> BigInt(r.bits - r.prefix)));
}

function header(req: Request, name: string): string {
  const v = req.headers[name];
  return typeof v === "string" ? v : Array.isArray(v) ? v[0] ?? "" : "";
}

/**
 * Middleware: si el que nos habla es Cloudflare, reescribe X-Forwarded-For como
 * "<CF-Connecting-IP>, <borde de Cloudflare>", así `req.ip` (con el trust de abajo) y cualquier
 * código que lea la PRIMERA entrada de X-Forwarded-For ven la IP real del visitante.
 * Va ANTES de cualquier rate limit o ruta. Sin Cloudflare no toca nada.
 */
export function cloudflareRealIp(req: Request, _res: Response, next: NextFunction): void {
  const cf = header(req, "cf-connecting-ip").trim();
  if (cf && net.isIP(cf)) {
    const xff = header(req, "x-forwarded-for");
    // La ÚLTIMA entrada la agregó Traefik = quien le habló de verdad. Sin proxy adelante (dev), el socket.
    const peer = (xff ? xff.split(",").pop()!.trim() : "") || req.socket.remoteAddress || "";
    if (isCloudflareIp(peer)) req.headers["x-forwarded-for"] = `${cf}, ${peer}`;
  }
  next();
}

/**
 * Función para `app.set("trust proxy", …)`: confía en el salto 0 (Traefik, que nos habla por el
 * socket) y en cualquier IP de Cloudflare. Así `req.ip` es el primer salto NO confiable: el
 * visitante real, venga directo o a través de Cloudflare. Una cabecera falsificada por alguien
 * que le pega al VPS de frente queda detrás de su propia IP (no es de Cloudflare) y se ignora.
 */
export function trustProxyDetrasDeCloudflare(addr: string, hop: number): boolean {
  return hop === 0 || isCloudflareIp(addr);
}
