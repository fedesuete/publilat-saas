import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Star, Plus, LayoutTemplate, Upload, ExternalLink, Trash2, Copy, Check, X, GraduationCap } from "lucide-react";
import { api, apiError } from "../lib/api";
import { API_BASE } from "../lib/config";
import { useAuth } from "../lib/auth";
import { Button, Input, Card, ErrorMsg } from "../components/ui";
import OnboardingTour, { type TourStep } from "../components/OnboardingTour";

// Recorrido guiado de la sección Landings (spotlight, igual que el del registro).
const LANDINGS_TOUR: TourStep[] = [
  { targetId: "lp-guide", title: "1. La guía 🎓", body: "Acá tenés las reglas y un prompt listo para pedirle el HTML a ChatGPT sin errores. Desplegalo cuando quieras." },
  { targetId: "lp-tabs", title: "2. Tus landings", body: "Creá una nueva ('Nueva landing') o elegí una que ya tengas. Podés armarla por campos o pegando tu propio HTML." },
  { targetId: "lp-editor", title: "3. Editá y previsualizá", body: "'Campos' = rápido por partes. 'HTML' = pegás tu diseño propio. La vista previa de la derecha se actualiza en vivo." },
  { targetId: "lp-review", title: "4. Revisión automática", body: "Un semáforo te avisa si el botón usa el seguimiento (/go), si falta el pixel, etc. Corregí lo que salga en rojo." },
  { targetId: "lp-campaign", title: "5. URL para campañas", body: "Esta es la URL que ponés en tu anuncio de Meta. Aparece al publicar (es tu dominio propio de CloudFront, aislado)." },
  { targetId: "lp-publish", title: "6. Publicá", body: "Tocá Publicar para activar tu landing y generar tu dominio propio. Después copiás la URL de arriba y va al anuncio." },
];

// ---- Plantillas (diseños ORIGINALES y NEUTROS, listos para editar). El CTA apunta al
// redirector /go con el slug del usuario para mantener la atribución. Sin número ni pixel reales.
type TplCat = "simple" | "full";
interface Tpl { name: string; desc: string; category: TplCat; html: string }

