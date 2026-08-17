// Bloques comunes de TODAS las plantillas server-side — una sola fuente de verdad para
// el pixel (PageView, NUNCA Lead browser: el Lead es 100% server-side en el inbound),
// el CTA a /go (el enriquecido eid/fbp/fbc lo agrega injectGoTracking al publicar) y
// el footer legal +18 obligatorio de la categoría casino.
import { esc } from "../landing-template.js";
import type { TplCtx, TplDef } from "./types.js";

export { esc };

export function pixelHead(pixelId: string): string {
  const id = (pixelId || "").replace(/[^0-9]/g, "");
  if (!id) return "";
  return `<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${id}');fbq('track','PageView');</script><noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=${id}&ev=PageView&noscript=1"/></noscript>`;
}

export function goHref(ctx: TplCtx, msg: string): string {
  const line = ctx.line ? `&line=${encodeURIComponent(ctx.line)}` : "";
  return `${ctx.goBase}/go?u=${encodeURIComponent(ctx.userSlug)}&msg=${encodeURIComponent(msg)}${line}`;
}

export function footer18(): string {
  return `<footer style="padding:18px 12px;text-align:center;font-size:12px;color:#8a8f98;line-height:1.5">Solo para mayores de 18 años. El juego compulsivo es perjudicial para la salud.</footer>`;
}

// defaults ⊕ clamp ⊕ esc. Clamp del RAW primero: el límite protege la UI, el esc nunca
// queda partido a mitad de entidad. El color se valida por regex (inválido → default).
export function fill(def: TplDef, values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of def.fields) {
    const raw = (values[f.key] ?? f.default).slice(0, f.max);
    out[f.key] = f.type === "color" ? (/^#[0-9a-fA-F]{6}$/.test(raw) ? raw : f.default) : esc(raw);
  }
  return out;
}
