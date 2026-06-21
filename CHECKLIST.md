# ☀️ Checklist de la mañana — Publi.lat

Lo que avancé de noche (Fases 1 y 2) y lo que te queda hacer a mano.

## Estado al cierre

- ✅ **Fase 1** completa y verificada contra Meta (Lead + Purchase con el mismo
  `external_id`; landing con dedup navegador + servidor, *Deduplicados* en Test Events).
- ✅ **Fase 2 backend** completa: líneas de WhatsApp, QR, webhook de mensajes entrantes
  (match por `code`), Inbox (enviar/recibir), todo por Socket.IO. Probado a nivel API.
- ✅ **Bug resuelto**: Evolution no generaba QR por versión vieja de WhatsApp Web
  (error 405). Fijé `CONFIG_SESSION_PHONE_VERSION` en `docker-compose.yml` y ahora el QR
  se genera bien.
- ✅ **Frontend (panel)**: login/registro, Leads (+marcar compra), Inbox, WhatsApp (QR),
  Links. Compila con `npm run build`.

## Cómo levantar todo

```bash
# 1. Servicios (si no están corriendo)
cd publilat-saas
docker compose up -d            # postgres, redis, evolution

# 2. Backend
cd backend
npm run dev                     # API en http://localhost:4000

# 3. Frontend (otra terminal)
cd frontend
npm install                     # si no lo corriste aún
npm run dev                     # panel en http://localhost:5173
```

Usuario de prueba ya creado: **demo@publi.lat** / **demo1234!** (o registrá uno nuevo).

## Lo que SÓLO podés hacer vos (requiere tu teléfono)

1. **Conectar la línea de WhatsApp** (5 min):
   - Panel → **WhatsApp** → **Crear línea** (poné un nombre, ej. "Principal").
   - Aparece el QR. Abrí WhatsApp en el celu → **Dispositivos vinculados** →
     **Vincular un dispositivo** → escaneá el QR.
   - El estado debería pasar a **conectado** (punto verde) solo, vía Socket.IO.
   - Si el QR expira, tocá **Conectar / Ver QR** para refrescar.

2. **Probar el loop real de punta a punta**:
   - Panel → **Links** → copiá el **Link directo** (o la **Landing**).
   - Abrílo en el navegador del celu (idealmente con `?fbclid=...` para simular un clic
     de anuncio). Te manda a WhatsApp con un mensaje que incluye `(ref: CODE)`.
   - Enviá ese mensaje a tu propia línea conectada.
   - En el panel → **Inbox**: debería aparecer la conversación asociada al lead, que pasa
     a **CONTACTADO**. Respondé desde el panel para confirmar el envío saliente.
   - Marcá **Marcó compra** en **Leads** con un monto → se dispara el **Purchase** a Meta.

3. **(Opcional) Endurecer seguridad**:
   - Cambiá `AUTHENTICATION_API_KEY` en `docker-compose.yml` y `EVOLUTION_API_KEY` en
     `backend/.env` por una clave propia (y `docker compose up -d evolution-api`).
   - Cambiá `JWT_SECRET` en `backend/.env` por un secreto largo.

## Si el QR no aparece otra vez (error 405)

WhatsApp invalida versiones viejas cada tanto. Actualizá la versión:
1. Mirá la actual en
   `https://raw.githubusercontent.com/WhiskeySockets/Baileys/master/src/Defaults/baileys-version.json`
2. Ponela en `docker-compose.yml` → `CONFIG_SESSION_PHONE_VERSION=2.3000.XXXXXXXXX`
3. `docker compose up -d evolution-api`

## Próximos pasos sugeridos (cuando vuelvas)

- **F3 — CRM + Analytics**: kanban por etapa, dashboard de ROAS (gasto Meta vs. ventas).
- **Hardening**: reintentos de CAPI con BullMQ, rate-limit en `/go` y auth, dedup de Purchase.
- **F4 — Multi-línea + billing**: rotación de líneas en `/go`, sistema de días/tokens.