function templates(slug: string): Tpl[] {
  const go = (msg: string) => `${API_BASE}/go?u=${slug}&msg=${encodeURIComponent(msg)}`;
  const page = (title: string, css: string, body: string) =>
    `<!doctype html><html lang="es"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${title}</title><style>*{box-sizing:border-box}body{margin:0;font-family:system-ui,'Segoe UI',Roboto,Arial,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}a.btn:active{transform:scale(.99)}${css}</style></head><body>${body}</body></html>`;
  const base = (title: string, body: string) =>
    page(title, `body{background:#0b141a;color:#e9edef}.c{max-width:440px;width:100%;text-align:center;padding:44px 28px;background:#111b21;border:1px solid #222d34;border-radius:16px}h1{font-size:26px;margin:0 0 10px}p{color:#8696a0;margin:0 0 28px;line-height:1.55}a.btn{display:block;text-decoration:none;border-radius:999px;padding:16px;font-size:17px;font-weight:700;background:#25d366;color:#03301a}`, `<div class="c">${body}</div>`);

  return [
    { name: "Simple", category: "simple", desc: "Tarjeta limpia sobre fondo oscuro, botón verde de WhatsApp.",
      html: base("Contactanos", `<h1>Hablá con nosotros</h1><p>Te respondemos al toque por WhatsApp.</p><a class="btn" href="${go("Hola, quiero info")}">Escribir por WhatsApp</a>`) },
    { name: "Promo", category: "simple", desc: "Para una promo o descuento por tiempo limitado.",
      html: base("Promo", `<h1>🔥 Promo por tiempo limitado</h1><p>Escribinos y reservá tu descuento ahora.</p><a class="btn" href="${go("Hola, quiero la promo")}">Quiero la promo</a>`) },
    { name: "Servicios", category: "simple", desc: "Captación de consultas / asesoramiento.",
      html: base("Servicios", `<h1>¿Necesitás ayuda?</h1><p>Contanos qué buscás y te asesoramos sin cargo.</p><a class="btn" href="${go("Hola, necesito asesoramiento")}">Pedir asesoramiento</a>`) },

    { name: "Redirección WhatsApp", category: "full", desc: "Pantalla de carga animada que redirige directo a WhatsApp.",
      html: page("Conectando…", `body{background:#0b141a;color:#e9edef;text-align:center}.c{max-width:420px}.s{width:54px;height:54px;border:5px solid #1f2c33;border-top-color:#25d366;border-radius:50%;margin:0 auto 22px;animation:r 1s linear infinite}@keyframes r{to{transform:rotate(360deg)}}h1{font-size:22px;margin:0 0 6px}p{color:#8696a0;margin:0 0 22px}a.btn{display:inline-block;text-decoration:none;border-radius:999px;padding:13px 26px;font-weight:700;background:#25d366;color:#03301a}`,
        `<div class="c"><div class="s"></div><h1>Te estamos conectando</h1><p>Si no se abre solo, tocá el botón.</p><a class="btn" href="${go("Hola, vengo de la web")}">Abrir WhatsApp</a></div><script>setTimeout(function(){location.href=${JSON.stringify(go("Hola, vengo de la web"))}},1500)</script>`) },
    { name: "Bienvenida", category: "full", desc: "Alto impacto, dorado elegante. Beneficio de bienvenida.",
      html: page("Beneficio de bienvenida", `body{background:radial-gradient(circle at 50% 0%,#1a1407,#0a0a0a);color:#fff}.c{max-width:460px;width:100%;text-align:center;background:linear-gradient(180deg,#171206,#0d0b04);border:1px solid #b8860b55;border-radius:20px;padding:44px 26px;box-shadow:0 24px 60px -24px #000}.k{display:inline-block;padding:6px 14px;border:1px solid #d4af3766;border-radius:999px;color:#e9c766;font-size:12px;letter-spacing:1px;text-transform:uppercase}h1{font-size:30px;margin:16px 0 8px;line-height:1.2}.g{background:linear-gradient(90deg,#f5d271,#d4af37,#b8860b);-webkit-background-clip:text;background-clip:text;color:transparent}p{color:#c9bfa3;margin:0 0 26px;line-height:1.55}a.btn{display:block;text-decoration:none;border-radius:999px;padding:17px;font-size:18px;font-weight:800;color:#1a1407;background:linear-gradient(90deg,#f5d271,#d4af37);box-shadow:0 12px 34px -10px #d4af37aa}`,
        `<div class="c"><span class="k">Beneficio de bienvenida</span><h1>Llevate tu <span class="g">beneficio</span> de bienvenida</h1><p>Sumate hoy y accedé a tu beneficio. Te atendemos al instante por WhatsApp.</p><a class="btn" href="${go("Hola! Quiero mi beneficio de bienvenida 🎁")}">Quiero mi beneficio</a></div>`) },
    { name: "Sorteo", category: "full", desc: "Neón violeta/cyan para sorteos y participaciones.",
      html: page("Participá y ganá", `body{background:#0a0613;background-image:radial-gradient(circle at 80% 15%,#3b0d6b55,transparent),radial-gradient(circle at 10% 90%,#0d6b6155,transparent);color:#fff}.c{max-width:460px;width:100%;text-align:center;background:#120a22;border:1px solid #6d28d955;border-radius:20px;padding:40px 26px}.e{font-size:56px;line-height:1}h1{font-size:30px;margin:8px 0 8px}.n{color:#22d3ee;text-shadow:0 0 18px #22d3ee88}p{color:#b9a7d6;margin:0 0 26px;line-height:1.55}a.btn{display:block;text-decoration:none;border-radius:14px;padding:17px;font-size:18px;font-weight:800;color:#0a0613;background:linear-gradient(90deg,#22d3ee,#a855f7);box-shadow:0 0 32px -6px #a855f7aa}`,
        `<div class="c"><div class="e">🎁</div><h1>Participá y <span class="n">ganá</span></h1><p>Sumate al sorteo de este mes. Escribinos y participá en segundos.</p><a class="btn" href="${go("Hola! Quiero participar del sorteo 🎁")}">Participar</a></div>`) },
    { name: "Club VIP", category: "full", desc: "Verde premium con chips de beneficios.",
      html: page("Club VIP", `body{background:#07100c;background-image:radial-gradient(circle at 50% -10%,#0f3d2a,transparent);color:#fff}.c{max-width:460px;width:100%;text-align:center;background:#0b1712;border:1px solid #10b98155;border-radius:20px;padding:40px 26px}.k{color:#34d399;font-size:12px;letter-spacing:2px;text-transform:uppercase}h1{font-size:28px;margin:14px 0 14px}p{color:#9fb8ad;margin:0 0 26px;line-height:1.55}a.btn{display:block;text-decoration:none;border-radius:999px;padding:17px;font-size:18px;font-weight:800;color:#06281b;background:linear-gradient(90deg,#34d399,#10b981)}.row{display:flex;gap:8px;justify-content:center;margin-bottom:20px;flex-wrap:wrap}.chip{background:#0f211a;border:1px solid #10b98133;border-radius:10px;padding:8px 12px;color:#cdeee0;font-size:13px}`,
        `<div class="c"><div class="k">★ Clientes VIP</div><h1>Sumate al Club VIP</h1><div class="row"><span class="chip">Atención 24/7</span><span class="chip">Beneficios exclusivos</span><span class="chip">Respuesta rápida</span></div><p>Accedé a beneficios exclusivos y atención prioritaria. Te escribimos por WhatsApp.</p><a class="btn" href="${go("Hola! Quiero sumarme al Club VIP")}">Unirme al VIP</a></div>`) },
    { name: "Oferta Relámpago", category: "full", desc: "Rojo/naranja urgente para ofertas flash.",
      html: page("Oferta relámpago", `body{background:#120606;background-image:radial-gradient(circle at 50% 0%,#3a0a0a,transparent);color:#fff}.c{max-width:460px;width:100%;text-align:center;background:#1a0a0a;border:1px solid #ef444455;border-radius:20px;padding:44px 26px}.k{display:inline-block;background:#ef4444;color:#fff;font-weight:700;font-size:12px;padding:5px 12px;border-radius:999px;text-transform:uppercase;letter-spacing:1px}h1{font-size:30px;margin:16px 0 8px}p{color:#e7b3b3;margin:0 0 26px;line-height:1.55}a.btn{display:block;text-decoration:none;border-radius:12px;padding:17px;font-size:18px;font-weight:800;color:#fff;background:linear-gradient(90deg,#ef4444,#f97316);box-shadow:0 12px 34px -10px #ef4444aa}`,
        `<div class="c"><span class="k">⚡ Por tiempo limitado</span><h1>2x1 en tu primer pedido</h1><p>Aprovechá la oferta de hoy. Escribinos antes de que termine.</p><a class="btn" href="${go("Hola! Quiero la oferta 2x1 ⚡")}">Aprovechar ahora</a></div>`) },
    { name: "Novedades", category: "full", desc: "Azul moderno para catálogo y novedades.",
      html: page("Novedades", `body{background:#06101c;background-image:radial-gradient(circle at 50% 0%,#0c2a4d,transparent);color:#fff}.c{max-width:460px;width:100%;text-align:center;background:#0a1726;border:1px solid #3b82f655;border-radius:20px;padding:40px 26px}.e{font-size:52px}h1{font-size:28px;margin:8px 0 8px}.g{color:#60a5fa}p{color:#a9c0d6;margin:0 0 26px;line-height:1.55}a.btn{display:block;text-decoration:none;border-radius:12px;padding:17px;font-size:18px;font-weight:800;color:#06101c;background:linear-gradient(90deg,#60a5fa,#3b82f6)}`,
        `<div class="c"><div class="e">🛍️</div><h1>Enterate de las <span class="g">novedades</span></h1><p>Escribinos y te pasamos catálogo, precios y promos. Sin compromiso.</p><a class="btn" href="${go("Hola! Quiero recibir las novedades")}">Pedir info</a></div>`) },
  ];
}

