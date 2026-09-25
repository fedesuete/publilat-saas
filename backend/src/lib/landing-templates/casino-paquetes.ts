// Paquetes de fichas: el visitante elige CUÁNTO quiere cargar y sale por WhatsApp (o Telegram) con
// el paquete ya escrito en el mensaje, así el cajero no tiene que preguntarlo.
//
// Cada paquete es su propio botón a /go: el Lead y la atribución salen igual que en las demás
// plantillas (server-side en el inbound). El botón de Telegram es un link directo y por lo tanto
// NO pasa por /go: sirve para captar gente, pero esa venta no se le puede atribuir al anuncio.
import type { TplDef } from "./types.js";
import { pixelHead, goHref, footer18 } from "./shared.js";

export const casinoPaquetes: TplDef = {
  id: "casino-paquetes",
  name: "Paquetes de fichas",
  desc: "Lista de paquetes con precio: el cliente toca el que quiere y llega por WhatsApp (o Telegram) con el monto ya escrito.",
  category: "casino",
  fields: [
    { key: "brand", label: "Marca", type: "text", max: 40, required: true, default: "FRIJOLITO" },
    { key: "headline", label: "Título", type: "text", max: 90, required: true, default: "Elegí tu paquete de fichas" },
    { key: "sub", label: "Bajada", type: "text", max: 120, default: "Cargá en segundos. Atención las 24 horas." },
    { key: "p1", label: "Paquete 1 — monto", type: "text", max: 24, default: "$5.000" },
    { key: "p1extra", label: "Paquete 1 — detalle", type: "text", max: 40, default: "5.000 fichas" },
    { key: "p2", label: "Paquete 2 — monto", type: "text", max: 24, default: "$10.000" },
    { key: "p2extra", label: "Paquete 2 — detalle", type: "text", max: 40, default: "10.000 fichas + 10% extra" },
    { key: "p3", label: "Paquete 3 — monto", type: "text", max: 24, default: "$20.000" },
    { key: "p3extra", label: "Paquete 3 — detalle", type: "text", max: 40, default: "20.000 fichas + 20% extra" },
    { key: "p4", label: "Paquete 4 — monto (vacío = no se muestra)", type: "text", max: 24, default: "" },
    { key: "p4extra", label: "Paquete 4 — detalle", type: "text", max: 40, default: "" },
    { key: "destacado", label: "Cuál destacar (1 a 4, vacío = ninguno)", type: "text", max: 1, default: "3" },
    { key: "msg", label: "Mensaje de WhatsApp", type: "textarea", max: 160, default: "Hola! Quiero el paquete de" },
    { key: "telegram", label: "Link de Telegram (vacío = sin botón)", type: "text", max: 120, default: "" },
    { key: "otro", label: "Texto del botón de otro monto", type: "text", max: 40, default: "Quiero otro monto" },
    { key: "accent", label: "Color principal", type: "color", max: 7, default: "#22c55e" },
    { key: "oro", label: "Color del destacado", type: "color", max: 7, default: "#facc15" },
  ],
  render(ctx) {
    const v = ctx.values;
    const dest = ["1", "2", "3", "4"].includes(v.destacado) ? Number(v.destacado) : 0;

    // Un botón por paquete. El monto viaja en el mensaje de WhatsApp: el cajero ve qué quiere cargar.
    const paquete = (i: number, monto: string, extra: string) => {
      if (!monto.trim()) return "";
      const esDest = i === dest;
      return `<a class="pack${esDest ? " dest" : ""}" href="${goHref(ctx, `${v.msg} ${monto}`)}">
        ${esDest ? `<span class="tag">MÁS ELEGIDO</span>` : ""}
        <span class="monto">${monto}</span>
        ${extra.trim() ? `<span class="extra">${extra}</span>` : ""}
        <span class="ir">Cargar por WhatsApp →</span>
      </a>`;
    };

    // Telegram: link directo, no pasa por /go (no se puede atribuir). Va como opción secundaria.
    const tg = v.telegram.trim()
      ? `<a class="tg" href="${v.telegram}" target="_blank" rel="noopener">
           <svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor" aria-hidden="true"><path d="M9.8 16.1 9.6 20c.4 0 .5-.2.8-.4l1.9-1.8 3.9 2.9c.7.4 1.2.2 1.4-.7l2.6-12.1c.2-1-.4-1.4-1.1-1.2L2.6 10.2c-1 .4-1 .9-.2 1.2l4.4 1.4L17 6.4c.5-.3.9-.1.6.2z"/></svg>
           También por Telegram
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
body{margin:0;font-family:system-ui,'Segoe UI',Roboto,Arial,sans-serif;background:radial-gradient(circle at 50% -10%,#16241c,#0b1310 58%,#070d0b);color:#e9edef;min-height:100vh;display:flex;flex-direction:column}
.wrap{flex:1;display:flex;align-items:center;justify-content:center;padding:26px 16px}
.card{width:100%;max-width:440px;text-align:center}
.brand{font-size:14px;font-weight:800;letter-spacing:3px;text-transform:uppercase;color:${v.oro};margin-bottom:14px}
h1{font-size:clamp(25px,6.4vw,33px);line-height:1.18;margin:0 0 8px;font-weight:900}
.sub{margin:0 0 22px;color:#9fb5a8;font-size:14.5px;line-height:1.5}
.packs{display:grid;gap:11px}
.pack{position:relative;display:grid;gap:3px;text-decoration:none;color:inherit;background:#101d17;border:1px solid #1f3529;border-radius:15px;padding:15px 16px;text-align:left}
.pack:active{transform:scale(.99)}
.pack .monto{font-size:23px;font-weight:900;line-height:1.1}
.pack .extra{font-size:13px;color:#9fb5a8}
.pack .ir{margin-top:5px;font-size:13px;font-weight:700;color:${v.accent}}
.pack.dest{border-color:${v.oro};background:linear-gradient(180deg,#1a2a1e,#101d17);box-shadow:0 12px 34px -16px ${v.oro}88}
.pack.dest .monto{color:${v.oro}}
.tag{position:absolute;top:-9px;right:13px;background:${v.oro};color:#1a1407;font-size:10.5px;font-weight:900;letter-spacing:.6px;padding:3px 9px;border-radius:999px}
.otro{display:block;margin-top:13px;text-decoration:none;text-align:center;border:1px dashed #2b4536;border-radius:13px;padding:13px;color:#bcd6c9;font-size:14px;font-weight:600}
.tg{display:inline-flex;align-items:center;justify-content:center;gap:8px;margin-top:16px;text-decoration:none;color:#8fd0ff;font-size:14px;font-weight:700;border:1px solid #1e3a4d;background:#0e1c25;border-radius:999px;padding:11px 20px}
.trust{display:flex;gap:7px;justify-content:center;flex-wrap:wrap;margin-top:20px}
.trust span{background:#101d17;border:1px solid #1e3229;border-radius:9px;padding:8px 11px;font-size:12.5px;color:#bcd6c9}
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
  <a class="otro" href="${goHref(ctx, v.msg)}">${v.otro}</a>
  ${tg}
  <div class="trust"><span>⚡ Carga inmediata</span><span>🔒 Pago seguro</span><span>🕐 24 horas</span></div>
</div></div>
${footer18()}
</body>
</html>`;
  },
};
