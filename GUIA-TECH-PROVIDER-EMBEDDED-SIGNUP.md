# Guía paso a paso — Crear app Tech Provider + Embedded Signup (para "tontos")

Objetivo: dejar tu app de Meta lista para que tus CLIENTES conecten su propio WhatsApp con
un botón, y obtener los 3 datos que necesita Publi: **App ID, App Secret y config_id**.

Usá el portafolio **RC Publicidad** (verificado y con WhatsApp aprobado). Agregate como admin
antes de empezar (Configuración del negocio → Usuarios → Personas → Agregar, rol Administrador).

> Los nombres de los menús en Meta cambian seguido. Si no encontrás algo con el nombre exacto,
> buscá una palabra parecida — la lógica es la misma.

---

## PARTE A — Crear la app

**Paso 1.** Entrá a **developers.facebook.com** con tu cuenta de Facebook (la que es admin
del portafolio RC Publicidad).

**Paso 2.** Arriba a la derecha: **Mis Apps** (My Apps) → **Crear app** (Create App).

**Paso 3.** Te pregunta el caso de uso. Elegí **"Otro"** (Other) → **Siguiente**.

**Paso 4.** Tipo de app: elegí **"Empresa" (Business)** → **Siguiente**.

**Paso 5.** Completá:
- Nombre de la app: por ejemplo **"Publi"** (algo neutro, NO pongas "casino").
- Email de contacto.
- **Portafolio comercial:** seleccioná **RC Publicidad**.
- Crear app (te puede pedir tu contraseña de Facebook).

## PARTE B — Anotar App ID y App Secret

**Paso 6.** Ya dentro de la app, andá a **Configuración** (Settings) → **Información básica**
(Basic).

**Paso 7.** Ahí vas a ver:
- **Identificador de la app (App ID)** → copialo. (Es el `META_APP_ID`.)
- **Clave secreta de la app (App Secret)** → tocá **Mostrar**, poné tu contraseña, copialo.
  (Es el `META_APP_SECRET`.) ⚠️ Este es secreto, no lo compartas ni lo pongas en el frontend.

**Paso 8.** En esa misma página, más abajo, completá lo que pidan para poder publicar después:
- **URL de Política de Privacidad** (ej. https://publi.lat/privacidad — vas a necesitar una).
- Dominio de la app: **publi.lat** (cuando esté online).
- Categoría: elegí "Empresas y páginas" o similar.

## PARTE C — Agregar WhatsApp

**Paso 9.** En el menú izquierdo → **Agregar producto** (Add Product) → buscá **WhatsApp** →
**Configurar** (Set up).

**Paso 10.** Te asocia una cuenta de WhatsApp de prueba. No hace falta tocar nada todavía.

## PARTE D — Agregar Facebook Login for Business

**Paso 11.** **Agregar producto** otra vez → **Inicio de sesión con Facebook para empresas**
(Facebook Login for Business) → **Configurar**.

**Paso 12.** En **Configuración** de ese producto → **URI de redirección de OAuth válidos**:
poné la URL de Publi, por ejemplo:
`https://publi.lat/` y `https://publi.lat/configuracion` (ajustá cuando tengas el dominio).
Guardá.

## PARTE E — Crear la configuración de Embedded Signup (el config_id)

**Paso 13.** En el menú izquierdo, dentro de **Inicio de sesión con Facebook para empresas**,
buscá **Configuraciones** (Configurations) → **Crear configuración**.

**Paso 14.** Completá:
- Nombre: "Embedded Signup Publi".
- **Tipo de acceso / Login variation:** elegí la opción de **WhatsApp Embedded Signup**
  (a veces aparece como "WhatsApp Business" o "Onboarding de WhatsApp").
- **Activos / Assets y permisos:** marcá `whatsapp_business_management` y
  `whatsapp_business_messaging`.
- Guardá.

**Paso 15.** Te genera un **ID de configuración (Configuration ID)** → copialo.
(Es el `META_ES_CONFIG_ID`.)

## PARTE F — Registrarte como Tech Provider

**Paso 16.** En el panel de **WhatsApp** de la app, buscá la sección de **Proveedor de
tecnología** (Tech Provider) o la opción de "Solución de socios / Partner". Seguí el
asistente para registrar tu negocio (RC Publicidad) como **Tech Provider**.
(Requiere el negocio verificado — ya lo tenés.)

## PARTE G — App Review (para que funcione con OTROS negocios)

**Paso 17.** Mientras la app está en modo **Desarrollo**, solo funciona con cuentas de prueba
y con admins de la app. Para que tus clientes reales la usen, andá a **Revisión de la app**
(App Review) → **Permisos y funciones**.

**Paso 18.** Pedí **acceso avanzado (Advanced Access)** a:
- `whatsapp_business_management`
- `whatsapp_business_messaging`
- (y `business_management` si lo pide)

**Paso 19.** Completá el formulario de revisión:
- Describí Publi como **"plataforma de atribución y CRM para WhatsApp"** (NEUTRO, sin casino).
- Subí un **video** mostrando el flujo: el cliente entra a Publi, toca "Conectar WhatsApp",
  hace el Embedded Signup y queda conectado.
- Enviá. Meta revisa en días.

## PARTE H — Los datos que le pasás a Publi (.env)

Cuando tengas todo, cargá en el `.env` de Publi:
```
META_APP_ID=...            (Paso 7)
META_APP_SECRET=...        (Paso 7)
META_ES_CONFIG_ID=...      (Paso 15)
META_GRAPH_VERSION=v20.0
WHATSAPP_WEBHOOK_VERIFY_TOKEN=una-palabra-secreta-que-inventes
```

---

## Qué podés hacer HOY (sin esperar nada)
- ✅ Partes A a F: crear la app, sacar App ID, App Secret y config_id, registrarte como Tech Provider.
- ✅ Probar el flujo en **modo desarrollo** con tu propio número/cuenta de prueba.
- ⏳ Parte G (App Review): cuando tengas Publi online + el video del flujo funcionando.
- ⏳ El webhook real: cuando Publi esté deployado con dominio HTTPS.

## Recordatorios
- Usá el portafolio **RC Publicidad** (limpio). Agregate como admin primero.
- Nombre y descripción de la app: **neutros**, nunca "casino" (te pueden rechazar la review).
- El App Secret es SECRETO: solo va en el backend, nunca en el frontend ni en git.
- Cada cliente conecta SU propio WhatsApp con el botón; vos no ponés tu número.
