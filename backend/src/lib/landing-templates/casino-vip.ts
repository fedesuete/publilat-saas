// VIP: black premium con borde dorado y chips de beneficios.
import type { TplDef } from "./types.js";
import { pixelHead, goHref, footer18 } from "./shared.js";

export const casinoVip: TplDef = {
  id: "casino-vip",
  name: "Club VIP",
  desc: "Estética black/dorado premium con beneficios en chips. Para marcas 'exclusivas'.",
  category: "casino",
  fields: [
    { key: "brand", label: "Marca", type: "text", max: 40, required: true, default: "CLUB VIP" },
    { key: "headline", label: "Título", type: "text", max: 90, required: true, default: "Jugá como VIP desde tu primera carga" },
    { key: "offer", label: "Beneficio estrella", type: "text", max: 80, default: "Bonos exclusivos todas las semanas" },
    { key: "buttonText", label: "Texto del botón", type: "text", max: 30, default: "QUIERO SER VIP" },
    { key: "msg", label: "Mensaje de WhatsApp", type: "textarea", max: 200, default: "Hola! Quiero mi acceso VIP" },
    { key: "accent", label: "Color dorado", type: "color", max: 7, default: "#d4af37" },
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
*{box-sizing:border-box}body{margin:0;font-family:system-ui,'Segoe UI',Roboto,Arial,sans-serif;background:#070707;background-image:radial-gradient(circle at 50% -20%,#1c1608,transparent 60%);color:#fff;min-height:100vh;display:flex;flex-direction:column}
.wrap{flex:1;display:flex;align-items:center;justify-content:center;padding:28px 18px}
.card{max-width:460px;width:100%;text-align:center;background:linear-gradient(180deg,#121007,#0b0a05);border:1px solid ${v.accent}55;border-radius:20px;padding:42px 26px;box-shadow:0 28px 70px -30px #000}
.k{display:inline-block;padding:6px 16px;border:1px solid ${v.accent}88;border-radius:999px;color:${v.accent};font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:700}
.brand{margin-top:16px;font-size:14px;font-weight:800;letter-spacing:3px;text-transform:uppercase;color:#cbba88}
h1{font-size:clamp(25px,6.5vw,32px);line-height:1.2;margin:14px 0 18px;font-weight:900}
.chips{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-bottom:22px}
.chips span{background:#141207;border:1px solid ${v.accent}33;border-radius:10px;padding:9px 12px;font-size:13px;color:#e8dcb8}
.btn{display:block;text-decoration:none;border-radius:999px;padding:18px;font-size:18px;font-weight:900;color:#1a1407;background:linear-gradient(90deg,#f5d271,${v.accent});box-shadow:0 14px 40px -12px ${v.accent}aa}
.btn:active{transform:scale(.99)}
</style>
</head>
<body>
<div class="wrap"><div class="card">
  <span class="k">★ Acceso VIP</span>
  <div class="brand">${v.brand}</div>
  <h1>${v.headline}</h1>
  <div class="chips"><span>👑 ${v.offer}</span><span>⭐ Atención prioritaria</span><span>💸 Retiros sin espera</span></div>
  <a class="btn" href="${goHref(ctx, v.msg)}">${v.buttonText}</a>
</div></div>
${footer18()}
</body>
</html>`;
  },
};
