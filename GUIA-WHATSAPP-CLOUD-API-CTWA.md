# Guía paso a paso — Setup de WhatsApp Cloud API + CTWA (para adelantar)

Hacé esto mientras Claude Code programa el soporte de Cloud API. Cuando el código esté listo,
solo vas a tener que pegar los datos en Publi. Tiempo total: ~1-2 h de trabajo + 2-10 días
de espera por la verificación.

> Lo único que NO podés terminar hasta que Publi esté deployado online es el WEBHOOK (paso 6),
> porque necesita la URL pública de Publi. Todo lo demás lo dejás listo ahora.

---

## PASO 1 — Business Portfolio (Portafolio comercial)
1. Entrá a **business.facebook.com** con tu cuenta de Facebook.
2. Si no tenés, creá un **Portafolio comercial** (antes "Business Manager"):
   nombre del negocio (ej. "Publi"), tu nombre y tu email de trabajo.
3. Anotá el **ID del portafolio** (Configuración del negocio → Información del negocio).

## PASO 2 — Verificación del negocio (arrancala YA, es lo que más tarda)
1. En business.facebook.com → **Configuración del negocio** → **Centro de seguridad**
   (o "Security Center") → **Verificación del negocio** → **Iniciar verificación**.
2. Cargá los datos de tu empresa de Paraguay:
   - Nombre legal, dirección, teléfono.
   - **Documento:** RUC / constancia de la empresa + una factura de servicio a nombre del negocio.
3. Meta tarda **2 a 10 días hábiles**. Por eso conviene empezar hoy.
   (Podés seguir con los pasos de abajo mientras se aprueba.)

## PASO 3 — App en Meta for Developers + producto WhatsApp
1. Entrá a **developers.facebook.com** → **My Apps** → **Create App**.
2. Tipo: **Business**. Asociala a tu Portafolio comercial.
3. Dentro de la app → **Add Product** → **WhatsApp** → **Set up**.
4. Te va a aparecer un **número de prueba** y un **token temporal**: sirven para testear
   YA, antes de cargar tu número real.

## PASO 4 — Datos que necesita Publi (anotalos)
En el panel de WhatsApp de la app (sección "API Setup" / "Configuración de la API"):
- **Phone Number ID** (ID del número de teléfono)
- **WhatsApp Business Account ID (WABA ID)**
- **Access Token** — el temporal sirve para probar; para producción generá un
  **token permanente** con un **System User**:
  · Configuración del negocio → Usuarios → **Usuarios del sistema** → Crear (rol Admin).
  · Asignale la app y la cuenta de WhatsApp.
  · **Generar token** con permisos: `whatsapp_business_messaging`, `whatsapp_business_management`.
  · Copialo y guardalo (no se vuelve a mostrar).

## PASO 5 — Registrar tu número real
1. En el panel de WhatsApp → **Add phone number**.
2. Usá un número que **NO esté en un WhatsApp normal/Business app** (si lo está, hay que
   borrarlo de ahí primero).
3. Verificá por SMS o llamada. Poné el **nombre para mostrar** del negocio.
4. Ese número pasa a tener su propio Phone Number ID (el que va a Publi).

## PASO 6 — Webhook (esto recién cuando Publi esté online)
1. Necesitás la URL pública de Publi: `https://TU-DOMINIO/api/wa/cloud/webhook`.
2. En la app → WhatsApp → **Configuration** → **Webhook** → **Edit**:
   - **Callback URL:** la de arriba.
   - **Verify token:** una palabra secreta que vos inventás (la misma que cargás en Publi).
3. Suscribite a los campos: **messages** (mensajes entrantes con el referral/ctwa_clid).

## PASO 7 — Conectar el Pixel + CAPI for Business Messaging (atribución CTWA)
1. Entrá al **Administrador de Eventos** (Events Manager) en business.facebook.com.
2. Tu **dataset/Pixel** → **Configuración** → buscá **Conjuntos de datos / Mensajería**.
3. Vinculá tu **cuenta de WhatsApp (WABA)** con el dataset → esto habilita la
   **Conversions API for Business Messaging** (lo que usa el ctwa_clid).
4. Generá/copiá el **token de CAPI** del dataset (es el que ya usás para el pixel).

## PASO 8 — Probar (cuando el código esté)
1. En la app → WhatsApp → **API Setup** está el **Test Events / Sandbox**.
2. Mandá un mensaje de prueba; verificá en el **Test Events Tool** que el evento Lead
   llegue con `action_source = business_messaging` y el `ctwa_clid`.

---

## Qué podés terminar HOY (sin esperar a Claude Code ni al deploy)
- ✅ Paso 1: Portafolio comercial.
- ✅ Paso 2: **Iniciar la verificación** (lo más importante — tarda días).
- ✅ Paso 3: Crear la app + producto WhatsApp.
- ✅ Paso 4: Anotar Phone Number ID, WABA ID y generar el token permanente.
- ✅ Paso 5: Registrar tu número real.
- ✅ Paso 7: Vincular WhatsApp con el Pixel/dataset.
- ⏳ Paso 6 (webhook) y Paso 8 (test): cuando Publi esté deployado y el código listo.

## Datos finales que vas a pegar en Publi
- Phone Number ID
- WABA ID
- Access Token (permanente)
- Verify token (el que inventaste)
- Pixel ID + token de CAPI (ya los tenías para el flujo de landing)

## Nota importante
- Para escalar, necesitás la **verificación aprobada** (paso 2): pasás de 250 a 1.000+
  mensajes/día. Sin eso, solo testeás.
- Esto se hace **con tu empresa de Paraguay** (RUC) — no necesitás LLC.
