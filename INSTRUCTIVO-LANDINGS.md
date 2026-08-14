# 📄 Cómo armar tu landing (y pedírsela a ChatGPT sin errores)

Guía para vos y para tus clientes. Si seguís esto, la landing **mide bien** (Lead + venta atribuidos)
y no pasan los errores típicos.

---

## 🥇 La regla de oro: el botón

**El botón de "hablar por WhatsApp" SIEMPRE apunta a `/go` con tu usuario. Nunca a un número.**

✅ **Bien:**
```
https://app.publi.lat/go?u=TU_SLUG&msg=Hola%2C%20quiero%20info
```
- `TU_SLUG` = tu usuario de Publi.lat (lo ves abajo a la izquierda del panel: `slug: ...`).
- `msg=` = el texto que se pre-carga en WhatsApp (tiene que ir *URL-encoded*: espacio = `%20`, coma = `%2C`).

❌ **Mal (NO hacer):**
- `https://wa.me/595...` → **no dispara el Lead, no guarda el fbclid y duplica contactos.** (Es lo que le pasó a Joaco.)
- Poner el número de teléfono en el código → **no trackea y no rota entre tus líneas.**

**¿Por qué?** El `/go` es el corazón de Publi.lat: dispara el evento **Lead**, guarda de qué anuncio vino
la persona (fbclid), elige tu línea de WhatsApp activa y recién ahí la manda al chat. Si saltás el `/go`,
Meta nunca se entera y la venta no matchea.

---

## 🎯 El Pixel (opcional pero recomendado)

Hay **dos capas** de Pixel y conviene entenderlas:

1. **Pixel de "Mi Pixel"** (server-side / CAPI): es el que cargás en el panel. **Es el que dispara el
   Lead y el Purchase y hace el match con Meta.** Con esto solo, tu atribución **ya funciona**.
2. **Pixel del navegador** (código en el `<head>` de la landing): es **opcional** y suma un poco de
   calidad de match. Al cargar, deja la cookie **`_fbp`**, que Publi.lat manda junto con el Lead. También
   dispara el `PageView`.

Si querés la capa 2, poné en el `<head>` **solo el código base del Píxel** (`init` + `PageView`) con **tu
Pixel ID** — la "Revisión de tu landing" del editor te lo da listo, con tu ID y un botón de copiar.

⚠️ **No agregues un `fbq('track','Lead')` a mano.** Del evento Lead se encarga Publi.lat cuando tocan el
botón (el `/go`). Si lo ponés doble, **duplicás**.

> El `fbp` mejora el match del **Lead**, pero el salto grande de calidad llega con los **Purchase** (que
> mandan el teléfono) y con **volumen** de eventos. Con pocos clics el puntaje de Meta no significa mucho.

> Si en vez de HTML propio usás el editor **"por campos"** de Publi.lat, el pixel y el botón se arman
> solos — no tenés que tocar nada. Esta guía es para cuando querés un diseño custom.

---

## 🔬 Que los eventos LLEGUEN a tu Facebook (modelo: la landing de valentinolocal)

La landing de **valentinolocal** (`publi-1`) es el modelo de referencia: mide bien y factura. Esto es
lo que hace — y lo que TIENE que tener cualquier landing para que los eventos lleguen a **tu** pixel:

**1) El Pixel del navegador tiene que ser TU pixel real.** El error #1 (le pasó a mrchcod): quedó el
pixel de **EJEMPLO** `893375649719739` (el placeholder gris del panel) en vez del pixel propio. Si la
landing dispara al pixel de ejemplo, **los eventos van a un pixel que no es tuyo → nunca los ves en tu
Facebook.** El editor "por campos" pone tu pixel solo; en HTML propio, pegá TU ID.

**2) Cargaste/cambiaste tu pixel DESPUÉS de crear la landing → RE-PUBLICÁ.** Al re-publicar, el sistema
inyecta tu pixel VIGENTE (fix 2026-08-14). Si no re-publicás, la versión online sigue con el pixel viejo.

**3) La landing tiene que MANDAR `_fbp` y `_fbc` al destino** (por la URL). Esas cookies las deja el
pixel en el dominio de la landing y **NO cruzan** a WhatsApp ni a `chat.publi.lat`. Si no las reenviás,
el evento del servidor (CAPI: Lead/Registro/Compra) queda **sin identificadores → matchea mal**. El
editor lo hace solo, tanto para `/go` (WhatsApp) como para `/r/<slug>` (Chat App). (Fix 2026-08-14: el
botón de Chat App no reenviaba `_fbp/_fbc`; ya corregido.) En HTML propio, usá el script de
auto-redirect de más abajo, que ya copia `fbclid` + `_fbp` + `_fbc`.

