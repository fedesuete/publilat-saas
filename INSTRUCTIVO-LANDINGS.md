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