interface LandingConfig { title?: string; headline?: string; subtitle?: string; buttonText?: string; msg?: string; autoRedirect?: boolean }
interface Landing { id: string; name: string; slug: string; config: LandingConfig | null; isPrimary: boolean; published: boolean; publishedUrl: string | null; createdAt: string }

const landingUrl = (slug: string) => `${API_BASE}/p/${slug}`;

// Vista previa aproximada para el modo "Campos" (la página real la arma el server).
function previewFromFields(slug: string, f: FormState): string {
  const go = `${API_BASE}/go?u=${slug}&msg=${encodeURIComponent(f.msg || "Hola, quiero info")}`;
  return `<!doctype html><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${f.title || "Landing"}</title><div style="font-family:system-ui;min-height:100vh;margin:0;display:flex;align-items:center;justify-content:center;background:#0b141a;color:#e9edef;padding:24px"><div style="max-width:440px;width:100%;text-align:center;padding:44px 28px;background:#111b21;border:1px solid #222d34;border-radius:16px"><h1 style="font-size:26px;margin:0 0 10px">${f.headline || "Tu encabezado acá"}</h1><p style="color:#8696a0;margin:0 0 28px;line-height:1.55">${f.subtitle || "Tu subtítulo descriptivo"}</p><a href="${go}" style="display:block;text-decoration:none;border-radius:999px;padding:16px;font-size:17px;font-weight:700;background:#25d366;color:#03301a">${f.buttonText || "Escribir por WhatsApp"}</a></div></div>`;
}

function CopyBtn({ value, label = "Copiar" }: { value: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <Button variant="secondary" onClick={async () => { try { await navigator.clipboard.writeText(value); setOk(true); setTimeout(() => setOk(false), 1500); } catch { /* noop */ } }}>
      {ok ? <><Check className="h-4 w-4" /> ¡Listo!</> : <><Copy className="h-4 w-4" /> {label}</>}
    </Button>
  );
}

interface FormState { name: string; title: string; headline: string; subtitle: string; buttonText: string; msg: string; autoRedirect: boolean }
const EMPTY_FORM: FormState = { name: "", title: "", headline: "", subtitle: "", buttonText: "", msg: "", autoRedirect: false };

