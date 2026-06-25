# Prompt para Claude Code — Páginas legales (privacidad, términos, eliminación de datos)

Pegá el bloque en Claude Code. Crea y sirve públicamente las 3 páginas legales que pide la
App Review de Meta, con el estilo dark/verde de Publi.

---

```
Creá 3 páginas legales públicas para Publi y servilas como HTML estático en estas rutas
(deben ser accesibles sin login y con HTTPS en producción):
- /privacidad           -> Política de Privacidad
- /terminos             -> Términos del Servicio
- /eliminacion-datos    -> Instrucciones de eliminación de datos

Requisitos técnicos:
- Estilo dark con acento verde WhatsApp (#25d366), igual al resto de Publi. Responsive.
- Servilas desde el backend Express como rutas públicas (antes del fallback del SPA), o como
  archivos en frontend/public, lo que sea más simple de desplegar en publi.lat. Que NO requieran
  auth. Agregá los <link> en el footer del landing público y del panel.
- Empresa: "Publi" operado por "RC Publicidad". Email de contacto: hola@publi.lat
  (dejalo como variable fácil de cambiar). Fecha: "Última actualización: 24 de junio de 2026".

CONTENIDO — Política de Privacidad (/privacidad):
1. Quiénes somos: Publi es una plataforma SaaS de atribución de marketing, CRM e integración
   con WhatsApp, en publi.lat y app.publi.lat.
2. Datos que recopilamos: datos de cuenta (nombre, email, teléfono, negocio); datos de
   contactos/leads (teléfono, nombre, mensajes, etapa); datos de WhatsApp vía la API oficial de
   Meta (identificadores de la WABA, número, mensajes); datos de atribución de Meta (fbclid, fbp,
   fbc, ctwa_clid, campaña/anuncio, eventos de conversión vía Pixel y Conversions API); datos
   técnicos (IP, navegador, cookies, logs).
3. Uso: operar el servicio (mensajes, CRM, reportes), enviar eventos de conversión a Meta,
   autenticación y seguridad, soporte y mejora del producto.
4. Autorización: al conectar WhatsApp/Meta, el usuario nos autoriza a procesar esos datos en su
   nombre; el usuario es responsable de informar a sus contactos y obtener consentimientos.
5. Cómo compartimos: no vendemos datos; compartimos con Meta Platforms (integración WhatsApp y
   eventos), proveedores de infraestructura (hosting/DB bajo confidencialidad) y autoridades si la
   ley lo exige.
6. Conservación: mientras la cuenta esté activa o lo exija la ley; baja a pedido.
7. Derechos: acceso, corrección y eliminación escribiendo a hola@publi.lat.
8. Eliminación de datos: link a /eliminacion-datos.
9. Seguridad: medidas técnicas razonables (cifrado de credenciales, control de accesos, logs).
10. Cookies: necesarias para funcionamiento y seguridad.
11. Cambios: se publican en esta página con su fecha.
12. Contacto: Publi — RC Publicidad, hola@publi.lat.
Al pie: aclaración de que es un modelo general y no asesoramiento legal.

CONTENIDO — Términos del Servicio (/terminos):
1. Aceptación: al usar Publi aceptás estos términos.
2. Descripción: plataforma SaaS de atribución, CRM e integración con WhatsApp.
3. Cuenta: sos responsable de tus credenciales y del uso de tu cuenta.
4. Uso aceptable: prohibido usar el servicio para spam, fraude, contenido ilegal o violar las
   políticas de Meta/WhatsApp (incluida la WhatsApp Business Messaging Policy y Commerce Policy).
   El usuario es el único responsable del contenido que envía y de cumplir las leyes y políticas
   aplicables a su actividad.
5. Integraciones de terceros: el uso de WhatsApp y Meta se rige también por los términos de esos
   proveedores; Publi no se responsabiliza por suspensiones que Meta aplique a la cuenta del usuario.
6. Pagos: si aplica, los créditos/planes se rigen por lo informado al contratar; no reembolsables
   salvo que la ley diga lo contrario.
7. Disponibilidad: el servicio se ofrece "tal cual", sin garantías de disponibilidad ininterrumpida.
8. Limitación de responsabilidad: en la máxima medida permitida por ley.
9. Terminación: podemos suspender cuentas que violen estos términos.
10. Cambios y ley aplicable: podemos actualizar los términos; se publican con su fecha.
11. Contacto: hola@publi.lat.
Al pie: aclaración de modelo general / no asesoramiento legal.

CONTENIDO — Eliminación de datos (/eliminacion-datos):
- Explicá cómo un usuario o sus contactos pueden pedir la eliminación de sus datos:
  enviar un email a hola@publi.lat con asunto "Eliminación de datos" indicando el email de la
  cuenta (o el número de teléfono del contacto). Procesamos la baja y eliminamos la información
  asociada en un plazo razonable, salvo lo que debamos conservar por ley.
- Mencioná que al eliminar la cuenta se borran los datos de WhatsApp y atribución vinculados.
- (Opcional) Si querés, dejá preparado un endpoint POST /api/data-deletion que reciba el pedido
  y lo registre, pero la vía por email alcanza para la review.

Hacé las 3 páginas, agregá los links en los footers, verificá que carguen sin login y hacé typecheck.
```
