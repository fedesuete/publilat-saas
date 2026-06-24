# Prompt para Claude Code — Landing público de Publi.lat

Pegá el bloque en Claude Code. Construye la web de marketing (publi.lat) — la misma
promesa que ScaleOS (scaleplayllc.com) pero más moderna, rápida y mejor rematada.
El copy ya está adaptado a lo que Publi.lat realmente hace; usalo tal cual o mejoralo.

---

```
Construí el LANDING PÚBLICO de marketing de Publi.lat (la home en publi.lat, NO el panel
que está en app.publi.lat). Objetivo: vender el producto y convertir visitas en registros.
Misma promesa que la referencia (scaleplayllc.com / "ScaleOS") pero más moderno y pulido.

QUÉ VENDE PUBLI.LAT (la promesa):
Convierte los chats de WhatsApp en ventas que Meta entiende. Hoy Meta optimiza por
"mensajes iniciados", no por ventas: cuando alguien te compra por WhatsApp, ese dato nunca
vuelve a Meta. Publi.lat cierra el círculo — rastrea el clic del anuncio, lo lleva a
WhatsApp, y cuando hay venta le devuelve a Meta el evento de COMPRA real por la Conversions
API. Resultado: Meta optimiza por compradores reales y ves tu ROAS de verdad, por campaña,
conjunto y anuncio.

STACK Y UBICACIÓN:
- Mismo monorepo. Creá la landing como página standalone optimizada (puede ser su propia
  app Vite en /landing-web o una ruta pública servida en la raíz; elegí lo más simple de
  desplegar en el dominio publi.lat). React + Vite + TailwindCSS + framer-motion para
  animaciones. 100% responsive (mobile-first). Accesible (a11y) y con buen SEO (meta tags,
  Open Graph, título, descripción, favicon, sitemap básico).
- Performance: lazy-load de imágenes, sin librerías pesadas innecesarias, Lighthouse > 90.

DIRECCIÓN DE DISEÑO (moderno 2025, mejor que el original):
- Dark theme premium: fondo casi negro (#0b141a / slate-950), acentos verde WhatsApp
  (#25D366) con un degradado sutil a verde-lima/teal. Tipografía moderna (Inter o similar),
  jerarquía clara, mucho aire.
- Detalles modernos: glassmorphism sutil en las tarjetas, bordes con gradiente, glow suave
  en los CTA, grid tipo "bento" para las características, contadores animados, fade/slide-in
  on-scroll (framer-motion), un mock visual del dashboard (tarjetas de métricas con números).
- Botón de WhatsApp flotante. Sticky nav con blur. Microinteracciones en hover.
- NO recargar de animaciones: que se sienta rápido y profesional, no un circo.

SECCIONES (en orden):
1. NAV sticky: logo "Publi.lat" (lat en verde), links (Características, Cómo funciona,
   Precios), botón "Ingresar" (-> app.publi.lat/login) y CTA "Crear cuenta" (-> registro).
2. HERO: 
   - Título grande: "Convertí tus chats de WhatsApp en ventas que Meta entiende."
   - Subtítulo: "Optimizá tus campañas por facturación real, no por costo por mensaje.
     El dashboard de atribución que tus anuncios necesitaban."
   - CTAs: "Crear mi cuenta" (primario) y "Ver cómo funciona" (secundario, scroll).
   - Prueba social: "Negocios que ya optimizan con datos reales" + avatares + métrica
     animada (ej "ROAS real en 2 minutos").
   - A la derecha (o debajo en mobile): mock del dashboard con tarjetas (Clics, Chats,
     Ventas, ROAS) y un mini gráfico.
3. PROBLEMA — "¿Cansado de…" (3 tarjetas):
   · Optimizar por mensajes, no por ventas.
   · No saber cuánto vendiste por campaña.
   · Desperdiciar presupuesto en leads que no compran.
4. CÓMO FUNCIONA (4 pasos con un diagrama de embudo):
   1) Link rastreado en tu anuncio. 2) El clic dispara el evento Lead y lleva a WhatsApp.
   3) Tu cliente charla y compra. 4) La venta vuelve a Meta por CAPI -> optimiza por compradores.
5. CARACTERÍSTICAS (bento grid, 6-7):
   · Atribución real con Conversions API (Lead + Purchase con el mismo identificador).
   · ROAS real por campaña, conjunto y anuncio.
   · Multi-línea de WhatsApp con rotación automática (anti-saturación).
   · Inbox unificado: respondé desde el panel, sin tocar el teléfono.
   · CRM kanban: de Nuevo a Comprado, con el monto de cada venta.
   · Dashboard en tiempo real, compartible con tu equipo.
   · Integraciones: nativo, Kommo o webhook a tu CRM.
6. POR QUÉ PUBLI.LAT (diferenciadores, breve): dedup navegador+servidor, pagos con
   MercadoPago/Stripe/USDT, multi-cliente con tu propio Pixel, seguridad de nivel producción.
7. PRECIOS: modelo de "días/créditos" (1 día = 1 línea activa 24 h). Mostrá un plan claro
   con CTA. Si no hay precios finales, poné "Empezá gratis" + "Pagás por lo que usás".
8. TESTIMONIOS (3, estilo tarjetas con estrellas) — usá placeholders realistas LATAM.
9. CTA FINAL: "Dejá de adivinar. Empezá a escalar." + botón "Crear mi cuenta".
10. FOOTER: logo, links, © 2026 Publi.lat, contacto.

COPY: español rioplatense, claro y directo, orientado a beneficio. Headlines cortos.
Evitá tecnicismos en el hero; explicá lo técnico recién en Características.

ENTREGABLE: la landing funcionando localmente (npm run dev), responsive, con los CTA
apuntando a app.publi.lat (login y registro). Hacé typecheck y mostrame el resultado.
Mostrame primero un plan corto (estructura de archivos + paleta + librerías) antes de codear.
```
