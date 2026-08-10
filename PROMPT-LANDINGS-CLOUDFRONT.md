# Prompt para Claude Code — Landings aisladas en S3 + CloudFront (anti-quemado, modelo ScaleOS)

Contexto (evidencia real de ScaleOS): sus landings NO viven en su dominio del SaaS. Las sirven
desde **AWS CloudFront** con un dominio random por cliente (ej. `d50ti8siiv08j.cloudfront.net`),
con el HTML en **S3** bajo un path por cliente (`scaleboxplay-matias/index.html`) y tracking por
**API Gateway**. La URL que ponen en el anuncio de Meta es la de CloudFront. Así, si Meta quema una
landing, quema **solo ese dominio de CloudFront** — no el dominio del SaaS ni las landings de otros
clientes.

Publi hoy sirve las landings desde `app.publi.lat/p/:slug` (patrón riesgoso: un cliente de casino
quemado puede quemar `app.publi.lat`). Ya existe scaffolding de S3/CloudFront (`backend/src/lib/s3.ts`,
envs `AWS_S3_BUCKET`, `CLOUDFRONT_DOMAIN`, etc.). Objetivo: **publicar cada landing en S3 y servirla
por una distribución de CloudFront AISLADA por cliente**, sacando las landings de ad-traffic de `publi.lat`.

---

```
Implementá publicación de landings en S3 + CloudFront con dominio AISLADO por cliente, replicando el
modelo de ScaleOS. Primero LEÉ: backend/src/lib/s3.ts, backend/src/routes/landings.ts,
backend/src/routes/landing.ts, backend/src/lib/landing-template.ts, el schema de Prisma y el .env.example.

=== 1) Modelo de datos ===
- En el modelo de cliente (User): agregá cloudfrontDomain (string?, ej "d50ti8siiv08j.cloudfront.net"),
  cloudfrontDistId (string?), s3Prefix (string, default = slug del cliente).
- En Landing: agregá publishedUrl (string?, la URL final de campaña en CloudFront) y publishedAt.

=== 2) Publicación en S3 (por landing, path por cliente) ===
- Al "Publicar" una landing, generá el HTML ESTÁTICO final (reusá landing-template.ts) y subilo a
  S3 en: {AWS_S3_BUCKET}/{client.s3Prefix}/{landing.slug}/index.html (Content-Type text/html,
  cache-control corto). El HTML estático debe ser autosuficiente (no depender de que el backend lo
  renderice en vivo).
- Invalidá el path en CloudFront tras subir (CreateInvalidation) para refrescar.

=== 3) Tracking embebido en el HTML estático (clave: la landing vive en CloudFront, no en el backend) ===
El HTML estático debe, del lado del cliente:
  a. Cargar el Meta Pixel del cliente (pixelId) y disparar PageView + Lead con un eventID.
  b. Capturar fbclid/fbp/fbc de la URL/cookies.
  c. Hacer un POST a un endpoint PÚBLICO de Publi (ej. https://app.publi.lat/api/track/lead) con
     {userSlug, pixelId, fbclid, fbp, fbc, eventId, campaign, ad, src} para que el backend:
       - persista el Contact con la atribución (como hace hoy /go),
       - dispare el Lead por CAPI (mismo eventID -> dedup con el Pixel del navegador),
       - devuelva el número de WhatsApp destino (rotación de líneas) + el código corto.
  d. Redirigir a wa.me/{numero}?text={msg + código} (como hace hoy el redirector /go).
- O sea: mover la lógica de /go (routes/go.ts) a un endpoint /api/track/lead consumible por CORS
  desde el dominio de CloudFront. Mantené /go como está para compatibilidad.
- CORS: permití el origen de CloudFront (o *) SOLO para /api/track/lead.

=== 4) CloudFront aislado por cliente ===
- Opción A (recomendada, automática): al crear/activar un cliente (o al primer publish), aprovisioná
  una distribución de CloudFront por cliente vía AWS SDK (CloudFront CreateDistribution) con origin =
  el bucket S3 y OriginPath = /{client.s3Prefix}. Guardá el Domain (xxxx.cloudfront.net) y el Id en
  cloudfrontDomain/cloudfrontDistId. Esa es la magia del aislamiento: cada cliente = su propio dominio.
- Opción B (fallback manual): si no querés auto-provisionar, permití cargar a mano por cliente el
  cloudfrontDomain (creado por vos en AWS). El resto funciona igual.
- La "URL PARA CAMPAÑAS" que muestra el panel debe ser:
  https://{client.cloudfrontDomain}/{landing.slug}/?pixel=...&msg=...&campaign=...  (NUNCA publi.lat)

=== 5) Recuperación de quemado (burn recovery) ===
- Agregá una acción "Reprovisionar dominio" por cliente: crea una NUEVA distribución CloudFront
  (nuevo dominio), re-publica las landings del cliente ahí, y actualiza publishedUrl. Así, cuando
  Meta quema un dominio, el cliente salta a uno nuevo sin tocar a los demás.

=== 6) Sacar las landings de ad-traffic de publi.lat ===
- El /p/:slug del backend queda SOLO como preview interno (no para anuncios). La URL de campaña
  siempre es la de CloudFront. Documentalo en la UI ("esta es tu URL para los anuncios").

=== 7) Config / envs ===
- Reutilizá AWS_REGION, AWS_S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY. Agregá
  CLOUDFRONT_AUTO_PROVISION=true|false. Documentá en .env.example.
- Instalá @aws-sdk/client-s3 y @aws-sdk/client-cloudfront en backend.

=== 8) Calidad ===
- typecheck backend + build frontend, migración incluida. No rompas el flujo actual de /go ni /p/:slug.
- Probá el flujo: publicar -> HTML en S3 -> URL de CloudFront -> abrir -> dispara Lead (Pixel+CAPI) ->
  redirige a wa.me. Y "Reprovisionar dominio" genera un dominio nuevo.

Entregá: migración, endpoints /api/track/lead y publish, integración S3+CloudFront (auto y manual),
UI con la URL de campaña de CloudFront + botón "Reprovisionar dominio", y .env.example actualizado.
```

---

## Notas para fede (no van en el prompt)
- **El aislamiento real lo da "una distribución de CloudFront por cliente"** (dominio propio por cliente),
  como hace ScaleOS. Un solo CloudFront global compartido NO aísla (si se quema, caen todos).
- Costo: CloudFront + S3 es baratísimo (centavos por landing). Auto-provisionar distribuciones tiene
  un pequeño delay (tardan minutos en desplegarse la primera vez).
- Para clientes que puedan, el **CTWA directo (anuncio → WhatsApp sin landing)** evita el dominio por
  completo — es el complemento ideal.
- Ojo AWS: para servir HTML desde S3 vía CloudFront usá OAC (Origin Access Control) y el bucket privado,
  o S3 website endpoint. Que Claude Code use el patrón estándar.
