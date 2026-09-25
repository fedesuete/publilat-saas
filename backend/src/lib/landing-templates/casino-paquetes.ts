// Paquetes de créditos: se muestran los paquetes con su precio y abajo van los DOS botones de
// contacto (WhatsApp y Telegram). El visitante mira la lista, elige mentalmente y escribe.
//
// El botón de WhatsApp sale por /go, así que el Lead y la atribución funcionan como en el resto.
// El de Telegram es un link directo y NO pasa por /go: capta gente, pero esa venta no se le puede
// atribuir al anuncio. Es una limitación del canal, no del código.
import type { TplDef } from "./types.js";
import { pixelHead, goHref, footer18 } from "./shared.js";

export const casinoPaquetes: TplDef = {
  id: "casino-paquetes",
  name: "Paquetes de créditos",
  desc: "Lista de paquetes con precio y dos botones de contacto: WhatsApp y Telegram.",
  category: "casino",
  fields: [
    { key: "brand", label: "Marca", type: "text", max: 40, required: true, default: "FRIJOLITO" },
    { key: "headline", label: "Título", type: "text", max: 90, required: true, default: "Paquetes de créditos" },
    { key: "sub", label: "Bajada", type: "text", max: 120, default: "Elegí tu paquete y escribinos. Atención las 24 horas." },
    { key: "p1", label: "Paquete 1 — precio", type: "text", max: 24, default: "$5.000" },
    { key: "p1extra", label: "Paquete 1 — qué incluye", type: "text", max: 44, default: "5.000 créditos" },
    { key: "p2", label: "Paquete 2 — precio", type: "text", max: 24, default: "$10.000" },
    { key: "p2extra", label: "Paquete 2 — qué incluye", type: "text", max: 44, default: "10.000 créditos + 10% extra" },
    { key: "p3", label: "Paquete 3 — precio", type: "text", max: 24, default: "$20.000" },
    { key: "p3extra", label: "Paquete 3 — qué incluye", type: "text", max: 44, default: "20.000 créditos + 20% extra" },
    { key: "p4", label: "Paquete 4 — precio (vacío = no se muestra)", type: "text", max: 24, default: "" },
    { key: "p4extra", label: "Paquete 4 — qué incluye", type: "text", max: 44, default: "" },
    { key: "destacado", label: "Cuál destacar (1 a 4, vacío = ninguno)", type: "text", max: 1, default: "3" },
    { key: "waText", label: "Texto del botón de WhatsApp", type: "text", max: 30, default: "Comprar por WhatsApp" },
    { key: "msg", label: "Mensaje de WhatsApp", type: "textarea", max: 160, default: "Hola! Quiero comprar créditos" },
    { key: "tgText", label: "Texto del botón de Telegram", type: "text", max: 30, default: "Comprar por Telegram" },
    { key: "telegram", label: "Link de Telegram (vacío = sin botón)", type: "text", max: 120, default: "" },
    { key: "accent", label: "Color del botón principal", type: "color", max: 7, default: "#22c55e" },
    { key: "oro", label: "Color del destacado", type: "color", max: 7, default: "#facc15" },
    { key: "fondoAlto", label: "Fondo (arriba)", type: "color", max: 7, default: "#16241c" },
    { key: "fondo", label: "Fondo (abajo)", type: "color", max: 7, default: "#070d0b" },
    { key: "tarjeta", label: "Color de las tarjetas", type: "color", max: 7, default: "#101d17" },
    { key: "borde", label: "Color de los bordes", type: "color", max: 7, default: "#1f3529" },
    { key: "texto2", label: "Color del texto secundario", type: "color", max: 7, default: "#9fb5a8" },
  ],
  render(ctx) {
    const v = ctx.values;
    const dest = ["1", "2", "3", "4"].includes(v.destacado) ? Number(v.destacado) : 0;

    // Los paquetes son informativos: se muestran para que el cliente elija antes de escribir.
    const paquete = (i: number, precio: string, extra: string) => {
      if (!precio.trim()) return "";
      const esDest = i === dest;
      return `<div class="pack${esDest ? " dest" : ""}">
        ${esDest ? `<span class="tag">MÁS ELEGIDO</span>` : ""}
        <span class="precio">${precio}</span>
        ${extra.trim() ? `<span class="extra">${extra}</span>` : ""}
      </div>`;
    };

    const tg = v.telegram.trim()
      ? `<a class="btn tg" href="${v.telegram}" target="_blank" rel="noopener">
           <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M9.8 16.1 9.6 20c.4 0 .5-.2.8-.4l1.9-1.8 3.9 2.9c.7.4 1.2.2 1.4-.7l2.6-12.1c.2-1-.4-1.4-1.1-1.2L2.6 10.2c-1 .4-1 .9-.2 1.2l4.4 1.4L17 6.4c.5-.3.9-.1.6.2z"/></svg>
           ${v.tgText}
         </a>`
      : "";

    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${v.brand}</title>
${pixelHead(ctx.pixelId)}
<style>
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,'Segoe UI',Roboto,Arial,sans-serif;background:linear-gradient(175deg,${v.fondoAlto},${v.fondo});color:#f4f1fa;min-height:100vh;display:flex;flex-direction:column}
.wrap{flex:1;display:flex;align-items:center;justify-content:center;padding:26px 16px}
.card{width:100%;max-width:430px;text-align:center}
.brand{font-size:13px;font-weight:800;letter-spacing:4px;text-transform:uppercase;color:${v.oro};margin-bottom:16px}
h1{font-size:clamp(36px,11vw,50px);line-height:1.02;margin:0 0 10px;font-weight:900;letter-spacing:1.5px;text-transform:uppercase}
.sub{margin:0 0 24px;color:${v.texto2};font-size:15px;line-height:1.5;letter-spacing:.3px}
.packs{display:grid;gap:10px;margin-bottom:24px}
.pack{position:relative;display:flex;align-items:baseline;justify-content:space-between;gap:12px;background:${v.tarjeta};border:1px solid ${v.borde};border-radius:14px;padding:15px 16px;text-align:left}
.pack .precio{font-size:22px;font-weight:900;line-height:1.1;white-space:nowrap;letter-spacing:.3px}
.pack .extra{font-size:13px;color:${v.texto2};text-align:right}
.pack.dest{border-color:${v.oro};background:${v.tarjeta};box-shadow:0 12px 34px -16px ${v.oro}aa,inset 0 0 0 1px ${v.oro}33}
.pack.dest .precio{color:${v.oro}}
.tag{position:absolute;top:-9px;right:13px;background:${v.oro};color:#1a1407;font-size:10.5px;font-weight:900;letter-spacing:.6px;padding:3px 9px;border-radius:999px}
.btn{display:flex;align-items:center;justify-content:center;gap:9px;text-decoration:none;border-radius:999px;padding:18px;font-size:18px;font-weight:900;letter-spacing:1px;text-transform:uppercase;margin-bottom:11px}
.btn:active{transform:scale(.99)}
.wa{background:${v.accent};color:#1a1030;box-shadow:0 14px 38px -14px ${v.accent}aa}
.tg{background:#229ED9;color:#fff;box-shadow:0 14px 38px -14px #229ED9aa}
.trust{display:flex;gap:7px;justify-content:center;flex-wrap:wrap;margin-top:18px}
.trust span{background:${v.tarjeta};border:1px solid ${v.borde};border-radius:9px;padding:8px 11px;font-size:12.5px;color:${v.texto2}}
</style>
</head>
<body>
<div class="wrap"><div class="card">
  <div class="brand">${v.brand}</div>
  <h1>${v.headline}</h1>
  <p class="sub">${v.sub}</p>
  <div class="packs">
    ${paquete(1, v.p1, v.p1extra)}
    ${paquete(2, v.p2, v.p2extra)}
    ${paquete(3, v.p3, v.p3extra)}
    ${paquete(4, v.p4, v.p4extra)}
  </div>
  <a class="btn wa" href="${goHref(ctx, v.msg)}">
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15l-1.3 4.7 4.8-1.3A10 10 0 1 0 12 2m5.8 14.2c-.2.7-1.4 1.3-2 1.4-.5 0-1.1.1-1.8-.1-.4-.1-1-.3-1.7-.6-3-1.3-4.9-4.3-5-4.5s-1.2-1.6-1.2-3 .7-2.1 1-2.4c.2-.3.5-.4.7-.4h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.3 0 .5l-.3.5-.3.3c-.1.1-.3.3-.1.6s.7 1.2 1.5 2c1 .8 1.8 1.1 2.1 1.2s.4.1.6-.1l.8-1c.2-.2.3-.2.6-.1l2 1c.2.1.4.2.4.3s0 .7-.2 1.4"/></svg>
    ${v.waText}
  </a>
  ${tg}
  <div class="trust"><span>⚡ Acreditación inmediata</span><span>🔒 Pago seguro</span><span>🕐 24 horas</span></div>
</div></div>
${footer18()}
</body>
</html>`;
  },
};