**4) Un solo `Lead`, con `eventID`.** El `PageView` sale al cargar; el `Lead` sale al tocar el botón,
con un `eventID` para deduplicar con el Lead del servidor. No agregues `fbq('track','Lead')` sueltos.

> **Chat App (`/r/<slug>`):** mismo criterio que `/go` — el botón manda `fbclid` + `_fbp` + `_fbc` al
> registro y ahí el Chat App dispara Lead + Registro + Compra por CAPI a tu pixel (mismo `external_id`).

**Chequeo rápido (2 min):** abrí tu landing publicada → F12 → pestaña **Network** → filtrá
`facebook.com/tr` → tenés que ver `id=<TU_PIXEL>` (¡no el de ejemplo!) y un `PageView`. Tocá el botón:
tiene que salir un `Lead`. Si el `id` no es el tuyo, **RE-PUBLICÁ**.

---

## ♻️ Actualizar una landing que ya tiene anuncios corriendo (no se rompe nada)

Podés editar y **re-publicar** una landing **con los anuncios activos, sin miedo**:
- La **URL NO cambia** al re-publicar (tu dominio CloudFront es el mismo). Solo cambia si tocás
  "Reprovisionar dominio", que es otra cosa.
- Tus anuncios apuntan a esa URL → **siguen andando igual**, ahora con el contenido nuevo.
- Ejemplo típico: sumar el pixel del navegador (arriba) a una landing en vivo → editás, pegás el código,
  **Publicar**, y listo. El diseño y el botón quedan idénticos; solo se agrega el pixel (invisible).

---

## 🤖 Prompt para pedirle la landing a ChatGPT

Copiá esto, reemplazá lo que está en MAYÚSCULAS y pegalo en ChatGPT:

```
Actuá como diseñador web. Necesito una landing page en UN SOLO archivo HTML (con CSS y JS inline,
sin librerías ni recursos externos), responsive y en español, para mi negocio: TU_NEGOCIO.

Objetivo: que la persona toque un botón grande y vaya a WhatsApp.

REGLAS OBLIGATORIAS (no las cambies):
1) El botón principal (y cualquier botón de "hablar por WhatsApp") debe apuntar EXACTAMENTE a:
   https://app.publi.lat/go?u=TU_SLUG&msg=Hola%2C%20quiero%20info
   - NO uses links de wa.me ni pongas ningún número de teléfono en el código.
   - El texto después de msg= podés cambiarlo, pero tiene que ir URL-encoded (espacio = %20).
2) En el <head> incluí SOLO el código base del Píxel de Meta (init + PageView) con este ID: TU_PIXEL_ID.
   NO agregues fbq('track','Lead') ni ningún otro evento: de eso se encarga el sistema.
3) El botón de WhatsApp tiene que ser grande, verde y lo más visible de la página.
   Textos cortos y concretos, para que la persona toque el botón rápido.
4) Todo en un solo archivo, sin fuentes/imágenes por link. Estilos y colores inline.

Devolvé solo el código HTML completo, listo para copiar y pegar.
```

---

## 🚀 Cómo publicarla

1. Panel → **Landings** → **Nueva** → pestaña **HTML propio**.
2. Pegás el código → **Guardar**.
3. Mirá el **semáforo de revisión** del editor: te avisa si el botón está bien o mal.
4. **Publicar** → copiás la URL publicada → esa va en el anuncio de Meta.
5. **Si cambiás algo, RE-PUBLICÁ.** Si no, sigue online la versión vieja.

---

## 🌐 Dónde vive tu landing (importante: NO en publi.lat)

Cuando publicás, tu landing **NO se sirve desde publi.lat**. Cada cliente tiene su **propio dominio
descartable de Amazon CloudFront** (ej: `d3nra60r1pe7xw.cloudfront.net`). Tu página se sube a S3 y se
sirve por ESE dominio, tuyo y aislado.

**¿Por qué así?** (modelo ScaleOS)
- Si Meta llegara a **marcar/quemar** una landing, cae **solo ese dominio** — no publi.lat ni las
  landings de otros clientes.
- Saca el contenido del cliente del origen del panel (más seguro).

**Si Meta te quema el dominio:** en el editor de Landings tenés **"Reprovisionar dominio"** → te genera
un **dominio nuevo y limpio** apuntando a la misma landing, y reapunta tus URLs publicadas
automáticamente. Copiás la URL nueva y la ponés en el anuncio nuevo.

> El **único** componente que vive en `app.publi.lat` es el redirector `/go` (el motor que dispara el
> Lead). La **página** siempre va por tu dominio CloudFront descartable.

