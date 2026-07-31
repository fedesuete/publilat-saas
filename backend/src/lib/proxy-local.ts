// Proxy LOCAL sin auth que reenvía a un upstream (Webshare) CON auth.
// POR QUÉ: WAHA/Chromium (WEBJS) NO manda las credenciales en el CONNECT de HTTPS → falla con
// ERR_TUNNEL_CONNECTION_FAILED contra proxies con usuario/clave. Pero SÍ acepta un proxy local sin
// auth. Este proxy local (proxy-chain) le agrega la auth y reenvía al upstream. Corre en el
// contenedor `app`; WAHA lo alcanza por la red de Docker en `app:<puerto>`.
import { Server } from "proxy-chain";

const LOCAL_HOST = process.env.PROXY_LOCAL_HOST ?? "app"; // nombre del servicio app en la red compose
const PORT_BASE = Number(process.env.PROXY_LOCAL_PORT_BASE ?? 21000);
const PORT_SPAN = 4000;

// upstreamUrl -> puerto local (idempotente: un solo servidor por upstream).
const servers = new Map<string, number>();

// Puerto DETERMINÍSTICO por upstream (hash): así, tras un restart, el mismo proxy vuelve al mismo
// puerto y la config guardada en WAHA sigue apuntando bien (evita cruces de IP entre líneas).
function basePort(upstreamUrl: string): number {
  let h = 0;
  for (let i = 0; i < upstreamUrl.length; i++) h = (h * 31 + upstreamUrl.charCodeAt(i)) | 0;
  return PORT_BASE + (Math.abs(h) % PORT_SPAN);
}

// Asegura un proxy local para el upstream y devuelve { host, port } para que WAHA lo use SIN auth.
// Devuelve null si no se pudo levantar (el caller conecta sin proxy en vez de trabar la línea).
export async function ensureLocalProxy(upstreamUrl: string): Promise<{ host: string; port: number } | null> {
  const cached = servers.get(upstreamUrl);
  if (cached) return { host: LOCAL_HOST, port: cached };
  let port = basePort(upstreamUrl);
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const server = new Server({
        port,
        host: "0.0.0.0", // accesible desde el contenedor WAHA por la red de Docker
        prepareRequestFunction: () => ({ upstreamProxyUrl: upstreamUrl }),
      });
      await server.listen();
      servers.set(upstreamUrl, port);
      return { host: LOCAL_HOST, port };
    } catch (e) {
      if ((e as { code?: string })?.code === "EADDRINUSE") {
        port = PORT_BASE + ((port - PORT_BASE + 1) % PORT_SPAN); // colisión de hash: probar el siguiente
        continue;
      }
      console.error("[proxy-local] no se pudo levantar el proxy local:", e instanceof Error ? e.message : String(e));
      return null;
    }
  }
  return null;
}
