// Mínima: un claim, un botón. Carga instantánea, cero distracción.
import type { TplDef } from "./types.js";
import { pixelHead, goHref, footer18 } from "./shared.js";

export const casinoSimple: TplDef = {
  id: "casino-simple",
  name: "Directa",
  desc: "Un solo mensaje y el botón. La más rápida de cargar, ideal para tráfico frío.",
  category: "casino",
  fields: [
    { key: "brand", label: "Marca", type: "text", max: 40, required: true, default: "TU CASINO" },
    { key: "headline", label: "Título", type: "text", max: 90, required: true, default: "Cargá y jugá en 2 minutos" },
    { key: "offer", label: "Subtítulo", type: "text", max: 80, default: "Atención por WhatsApp las 24 hs" },
    { key: "buttonText", label: "Texto del botón", type: "text", max: 30, default: "EMPEZAR AHORA" },
    { key: "msg", label: "Mensaje de WhatsApp", type: "textarea", max: 200, default: "Hola! Quiero empezar" },
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
*{box-sizing:border-box}body{margin:0;font-family:system-ui,'Segoe UI',Roboto,Arial,sans-serif;background:#0b141a;color:#e9edef;min-height:100vh;display:flex;flex-direction:column}
.wrap{flex:1;display:flex;align-items:center;justify-content:center;padding:28px 18px}
.card{max-width:440px;width:100%;text-align:center;padding:44px 28px;background:#111b21;border:1px solid #222d34;border-radius:16px}
.brand{font-size:13px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:#8696a0;margin-bottom:14px}
h1{font-size:clamp(24px,6.5vw,30px);margin:0 0 10px;font-weight:800}
p{color:${v.accent};margin:0 0 28px;line-height:1.55;font-weight:600}
.btn{display:block;text-decoration:none;border-radius:999px;padding:17px;font-size:18px;font-weight:800;background:${v.accent};color:#03301a}
.btn:active{transform:scale(.99)}
</style>
</head>
<body>
<div class="wrap"><div class="card">
  <div class="brand">${v.brand}</div>
  <h1>${v.headline}</h1>
  <p>${v.offer}</p>
  <a class="btn" href="${goHref(ctx, v.msg)}">💬 ${v.buttonText}</a>
</div></div>
${footer18()}
</body>
</html>`;
  },
};
