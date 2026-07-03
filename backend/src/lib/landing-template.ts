// Generador de HTML de landing rastreada (compartido por la demo /l/:slug y las
// landings guardadas /p/:slug del editor). Hornea el Pixel del navegador + un CTA que
// dispara Lead por browser y redirige a /go con el mismo eventID (dedup browser+server).

export interface LandingConfig {
  pixelId: string;
  userSlug: string; // para el CTA -> /go?u=<userSlug>
  goBase: string; // base del backend (ej http://localhost:4000)
  title: string;
  headline: string;
  subtitle: string;
  buttonText: string;
  msg: string; // texto que se manda a WhatsApp
  autoRedirect?: boolean; // si true, redirige solo a WhatsApp tras ~1 seg
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderTrackedLanding(cfg: LandingConfig): string {
  // El JSON va dentro de <script>; escapamos "<" para no cerrar el tag.
  const json = JSON.stringify({
    slug: cfg.userSlug,
    msg: cfg.msg,
    goBase: cfg.goBase,
    autoRedirect: !!cfg.autoRedirect,
  }).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(cfg.title)}</title>
<!-- Meta Pixel (navegador) -->
<script>
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${esc(cfg.pixelId)}');
fbq('track', 'PageView');
</script>
<noscript><img height="1" width="1" style="display:none"
src="https://www.facebook.com/tr?id=${esc(cfg.pixelId)}&ev=PageView&noscript=1"/></noscript>
<!-- End Meta Pixel -->
<style>
  *{box-sizing:border-box} body{margin:0;font-family:system-ui,Segoe UI,Roboto,sans-serif;
    background:#0b141a;color:#e9edef;display:flex;min-height:100vh;align-items:center;justify-content:center}
  .card{max-width:440px;width:90%;text-align:center;padding:44px 28px;background:#111b21;
    border:1px solid #222d34;border-radius:16px}
  h1{font-size:26px;margin:0 0 10px} p{color:#8696a0;margin:0 0 28px;line-height:1.55}
  button{width:100%;border:0;border-radius:999px;padding:16px;font-size:17px;font-weight:600;
    background:#25d366;color:#03301a;cursor:pointer}
  button:active{transform:scale(.99)} .wa{margin-right:8px}
  small{display:block;margin-top:18px;color:#54656f}
</style>
</head>
<body>
  <div class="card">
    <h1>${esc(cfg.headline)}</h1>
    <p>${esc(cfg.subtitle)}</p>
    <button id="cta"><span class="wa">🟢</span>${esc(cfg.buttonText)}</button>
    <small id="hint">Te redirigimos a WhatsApp de forma segura.</small>
  </div>
<script>
  var CFG = ${json};
  function getCookie(name){
    var m = document.cookie.match('(^|;)\\\\s*' + name + '\\\\s*=\\\\s*([^;]+)');
    return m ? decodeURIComponent(m.pop()) : '';
  }
  function newEid(){
    try { return crypto.randomUUID(); } catch(e){ return 'eid-' + Date.now() + '-' + Math.round(Math.random()*1e9); }
  }
  var redirected = false;
  function goToWhatsApp(){
    if (redirected) return; redirected = true;
    var eid = newEid();
    try { fbq('track', 'Lead', {}, { eventID: eid }); } catch(e){}
    var p = new URLSearchParams();
    p.set('u', CFG.slug);
    p.set('msg', CFG.msg);
    p.set('eid', eid);
    var fbp = getCookie('_fbp'); if (fbp) p.set('fbp', fbp);
    var fbc = getCookie('_fbc'); if (fbc) p.set('fbc', fbc);
    var here = new URLSearchParams(location.search);
    ['fbclid','campaign','ad','src'].forEach(function(k){
      var v = here.get(k); if (v) p.set(k, v);
    });
    var target = CFG.goBase + '/go?' + p.toString();
    setTimeout(function(){ window.location.href = target; }, 300);
  }
  document.getElementById('cta').addEventListener('click', goToWhatsApp);
  // Redirección automática: pasa ~1 seg por la landing (deja disparar el PageView) y va a WhatsApp.
  if (CFG.autoRedirect) {
    var h = document.getElementById('hint');
    if (h) h.textContent = 'Redirigiendo a WhatsApp…';
    setTimeout(goToWhatsApp, 1000);
  }
</script>
</body>
</html>`;
}
