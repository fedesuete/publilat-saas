// Pixel de MARKETING de Publi.lat (embudo de venta propio). Se carga SOLO en /login y /register:
// el resto del panel es de los clientes operando su cuenta y no debe pegarle a nuestro pixel.
// El id viene del backend (/api/public/config) para no hornearlo en el build.
import { api } from "./api";

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    _fbq?: unknown;
  }
}

const FBCLID_KEY = "pl_fbclid";
let loading: Promise<string | null> | null = null;

export function readCookie(name: string): string | null {
  try {
    const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

// Guarda el fbclid de la URL (sobrevive al toggle Ingresar/Crear cuenta y a redirects internos).
export function rememberFbclid(search: string): void {
  try {
    const v = new URLSearchParams(search).get("fbclid");
    if (v) sessionStorage.setItem(FBCLID_KEY, v);
  } catch {
    /* sin storage: seguimos sin fbclid */
  }
}

export function mktClickIds(): { fbp?: string; fbc?: string; fbclid?: string } {
  let fbclid: string | null = null;
  try {
    fbclid = sessionStorage.getItem(FBCLID_KEY);
  } catch {
    fbclid = null;
  }
  const out: { fbp?: string; fbc?: string; fbclid?: string } = {};
  const fbp = readCookie("_fbp");
  const fbc = readCookie("_fbc");
  if (fbp) out.fbp = fbp;
  if (fbc) out.fbc = fbc;
  if (fbclid) out.fbclid = fbclid;
  return out;
}

function injectFbq(id: string): void {
  if (window.fbq) {
    window.fbq("init", id);
    window.fbq("track", "PageView");
    return;
  }
  const n = function (...args: unknown[]) {
    const q = n as unknown as { callMethod?: (...a: unknown[]) => void; queue: unknown[][] };
    if (q.callMethod) q.callMethod(...args);
    else q.queue.push(args);
  } as unknown as { (...args: unknown[]): void; queue: unknown[][]; loaded: boolean; version: string; push: unknown };
  n.queue = [];
  n.loaded = true;
  n.version = "2.0";
  n.push = n;
  window.fbq = n;
  window._fbq = n;
  const s = document.createElement("script");
  s.async = true;
  s.src = "https://connect.facebook.net/en_US/fbevents.js";
  document.head.appendChild(s);
  window.fbq("init", id);
  window.fbq("track", "PageView");
}

// Carga el pixel (una sola vez por sesión de página). Devuelve el id o null si no hay pixel configurado.
export function loadMktPixel(): Promise<string | null> {
  if (loading) return loading;
  loading = api
    .get<{ mktPixelId: string | null }>("/api/public/config")
    .then(({ data }) => {
      const id = data?.mktPixelId ?? null;
      if (id) injectFbq(id);
      return id;
    })
    .catch(() => null);
  return loading;
}

// CompleteRegistration del navegador con eventID = el mismo que manda el backend por CAPI (dedup).
export function trackMktRegistration(eventId: string): void {
  try {
    window.fbq?.("track", "CompleteRegistration", {}, { eventID: eventId });
  } catch {
    /* best-effort */
  }
}

export function newEventId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}