### Para el admin: cómo se prende (ya está prendido)
El modelo se activa solo con las credenciales AWS cargadas en el `.env` del servidor
(`AWS_S3_BUCKET`, `AWS_REGION`, `AWS_ACCOUNT_ID`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`). El
bucket es **privado** y CloudFront lo lee por **OAC**. En el primer `Publicar` de cada cliente, el
sistema crea su distribución (`ensureClientCdn`) — tarda ~5-15 min en desplegar la primera vez.
No hace falta `CLOUDFRONT_DOMAIN` (esa variable es para un CDN compartido; acá cada cliente tiene el suyo).

---

## ✅ Checklist final (antes de publicar)

- [ ] El botón va a `https://app.publi.lat/go?u=TU_SLUG&...` (no a wa.me, no a un número).
- [ ] No hay ningún número de teléfono escrito en el código.
- [ ] El Pixel base está con tu ID (y NO hay un `fbq('track','Lead')` de más).
- [ ] Probaste el botón: te lleva a WhatsApp y el lead aparece en tu CRM.
- [ ] Re-publicaste después del último cambio.

---

## ❌ Los 3 errores que NO pueden pasar

| Error | Qué provoca |
|---|---|
| Botón a `wa.me` directo | No dispara el Lead, pierde el fbclid, **duplica contactos** (caso Joaco) |
| Número de teléfono en el código | No trackea y no rota entre tus líneas |
| `fbq('track','Lead')` a mano + el botón | **Duplica** el Lead |

Con el botón por `/go` y el pixel base bien puesto, tu atribución cierra el círculo:
**anuncio → WhatsApp → venta → vuelve a Meta.**

---

## 🔁 Auto-redirect: SIEMPRE llevá el fbclid (si no, perdés la atribución)

Muchas landings redirigen solas a WhatsApp tras unos segundos. **Ojo:** el `fbclid` (el identificador
del clic del anuncio) viene en la URL de la landing (`...?fbclid=xxx`). Si el redirect va a un `/go?u=...`
**fijo**, NO lo copia → el contacto queda **sin atribución** y su venta **no matchea** en Meta.

**La regla:** el botón Y el auto-redirect tienen que **copiar el fbclid** (y `fbp`/`fbc` de las cookies)
de la URL al `/go`. Script que resuelve las dos cosas (poné tu slug y tu mensaje):

```html
<script>
(function(){
  var base = "https://app.publi.lat/go?u=TU_SLUG&msg=Hola%2C%20quiero%20info";
  var here = new URLSearchParams(location.search);
  ["fbclid","campaign","ad","src"].forEach(function(k){ var v=here.get(k); if(v) base+="&"+k+"="+encodeURIComponent(v); });
  function ck(n){ var m=document.cookie.match('(^|;)\s*'+n+'\s*=\s*([^;]+)'); return m?decodeURIComponent(m.pop()):''; }
  var fbp=ck('_fbp'); if(fbp) base+="&fbp="+encodeURIComponent(fbp);
  var fbc=ck('_fbc'); if(fbc) base+="&fbc="+encodeURIComponent(fbc);
  var b=document.querySelector('a[href*="/go?"]'); if(b) b.href=base;                 // botón con atribución
  if (window.self === window.top) setTimeout(function(){ window.location.href=base; }, 3000); // auto-redirect ~3s
})();
</script>
```

- No pongas el auto-redirect en **0 segundos**: Meta penaliza las landings que redirigen al instante
  (lo lee como mala experiencia / cloaking). **~3 s** mostrando el contenido es lo seguro.
- El `if (window.self === window.top)` evita que el redirect corra dentro del **editor** (la vista
  previa vive en un iframe y wa.me no se puede abrir ahí → mostraba "wa.me rechazó la conexión").

## 📊 Entender las métricas (por qué Meta y el CRM no coinciden)

Son **tres cosas distintas**, y es NORMAL que no den el mismo número:

| Métrica | Qué mide |
|---|---|
| **Clic** (Dashboard) | Tocó el botón/link → lo mandamos a WhatsApp. **Cuenta cada hit al `/go`, incluidos bots/crawlers** (Meta y WhatsApp escanean el link). |
| **"Cliente potencial" en Meta** | El **Lead** que Meta atribuyó al anuncio (deduplicado, filtra bots, sólo los que tienen fbclid/fbc). |
| **Chat** (CRM) | La persona **realmente escribió** un mensaje. Siempre es MUCHO menos: mucha gente toca y no escribe. |

**Claves:**
- El **Lead se dispara al CLICKEAR, no al hablar.** Por eso "chats" < "leads" siempre.
- Los **"clics" del Dashboard son más altos** que los leads de Meta porque incluyen bots/crawlers que
  golpean el `/go`. Es esperable.
- Lo que importa para el ROAS: que los clics **reales lleven el fbclid** (ver sección de auto-redirect
  arriba). Si muchos contactos quedan **sin fbclid**, la atribución se está perdiendo → revisá que la
  landing copie el fbclid al `/go`.
- El salto de calidad de match llega con el **Purchase** (que manda el teléfono) y con **volumen**.
