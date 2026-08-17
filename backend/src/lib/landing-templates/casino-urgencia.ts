// Urgencia: barra fija de cupos, cupón con borde punteado y CTA caliente.
import type { TplDef } from "./types.js";
import { pixelHead, goHref, footer18 } from "./shared.js";

export const casinoUrgencia: TplDef = {
  id: "casino-urgencia",
  name: "Oferta con urgencia",
  desc: "Barra de cupos limitados + cupón recortable. Para promos por tiempo limitado.",
  category: "casino",
  fields: [
    { key: "brand", label: "Marca", type: "text", max: 40, required: true, default: "TU CASINO" },
    { key: "headline", label: "Título", type: "text", max: 90, required: true, default: "Solo por hoy: tu carga vale doble" },
    { key: "offer", label: "Bono / oferta", type: "text", max: 80, default: "100% extra en tu primera carga" },
    { key: "buttonText", label: "Texto del botón", type: "text", max: 30, default: "QUIERO MI CUPO" },
    { key: "msg", label: "Mensaje de WhatsApp", type: "textarea", max: 200, default: "Hola! Quiero el cupo de hoy" },
    { key: "accent", label: "Color del botón", type: "color", max: 7, default: "#ef4444" },
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
*{box-sizing:border-box}body{margin:0;font-family:system-ui,'Segoe UI',Roboto,Arial,sans-serif;background:#120606;background-image:radial-gradient(circle at 50% 0%,#3a0a0a,transparent 70%);color:#fff;min-height:100vh;display:flex;flex-direction:column}
.bar{position:sticky;top:0;background:${v.accent};color:#fff;font-weight:800;font-size:13px;letter-spacing:1px;text-align:center;padding:9px 12px;text-transform:uppercase}
.wrap{flex:1;display:flex;align-items:center;justify-content:center;padding:28px 18px}
.c{max-width:460px;width:100%;text-align:center}
.brand{font-size:13px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:#f19999;margin-bottom:14px}
h1{font-size:clamp(26px,7vw,36px);line-height:1.15;margin:0 0 20px;font-weight:900}
.cupon{border:2px dashed #f1999966;border-radius:14px;padding:16px 14px;margin-bottom:24px;background:#1a0a0a}
.cupon .k{font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#f19999}
.cupon .o{font-size:21px;font-weight:900;margin-top:6px;color:#ffd7a1}
.btn{display:block;text-decoration:none;border-radius:14px;padding:18px;font-size:19px;font-weight:900;color:#fff;background:linear-gradient(90deg,${v.accent},#f97316);box-shadow:0 14px 40px -12px ${v.accent}aa}
.btn:active{transform:scale(.99)}
.hint{margin-top:14px;font-size:13px;color:#e7b3b3}
</style>
</head>
<body>
<div class="bar">⚡ Cupos limitados por hoy</div>
<div class="wrap"><div class="c">
  <div class="brand">${v.brand}</div>
  <h1>${v.headline}</h1>
  <div class="cupon"><div class="k">Cupón de hoy</div><div class="o">🎟️ ${v.offer}</div></div>
  <a class="btn" href="${goHref(ctx, v.msg)}">${v.buttonText}</a>
  <div class="hint">🔥 Quedan pocos cupos de esta hora — escribinos y te lo reservamos.</div>
</div></div>
${footer18()}
</body>
</html>`;
  },
};
