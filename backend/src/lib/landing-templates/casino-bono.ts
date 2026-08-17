// Port parametrizado de la landing RED GANAMOS (la que corre en la publicidad real):
// héroe + badge de bono + trust-row + popup de atención inmediata.
import type { TplDef } from "./types.js";
import { pixelHead, goHref, footer18 } from "./shared.js";

export const casinoBono: TplDef = {
  id: "casino-bono",
  name: "Bono de bienvenida",
  desc: "La estructura que más convierte: héroe con bono destacado, sellos de confianza y popup de atención.",
  category: "casino",
  fields: [
    { key: "brand", label: "Marca", type: "text", max: 40, required: true, default: "RED GANAMOS" },
    { key: "headline", label: "Título", type: "text", max: 90, required: true, default: "Duplicá tu PRIMERA CARGA" },
    { key: "offer", label: "Bono / oferta", type: "text", max: 80, default: "Bono del 50% activo" },
    { key: "buttonText", label: "Texto del botón", type: "text", max: 30, default: "CARGAR AHORA" },
    { key: "msg", label: "Mensaje de WhatsApp", type: "textarea", max: 200, default: "Hola! Quiero activar mi bono" },
    { key: "accent", label: "Color del botón", type: "color", max: 7, default: "#25d366" },
  ],
  render(ctx) {
    const v = ctx.values;
    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${v.brand}</title>
${pixelHead(ctx.pixelId)}
<style>
*{box-sizing:border-box}body{margin:0;font-family:system-ui,'Segoe UI',Roboto,Arial,sans-serif;background:radial-gradient(circle at 50% -10%,#14231b,#0a1210 60%,#070d0b);color:#e9edef;min-height:100vh;display:flex;flex-direction:column}
.wrap{flex:1;display:flex;align-items:center;justify-content:center;padding:28px 18px}
.hero{max-width:460px;width:100%;text-align:center}
.brand{font-size:15px;font-weight:800;letter-spacing:3px;text-transform:uppercase;color:#d4af37;margin-bottom:18px}
h1{font-size:clamp(28px,7vw,38px);line-height:1.15;margin:0 0 14px;font-weight:900}
.badge{display:inline-block;background:linear-gradient(90deg,#f5d271,#d4af37);color:#1a1407;font-weight:800;font-size:15px;padding:9px 18px;border-radius:999px;margin-bottom:26px}
.btn{display:block;text-decoration:none;border-radius:999px;padding:18px;font-size:19px;font-weight:900;background:${v.accent};color:#062015;box-shadow:0 14px 40px -12px ${v.accent}aa}
.btn:active{transform:scale(.99)}
.trust{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:22px}
.trust span{background:#101d17;border:1px solid #1e3229;border-radius:10px;padding:9px 12px;font-size:13px;color:#bcd6c9}
.pop{position:fixed;left:12px;right:12px;bottom:14px;display:flex;gap:12px;align-items:center;background:#101d17ee;border:1px solid #1e3229;border-radius:14px;padding:12px 14px;backdrop-filter:blur(6px)}
.pop .i{font-size:24px}.pop h4{margin:0;font-size:14px}.pop p{margin:2px 0 0;font-size:12px;color:#8fa89c}.pop b{color:#f5d271}
@media(min-width:640px){.pop{left:auto;right:22px;max-width:320px}}
</style>
</head>
<body>
<div class="wrap"><div class="hero">
  <div class="brand">${v.brand}</div>
  <h1>${v.headline}</h1>
  <div class="badge">🎁 ${v.offer}</div>
  <a class="btn" href="${goHref(ctx, v.msg)}">💬 ${v.buttonText}</a>
  <div class="trust"><span>⚡ Cargas al instante</span><span>💸 Retiros 24/7</span><span>🔒 100% seguro</span></div>
</div></div>
<div class="pop"><div class="i">⚡</div><div><h4>Atención inmediata</h4><p>Cargas acreditadas en <b>menos de 2 minutos</b></p></div></div>
${footer18()}
</body>
</html>`;
  },
};
