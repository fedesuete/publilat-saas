// Protección anti-SSRF para webhooks salientes a URLs que define el usuario.
// Bloquea destinos internos (loopback, redes privadas, link-local, metadata cloud).
import dns from "node:dns/promises";
import net from "node:net";

function ipv4IsPrivate(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true; // raro -> bloquear
  const [a, b] = p;
  if (a === 0 || a === 10 || a === 127) return true; // this-host / 10/8 / loopback
  if (a === 169 && b === 254) return true; // link-local + metadata cloud (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a >= 224) return true; // multicast / reservado
  return false;
}

function ipIsPrivate(ip: string): boolean {
  const fam = net.isIP(ip);
  if (fam === 4) return ipv4IsPrivate(ip);
  if (fam === 6) {
    const low = ip.toLowerCase();
    if (low === "::1" || low === "::") return true; // loopback / unspecified
    if (low.startsWith("fe80") || low.startsWith("fc") || low.startsWith("fd")) return true; // link-local / ULA
    const mapped = low.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped
    if (mapped) return ipv4IsPrivate(mapped[1]);
    return false;
  }
  return true; // no es una IP -> bloquear
}

// Lanza si la URL no es pública (protocolo inválido, host interno, o resuelve a IP privada).
export async function assertPublicUrl(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("URL de webhook inválida");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("El webhook debe usar http(s)");
  }
  const host = url.hostname.replace(/^\[|\]$/g, ""); // saca corchetes de IPv6 literal
  if (!host || host.toLowerCase() === "localhost") {
    throw new Error("Destino de webhook no permitido");
  }

  // Resuelve TODAS las IPs del host y verifica que ninguna sea interna.
  let addresses: string[];
  if (net.isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = (await dns.lookup(host, { all: true })).map((a) => a.address);
    } catch {
      throw new Error("No se pudo resolver el host del webhook");
    }
  }
  if (addresses.length === 0 || addresses.some((ip) => ipIsPrivate(ip))) {
    throw new Error("El webhook apunta a una dirección interna/no permitida");
  }
}