// Revisión automática del HTML propio: detecta los errores típicos y guía (no bloquea).
// Distingue el Pixel del NAVEGADOR (código en el HTML) del Pixel SERVER-SIDE/CAPI (cargado en
// "Mi Pixel"). El seguimiento se inyecta solo al publicar.
function analyzeLanding(html: string) {
  const h = html.toLowerCase();
  const goMatch = html.match(/\/go\?[^"'\s<>]*\bu=([a-z0-9_-]+)/i);
  return {
    hasPixel: /fbq\s*\(\s*['"]init['"]/.test(h) || h.includes("fbevents.js"),
    hasGoLink: h.includes("/go?"),
    hasWaDirect: h.includes("wa.me") || h.includes("api.whatsapp.com") || h.includes("whatsapp://"),
    manualLead: /fbq\s*\(\s*['"]track['"]\s*,\s*['"]lead['"]/i.test(html),
    hardcodedNumber: /wa\.me\/\+?\d{5,}/i.test(h) || /[?&]phone=\+?\d{5,}/i.test(h),
    goSlug: goMatch ? goMatch[1] : null,
  };
}

// Código base del Pixel de Meta (init + PageView) con el ID del cliente ya puesto.
// SIN evento Lead: de eso se encarga el botón /go (evita duplicar).
function metaPixelSnippet(pixelId: string): string {
  const id = pixelId || "TU_PIXEL_ID";
  return `<!-- Meta Pixel -->
<script>
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init','${id}');fbq('track','PageView');
</script>
<noscript><img height="1" width="1" style="display:none"
src="https://www.facebook.com/tr?id=${id}&ev=PageView&noscript=1"/></noscript>
<!-- End Meta Pixel -->`;
}

function LandingReview({ html, goLink, slug, pixelId }: { html: string; goLink: string; slug: string; pixelId: string }) {
  const a = analyzeLanding(html);
  type Row = { s: "ok" | "warn" | "err"; t: string };
  const rows: Row[] = [];

  // 1) Botón con seguimiento
  if (a.hasGoLink && a.goSlug && slug && a.goSlug.toLowerCase() !== slug.toLowerCase())
    rows.push({ s: "warn", t: `El botón usa /go pero con otro usuario (u=${a.goSlug}). Tiene que ser u=${slug}, si no los leads le entran a otra cuenta.` });
  else if (a.hasGoLink)
    rows.push({ s: "ok", t: "El botón usa tu link de seguimiento (/go): la atribución va a funcionar y no se duplica." });
  else if (a.hasWaDirect)
    rows.push({ s: "err", t: "Tu botón va DIRECTO a WhatsApp. Así se pierde la atribución (Meta no sabe quién compró). Reemplazalo por tu link de seguimiento de abajo." });
  else
    rows.push({ s: "warn", t: "No encontramos un botón que lleve a WhatsApp con seguimiento. Poné tu link de seguimiento de abajo en el botón principal." });

  // 2) Número de teléfono hardcodeado
  if (a.hardcodedNumber)
    rows.push({ s: "err", t: "Hay un número de teléfono escrito en un link de WhatsApp. Eso saltea el seguimiento y no rota tus líneas. Sacá el número y usá el link /go." });

  // 3) Pixel del navegador vs. Pixel de "Mi Pixel" (server-side / CAPI)
  if (a.hasPixel)
    rows.push({ s: "ok", t: "Detectamos el Pixel de Meta en la página (el PageView del navegador está cubierto)." });
  else if (pixelId)
    rows.push({ s: "ok", t: "Tu Pixel ya está cargado en 'Mi Pixel', así que el Lead server-side (CAPI) YA se dispara. El código de abajo es OPCIONAL: suma el pixel del navegador (PageView + deduplicación)." });
  else
    rows.push({ s: "warn", t: "No tenés Pixel configurado. Andá a 'Mi Pixel' y cargá tu Pixel ID + token para que salgan tus eventos a Meta." });

  // 4) Lead manual (duplica)
  if (a.manualLead)
    rows.push({ s: "warn", t: "Encontramos un evento Lead puesto a mano (fbq 'track' 'Lead'). El botón /go YA dispara el Lead — dejar los dos DUPLICA. Sacalo y dejá solo el PageView." });

  const buttonOk = a.hasGoLink && !(a.goSlug && slug && a.goSlug.toLowerCase() !== slug.toLowerCase());
  const icon = { ok: "✅", warn: "⚠️", err: "🔴" };
  const color = { ok: "text-wa-green", warn: "text-amber-300", err: "text-rose-300" };

  return (
    <Card className="mt-4">
      <div className="mb-2 text-sm font-semibold text-slate-100">Revisión de tu landing</div>
      <ul className="space-y-1.5 text-sm">
        {rows.map((r, i) => (
          <li key={i} className={`flex gap-2 ${color[r.s]}`}><span>{icon[r.s]}</span><span className="text-slate-300">{r.t}</span></li>
        ))}
      </ul>

      {/* Link de seguimiento */}
      <div className="mt-3 rounded-md border border-slate-700 bg-slate-900/50 p-3">
        <div className="mb-1 text-xs font-semibold text-slate-300">
          {buttonOk
            ? "Tu link de seguimiento — ✓ ya está en tu botón (copialo solo si agregás otro botón)"
            : "Tu link de seguimiento (pegalo en el botón que va a WhatsApp)"}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input readOnly value={goLink} className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-300" />
          <CopyBtn value={goLink} label="Copiar link" />
        </div>
        <p className="mt-2 text-[11px] text-slate-500">Ej. en tu botón: <span className="font-mono text-slate-400">&lt;a href="{goLink}"&gt;Ir a WhatsApp&lt;/a&gt;</span></p>
      </div>

      {/* Código del Pixel del navegador (si falta en el HTML) */}
      {!a.hasPixel && (
        <div className="mt-3 rounded-md border border-slate-700 bg-slate-900/50 p-3">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <div className="text-xs font-semibold text-slate-300">Pixel del navegador {pixelId ? "(opcional)" : ""} — pegalo en el &lt;head&gt;</div>
            <CopyBtn value={metaPixelSnippet(pixelId)} label="Copiar código" />
          </div>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-slate-950 p-2 font-mono text-[10px] leading-relaxed text-slate-400">{metaPixelSnippet(pixelId)}</pre>
          <p className="mt-1 text-[11px] text-slate-500">
            {pixelId
              ? <>Ya viene con tu Pixel ID (<span className="font-mono text-slate-400">{pixelId}</span>). No le agregues un evento Lead: de eso se encarga el botón /go.</>
              : <>Primero cargá tu Pixel en <b className="text-slate-300">Mi Pixel</b>; después este código sale con tu ID.</>}
          </p>
        </div>
      )}

      <div className="mt-3 text-[11px] text-slate-500">
        <b className="text-slate-400">Clave:</b> el <b className="text-slate-300">Lead y el Purchase salen por tu Pixel de "Mi Pixel"</b> (server-side, CAPI) — eso es lo que hace el match con Meta. El Pixel del navegador es un extra para el PageView y la deduplicación.
      </div>
    </Card>
  );
}

// Instructivo colapsable: cómo armar una landing sin errores + prompt listo para ChatGPT
// (con el slug del cliente ya puesto en el /go). Evita los errores típicos: wa.me directo,
// número hardcodeado, Lead a mano.
function LandingGuide({ slug, goBase }: { slug: string; goBase: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const goLink = `${goBase}/go?u=${slug || "TU_SLUG"}&msg=Hola%2C%20quiero%20info`;
  const prompt = `Actuá como diseñador web. Necesito una landing page en UN SOLO archivo HTML (con CSS y JS inline, sin librerías ni recursos externos), responsive y en español, para mi negocio: [DESCRIBÍ TU NEGOCIO EN UNA LÍNEA].

Objetivo: que la persona toque un botón grande y vaya a WhatsApp.

REGLAS OBLIGATORIAS (no las cambies):
1) El botón principal (y cualquier botón de "hablar por WhatsApp") debe apuntar EXACTAMENTE a:
   ${goLink}
   - NO uses links de wa.me ni pongas ningún número de teléfono en el código.
   - El texto después de msg= podés cambiarlo, pero tiene que ir URL-encoded (espacio = %20).
2) En el <head> incluí SOLO el código base del Píxel de Meta (init + PageView) con tu Pixel ID.
   NO agregues fbq('track','Lead') ni ningún otro evento: de eso se encarga el sistema.
3) El botón de WhatsApp tiene que ser grande, verde y lo más visible de la página. Textos cortos y concretos.
4) Todo en un solo archivo, sin fuentes/imágenes por link. Estilos y colores inline.

Devolvé solo el código HTML completo, listo para copiar y pegar.`;

  const copy = async () => {
    try { await navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* clipboard no disponible */ }
  };

  return (
    <Card className="mb-5">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between text-left">
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-100">
          <GraduationCap className="h-4 w-4 text-wa-green" /> ¿Cómo armo mi landing? (sin errores)
        </span>
        <span className="text-lg text-slate-500">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="mt-4 space-y-4 text-sm">
          <div className="rounded-lg border border-wa-green/30 bg-wa-green/5 p-3">
            <div className="font-semibold text-wa-green">🥇 Regla de oro</div>
            <p className="mt-1 text-slate-300">El botón SIEMPRE va a <code className="rounded bg-slate-800 px-1 text-wa-green">{goBase}/go?u={slug || "TU_SLUG"}</code> — nunca a <b>wa.me</b> ni con un número escrito. Así se dispara el Lead, se guarda la atribución y no se duplica.</p>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="font-semibold text-slate-200">Prompt para pedirle el HTML a ChatGPT</span>
              <button onClick={copy} className="flex items-center gap-1.5 rounded-md border border-slate-600 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800">
                {copied ? <><Check className="h-3.5 w-3.5 text-wa-green" /> Copiado</> : <><Copy className="h-3.5 w-3.5" /> Copiar prompt</>}
              </button>
            </div>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-slate-700 bg-slate-950 p-3 text-xs text-slate-300">{prompt}</pre>
            <p className="mt-1 text-xs text-slate-500">Ya viene con tu usuario (<b className="text-slate-300">{slug || "—"}</b>). Pegalo en ChatGPT, completá tu negocio y tu Pixel ID.</p>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-lg border border-red-500/25 bg-red-500/5 p-2.5 text-xs text-slate-300"><b className="text-red-300">✗ wa.me directo</b><br />No trackea + duplica</div>
            <div className="rounded-lg border border-red-500/25 bg-red-500/5 p-2.5 text-xs text-slate-300"><b className="text-red-300">✗ número en el código</b><br />No trackea + no rota</div>
            <div className="rounded-lg border border-red-500/25 bg-red-500/5 p-2.5 text-xs text-slate-300"><b className="text-red-300">✗ Lead a mano (fbq)</b><br />Duplica el Lead</div>
          </div>
          <p className="text-xs text-slate-500">Después de pegar el HTML, mirá el <b className="text-slate-300">semáforo de revisión</b> del editor y acordate de <b className="text-slate-300">re-publicar</b> si cambiás algo.</p>

          <div className="rounded-lg border border-slate-700 bg-slate-950/50 p-3 text-xs text-slate-400">
            <b className="text-slate-200">🌐 Tu landing va en tu propio dominio</b> (no en publi.lat): al publicar se sirve desde un dominio descartable de Amazon CloudFront, tuyo y aislado. Si alguna vez Meta lo marca, usás <b className="text-slate-200">"Reprovisionar dominio"</b> y saltás a uno nuevo limpio sin perder nada.
          </div>
          <div className="rounded-lg border border-slate-700 bg-slate-950/50 p-3 text-xs text-slate-400">
            <b className="text-slate-200">♻️ Editar con anuncios corriendo no rompe nada.</b> Al re-publicar, tu <b className="text-slate-200">URL sigue igual</b> (no cambia el dominio) → tus anuncios siguen andando, ahora con el contenido nuevo. Ideal para, por ejemplo, sumarle el pixel del navegador a una landing en vivo: editás, pegás, <b className="text-slate-200">Publicar</b>, y el diseño queda idéntico.
          </div>
        </div>
      )}
    </Card>
  );
}

export default function LandingsPage() {
  const { user } = useAuth();
  const slug = user?.slug ?? "";
  const tpls = useMemo(() => templates(slug), [slug]);
  // Pixel del cliente (de "Mi Pixel") para la revisión: distinguir server-side vs navegador
  // y ofrecer el código base con su ID ya puesto.
  const [pixelId, setPixelId] = useState("");
  useEffect(() => {
    api.get<{ pixels: Array<{ pixelId: string; eventType: string }> }>("/api/pixels")
      .then(({ data }) => {
        const p = data.pixels.find((x) => x.eventType === "Lead") ?? data.pixels[0];
        setPixelId(p?.pixelId ?? "");
      })
      .catch(() => { /* sin pixel: la revisión lo avisa */ });
  }, []);

  const [landings, setLandings] = useState<Landing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [mode, setMode] = useState<"fields" | "html">("html");
  const [html, setHtml] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showTpl, setShowTpl] = useState(false);
  const [snapshot, setSnapshot] = useState("");
  const [reprovisioning, setReprovisioning] = useState(false);
  const [reproMsg, setReproMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const current = landings.find((l) => l.id === editingId) ?? null;
  const curSnapshot = mode === "html" ? `h|${form.name}|${html}` : `f|${form.name}|${JSON.stringify(form)}`;
  const dirty = editingId === null ? true : curSnapshot !== snapshot;
  const previewHtml = mode === "html" ? html : previewFromFields(slug, form);

  const load = async () => {
    setLoading(true); setError(null);
    try { const { data } = await api.get<{ landings: Landing[] }>("/api/landings"); setLandings(data.landings); }
    catch (err) { setError(apiError(err)); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const startCreate = () => {
    setEditingId(null); setForm(EMPTY_FORM); setMode("html");
    setHtml(tpls[0].html); setSnapshot("");
  };

  const startEdit = async (l: Landing) => {
    setEditingId(l.id); setError(null);
    const c = (l.config ?? {}) as LandingConfig & { raw?: boolean };
    if (c.raw) {
      setMode("html"); setForm({ ...EMPTY_FORM, name: l.name });
      let body = "";
      try { body = await (await fetch(landingUrl(l.slug))).text(); } catch { /* noop */ }
      setHtml(body); setSnapshot(`h|${l.name}|${body}`);
    } else {
      setMode("fields"); setHtml("");
      const f = { name: l.name, title: c.title ?? "", headline: c.headline ?? "", subtitle: c.subtitle ?? "", buttonText: c.buttonText ?? "", msg: c.msg ?? "", autoRedirect: c.autoRedirect ?? false };
      setForm(f); setSnapshot(`f|${l.name}|${JSON.stringify(f)}`);
    }
  };

  const onUploadHtml = (file: File) => { const r = new FileReader(); r.onload = () => { setHtml(String(r.result ?? "")); setMode("html"); }; r.readAsText(file); };

  const buildConfig = (): LandingConfig => ({ title: form.title || undefined, headline: form.headline || undefined, subtitle: form.subtitle || undefined, buttonText: form.buttonText || undefined, msg: form.msg || undefined, autoRedirect: form.autoRedirect || undefined });

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!form.name.trim()) { setError("Ponele un nombre a la landing."); return; }
    if (mode === "html" && !html.trim()) { setError("El HTML no puede estar vacío."); return; }
    setSaving(true); setError(null);
    try {
      const payload = mode === "html" ? { name: form.name.trim(), html } : { name: form.name.trim(), config: buildConfig() };
      if (editingId) await api.put<{ landing: Landing }>(`/api/landings/${editingId}`, payload);
      else { const { data } = await api.post<{ landing: Landing }>("/api/landings", payload); setEditingId(data.landing.id); }
      setSnapshot(curSnapshot);
      await load();
    } catch (err) { setError(apiError(err)); } finally { setSaving(false); }
  };

  const publish = async () => {
    if (!editingId) return;
    if (dirty) await save();
    setBusyId(editingId); setError(null);
    try { await api.post(`/api/landings/${editingId}/publish`); await load(); }
    catch (err) { setError(apiError(err)); } finally { setBusyId(null); }
  };

  const makePrimary = async () => {
    if (!editingId) return;
    setBusyId(editingId); setError(null);
    try { await api.put(`/api/landings/${editingId}`, { isPrimary: true }); await load(); }
    catch (err) { setError(apiError(err)); } finally { setBusyId(null); }
  };

  // Genera un dominio nuevo (cuando Meta quema el actual). Es a nivel cuenta: reapunta
  // TODAS tus landings publicadas al dominio nuevo.
  const reprovision = async () => {
    if (!window.confirm("Se va a generar un dominio NUEVO para tus landings y se reapuntan todas las publicadas. La URL para campañas cambia. ¿Continuar?")) return;
    setReprovisioning(true); setError(null); setReproMsg(null);
    try {
      const { data } = await api.post<{ cloudfrontDomain: string }>("/api/landings/reprovision");
      setReproMsg(`Dominio nuevo listo: ${data.cloudfrontDomain}. Copiá la URL para campañas actualizada y cambiala en tus anuncios. (Tarda unos minutos en propagar.)`);
      await load();
    } catch (err) { setError(apiError(err)); } finally { setReprovisioning(false); }
  };

  const remove = async () => {
    if (!current) return;
    if (!window.confirm(`¿Borrar la landing "${current.name}"?`)) return;
    setBusyId(current.id); setError(null);
    try { await api.delete(`/api/landings/${current.id}`); setEditingId(null); setForm(EMPTY_FORM); setHtml(""); await load(); }
    catch (err) { setError(apiError(err)); } finally { setBusyId(null); }
  };

  const useTemplate = (t: Tpl) => { setMode("html"); setHtml(t.html); if (!form.name) setForm((f) => ({ ...f, name: t.name })); setShowTpl(false); };
  type TextKey = "name" | "title" | "headline" | "subtitle" | "buttonText" | "msg";
  const setField = (k: TextKey, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const campaignUrl = current ? (current.publishedUrl ?? landingUrl(current.slug)) : "";
  const editing = editingId !== null || html !== "" || form.name !== "";

  // Recorrido guiado: se abre solo la primera vez (como el registro) y con el botón "Guía".
  // Si no hay una landing abierta, abre una para que se vean el editor/revisión/publicar.
  const [tour, setTour] = useState(false);
  const tourStarted = useRef(false);
  const startTour = () => {
    if (!editing) {
      if (landings.length > 0) void startEdit(landings[0]);
      else startCreate();
    }
    window.setTimeout(() => setTour(true), 280);
  };
  useEffect(() => {
    if (loading || tourStarted.current) return;
    tourStarted.current = true;
    if (localStorage.getItem("pl_landings_tour") === "done") return;
    localStorage.setItem("pl_landings_tour", "done");
    startTour();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Landings</h1>
          <p className="text-sm text-slate-400">Páginas rastreadas que disparan el Lead y llevan a WhatsApp.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={startTour}><GraduationCap className="h-4 w-4" /> Guía</Button>
          <Button variant="secondary" onClick={() => void load()}>Actualizar</Button>
        </div>
      </div>

      {error && <div className="mb-4"><ErrorMsg>{error}</ErrorMsg></div>}

      <div id="lp-guide"><LandingGuide slug={slug} goBase={API_BASE} /></div>

      {/* Pestañas de landings */}
      <div id="lp-tabs" className="mb-5 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Landings:</span>
        {landings.map((l) => (
          <button key={l.id} onClick={() => void startEdit(l)}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition ${editingId === l.id ? "border-wa-green bg-wa-green/15 text-wa-green" : "border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800"}`}>
            {l.isPrimary && <Star className="h-3.5 w-3.5 fill-current" />}
            {l.name}
          </button>
        ))}
        <button onClick={startCreate} className="flex items-center gap-1 rounded-lg border border-dashed border-slate-600 px-3 py-1.5 text-sm font-medium text-slate-300 hover:bg-slate-800">
          <Plus className="h-4 w-4" /> Nueva landing
        </button>
      </div>

      {loading && <p className="text-slate-400">Cargando…</p>}

      {!loading && !editing && (
        <Card><p className="text-slate-300">Elegí una landing arriba o creá una nueva.</p></Card>
      )}

      {!loading && editing && (
        <>
          {/* Barra de acciones */}
          <Card className="mb-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <Input value={form.name} onChange={(e) => setField("name", e.target.value)} placeholder="Nombre de la landing" className="!w-64 font-semibold" />
                {current && <div className="mt-1 font-mono text-xs text-slate-500">/{current.slug}{current.published ? " · publicada" : " · borrador"}</div>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" onClick={() => setShowTpl(true)}><LayoutTemplate className="h-4 w-4" /> Plantillas</Button>
                <Button variant="secondary" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" /> Subir .html</Button>
                <input ref={fileRef} type="file" accept=".html,text/html" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadHtml(f); e.target.value = ""; }} />
                {current && <Button variant="secondary" onClick={() => window.open(campaignUrl, "_blank")}><ExternalLink className="h-4 w-4" /> Ver mi sitio</Button>}
                <Button onClick={() => void save()} disabled={saving || !dirty}>{saving ? "Guardando…" : dirty ? "Guardar cambios" : "Sin cambios"}</Button>
                <span id="lp-publish" className="inline-flex">
                  <Button variant="primary" disabled={busyId === editingId || !editingId} onClick={() => void publish()}>
                    {busyId === editingId ? "…" : current?.published ? "Actualizar sitio" : "Publicar"}
                  </Button>
                </span>
              </div>
            </div>
            {current && (
              <>
                <div id="lp-campaign" className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  URL para campañas
                  {current.published
                    ? (campaignUrl.includes("cloudfront.net") && <span className="ml-1 rounded bg-wa-green/15 px-1.5 py-0.5 text-[10px] font-semibold normal-case text-wa-green">dominio propio · aislado</span>)
                    : <span className="ml-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold normal-case text-amber-300">borrador — sin publicar</span>}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <input readOnly value={campaignUrl} className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-300" />
                  <CopyBtn value={campaignUrl} />
                </div>
                {current.published ? (
                  <p className="mt-1 text-[11px] text-slate-500">Esta es la URL que ponés en tus anuncios. {campaignUrl.includes("cloudfront.net") ? "Se sirve desde tu propio dominio (no publi.lat): si Meta bloquea la landing, generá uno nuevo abajo sin afectar tu cuenta." : "Se sirve desde Amazon."}</p>
                ) : (
                  <div className="mt-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
                    ⚠️ Todavía es un <b>borrador</b>. Tocá <b>Publicar</b> (arriba a la derecha) para generar tu <b>URL real con tu dominio propio</b> de CloudFront — esa es la que va en el anuncio. <b>No uses ésta todavía.</b> La primera vez tarda unos minutos en activarse.
                  </div>
                )}
                {reproMsg && <div className="mt-2 rounded-md border border-wa-green/40 bg-wa-green/10 px-3 py-2 text-xs text-wa-green">{reproMsg}</div>}
                <div className="mt-3 flex flex-wrap gap-2">
                  {!current.isPrimary && <Button variant="ghost" onClick={() => void makePrimary()}><Star className="h-4 w-4" /> Marcar principal</Button>}
                  {current.published && campaignUrl.includes("cloudfront.net") && (
                    <Button variant="ghost" disabled={reprovisioning} onClick={() => void reprovision()}>
                      {reprovisioning ? "Generando…" : "🔄 Reprovisionar dominio"}
                    </Button>
                  )}
                  <Button variant="danger" onClick={() => void remove()}><Trash2 className="h-4 w-4" /> Borrar</Button>
                </div>
              </>
            )}
          </Card>

          {/* Editor + vista previa en vivo */}
          <div id="lp-editor" className="grid gap-4 lg:grid-cols-2">
            <Card className="flex flex-col p-0">
              <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-2">
                <div className="inline-flex rounded-md bg-slate-900 p-1 text-xs">
                  <button onClick={() => setMode("fields")} className={`rounded px-3 py-1 font-medium ${mode === "fields" ? "bg-wa-green text-slate-900" : "text-slate-300"}`}>Campos</button>
                  <button onClick={() => setMode("html")} className={`rounded px-3 py-1 font-medium ${mode === "html" ? "bg-wa-green text-slate-900" : "text-slate-300"}`}>HTML</button>
                </div>
                <span className="text-xs text-slate-500">{mode === "html" ? "Editá el HTML libremente" : "Editor por campos (rápido)"}</span>
              </div>
              {mode === "fields" ? (
                <div className="space-y-3 p-4">
                  {([["title", "Título de la pestaña"], ["headline", "Encabezado"], ["subtitle", "Subtítulo"], ["buttonText", "Texto del botón"], ["msg", "Mensaje de WhatsApp"]] as Array<[TextKey, string]>).map(([k, ph]) => (
                    <div key={k}>
                      <label className="mb-1 block text-xs capitalize text-slate-400">{ph}</label>
                      <Input value={form[k]} onChange={(e) => setField(k, e.target.value)} placeholder={ph} />
                    </div>
                  ))}
                  <label className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900/40 p-2.5 text-xs text-slate-300">
                    <input type="checkbox" checked={form.autoRedirect} onChange={(e) => setForm((p) => ({ ...p, autoRedirect: e.target.checked }))} className="h-4 w-4 accent-wa-green" />
                    Redirigir automáticamente a WhatsApp (pasa ~1 seg por la landing y va al chat)
                  </label>
                </div>
              ) : (
                <textarea value={html} onChange={(e) => setHtml(e.target.value)} placeholder="<!doctype html> …"
                  className="h-[28rem] w-full resize-none rounded-b-lg bg-slate-900 px-3 py-2 font-mono text-xs text-slate-100 outline-none" spellCheck={false} />
              )}
            </Card>

            <Card className="flex flex-col p-0">
              <div className="border-b border-slate-800 px-3 py-2 text-xs text-slate-400">Vista previa en tiempo real</div>
              <iframe title="preview" srcDoc={previewHtml} sandbox="allow-scripts" className="h-[28rem] w-full rounded-b-lg bg-white" />
            </Card>
          </div>

          {mode === "html" && html.trim() && (
            <div id="lp-review"><LandingReview html={html} slug={slug} pixelId={pixelId} goLink={`${API_BASE}/go?u=${slug}&msg=${encodeURIComponent(form.msg || "Hola, quiero info")}`} /></div>
          )}
        </>
      )}

      {/* Modal de plantillas */}
      {showTpl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setShowTpl(false)}>
          <div className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">Elegir plantilla</h2>
              <button onClick={() => setShowTpl(false)} className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-5 w-5" /></button>
            </div>
            {(["simple", "full"] as TplCat[]).map((cat) => (
              <div key={cat} className="mb-5">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{cat === "simple" ? "Simples" : "Diseños completos"}</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {tpls.filter((t) => t.category === cat).map((t) => (
                    <div key={t.name} className="overflow-hidden rounded-xl border border-slate-700 bg-slate-950">
                      <div className="relative h-36 overflow-hidden border-b border-slate-800">
                        <iframe title={t.name} srcDoc={t.html} sandbox="" tabIndex={-1}
                          className="pointer-events-none absolute left-0 top-0 origin-top-left"
                          style={{ width: "333%", height: "333%", transform: "scale(0.3)" }} />
                      </div>
                      <div className="p-3">
                        <div className="text-sm font-semibold text-slate-100">{t.name}</div>
                        <p className="mt-0.5 mb-3 text-xs text-slate-400">{t.desc}</p>
                        <Button className="w-full" onClick={() => useTemplate(t)}>Usar esta</Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tour && <OnboardingTour steps={LANDINGS_TOUR} onClose={() => setTour(false)} />}
    </div>
  );
}
