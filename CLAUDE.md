# Publi.lat — SaaS de atribución WhatsApp → Meta Ads

> Contexto del proyecto para Claude Code. Léelo antes de tocar nada.

## Qué es

SaaS inspirado en **ScaleOS** (scaleplayllc.com). Cierra el loop de atribución para
negocios que venden por WhatsApp con tráfico de Meta Ads:

**anuncio Meta → landing rastreada → clic dispara `Lead` → redirige a WhatsApp →
conversación → venta marcada con monto → se envía `Purchase` a Meta por CAPI.**

El valor es que Meta deja de optimizar por "mensajes iniciados" y pasa a optimizar
por **compradores reales** (ROAS real), porque le devolvemos el evento de compra
con el valor y el mismo identificador del clic.

## El loop (corazón del producto — Fase 1)

1. Link rastreado: `/go?u=<usuario>&pixel=<id>&msg=<texto>`
2. El redirector `/go`:
   - lee `fbclid` de la URL y/o cookies `fbp` / `fbc`
   - genera un `external_id` único para el contacto
   - dispara el evento **Lead** (Pixel del navegador + **CAPI** server-side)
   - registra el contacto con su atribución (pixel, campaña, fuente, línea)
   - redirige a `https://wa.me/<linea>?text=<msg + codigo>`
3. El `codigo` (o la línea) permite re-identificar a la persona cuando escribe.
4. La conversación entra al Inbox (Baileys/Evolution); el lead aparece en el CRM.
5. Al pagar, el operador lo marca **Compró** con monto.
6. Se envía **Purchase** por CAPI con el MISMO `external_id`/`fbp`/`fbc` + `value`.
   Meta hace el match y optimiza por compradores.

**Identificadores a persistir por contacto:** `external_id`, `fbp`, `fbc`, `fbclid`,
campaña/ad, línea WA, y un `code` corto para el mensaje. Sin esto, el Purchase no matchea.

## Stack

- **Frontend:** React + Vite + Tailwind
- **Backend:** Node.js + TypeScript + Express + Socket.IO
- **DB:** PostgreSQL + Prisma
- **Colas/jobs:** BullMQ + Redis (reintentos CAPI, vencimiento de tokens, rotación)
- **WhatsApp:** Evolution API (atajo, recomendado) — o Baileys directo
- **Landings:** S3 + CloudFront (o Cloudflare Pages), un prefijo por usuario
- **Meta:** Graph API — Conversions API (server-side), eventos `Lead` y `Purchase`

> Nota infra: las sesiones de WhatsApp necesitan proceso persistente con estado.
> No serverless. Va en un contenedor/VPS dedicado.

## Reglas de negocio clave

- **Días/tokens:** 1 día disponible = 1 línea activa por 24 h. Distribuibles.
  Al vencer, la línea se desactiva automáticamente (cron + BullMQ).
- **Rotación:** el redirector reparte los clics entre las líneas activas.
- **Modos de integración:** nativo / Kommo (webhook) / CRM externo (webhook).

## Orden de construcción (ver KICKOFF.md y roadmap)

F0 setup · **F1 loop de atribución (empezar acá)** · F2 WhatsApp+Inbox ·
F3 CRM+Analytics · F4 multi-línea+billing · F5 landings+integraciones.

## Convenciones

- TypeScript estricto. Validación de input con `zod`.
- Nunca loguear teléfonos/montos en texto plano en producción.
- Eventos a Meta SIEMPRE validados con el **Test Events Tool** antes de dar por hecho el match.
- Secrets sólo por `.env` (ver `.env.example`). No commitear `.env`.
