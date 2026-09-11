// Dónde vive la aplicación (panel). Los CTA de la landing apuntan acá.
export const APP_URL = "https://app.publi.lat";

// Propaga al panel los parámetros del clic del anuncio (fbclid + utm_*) que Meta le pega a la URL de
// esta landing. Así app.publi.lat/register recibe el fbclid y el alta queda atribuida al anuncio.
// Las cookies _fbp/_fbc del pixel viajan solas (dominio .publi.lat); esto cubre el caso sin cookie.
export function withClickParams(url: string, search: string = typeof window !== "undefined" ? window.location.search : ""): string {
  try {
    const src = new URLSearchParams(search);
    const out = new URL(url);
    src.forEach((v, k) => {
      if (k === "fbclid" || k.startsWith("utm_")) out.searchParams.set(k, v);
    });
    return out.toString();
  } catch {
    return url;
  }
}

export const LOGIN_URL = withClickParams(`${APP_URL}/login`);
export const REGISTER_URL = withClickParams(`${APP_URL}/register`);
// WhatsApp de ventas/demos (botón flotante + CTA "Pedí una demo").
export const WHATSAPP_URL = "https://wa.me/5491176202256?text=Hola!%20Quiero%20una%20demo%20de%20Publi.lat";
export const PRICE_PER_DAY_USD = 2;
