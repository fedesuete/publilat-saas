# KICKOFF — Prompt de arranque para Claude Code

Abrí esta carpeta (`publilat-saas/`) en VS Code con Claude Code y pegá el bloque de
abajo como primer mensaje. Ya está todo el contexto en `CLAUDE.md`.

---

## 📋 Prompt para pegar en Claude Code

```
Sos el desarrollador principal de Publi.lat, un SaaS de atribución WhatsApp → Meta Ads.
Leé CLAUDE.md antes de empezar: ahí está el producto, el stack y el loop de atribución.

Estado actual: el scaffold ya existe (backend Express+TS+Prisma+Socket.IO, frontend
Vite+React, schema Prisma completo, redirector /go y módulo meta-capi.ts como base).

Quiero que completes la FASE 1 (loop de atribución), que es el corazón del MVP.
Trabajá en orden y andá probando cada paso:

1. Dejá el backend corriendo:
   - Configurá Prisma (cliente en src/lib/prisma.ts), corré `prisma migrate dev`.
   - Verificá que `npm run dev` levante la API en :4000 y /health responda.

2. Auth mínima:
   - POST /api/auth/register y /api/auth/login (JWT). Hash de password con bcrypt.
   - Middleware para proteger rutas /api/*.

3. Completá el redirector /go (src/routes/go.ts):
   - Resolvé el usuario por el parámetro `u` (slug/landing).
   - Persistí el Contact con TODA la atribución (externalId, fbp, fbc, fbclid,
     campaignId, source, pixelId, code, stage=NUEVO).
   - Dispará el evento Lead por CAPI (ya está sendCapiEvent) y logueá el MetaEvent.
   - Redirigí a wa.me con el msg + código.

4. Endpoints de leads:
   - GET /api/leads (lista con su atribución).
   - POST /api/leads/:id/purchase  { amount, currency } ->
       marca stage=COMPRO, guarda amount/purchasedAt y
       ENVÍA el evento Purchase por CAPI con el MISMO externalId/fbp/fbc + value.

5. Verificación (obligatoria):
   - Usá META_TEST_EVENT_CODE y el Test Events Tool de Meta.
   - Probá: abrir /go?... -> confirmar Lead recibido -> marcar purchase ->
     confirmar Purchase recibido y que matchee (Event Match Quality).
   - Escribí un script o test que ejecute el flujo end-to-end.

Reglas:
- TypeScript estricto, validá input con zod.
- No loguees teléfonos/montos en texto plano.
- No toques nada de Fases 2-5 todavía (WhatsApp, billing, landings). Sólo Fase 1.
- Cuando termines, actualizá el README con cómo probar el loop.

Empezá por el paso 1 y mostrame el plan antes de codear.
```

---

## Después de la Fase 1

Seguí con el roadmap (ver `ScaleOS_Plan_Tecnico.docx`):

- **F2 WhatsApp + Inbox** — integrar Evolution API o Baileys; QR por Socket.IO;
  asociar mensajes entrantes al lead por el `code`.
- **F3 CRM + Analytics** — kanban de etapas, agenda, dashboard de ROAS.
- **F4 Multi-línea + billing** — rotación de líneas, sistema de días/tokens, pagos.
- **F5 Landings + integraciones** — editor/host S3+CloudFront, modos Kommo/webhook.

## Setup de servicios locales (antes de arrancar)

```bash
# Postgres y Redis con Docker (rápido)
docker run -d --name publilat-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
docker run -d --name publilat-redis -p 6379:6379 redis:7

# Luego: cp .env.example .env  y completar META_PIXEL_ID + META_CAPI_TOKEN
```
