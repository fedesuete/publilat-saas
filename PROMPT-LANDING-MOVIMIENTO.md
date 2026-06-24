# Prompt para Claude Code — Hacer la landing de Publi VENDIBLE y con movimiento

Pegá el bloque en Claude Code. La landing actual (publi.lat) está bien estructurada pero
ESTÁTICA y le falta prueba visual. Esto le agrega movimiento con propósito + elementos de
conversión, sin romper el contenido ni el diseño dark/verde actual.

---

```
La landing de Publi (publi.lat) ya existe y está bien estructurada, pero se siente PLANA:
todo aparece quieto, sin movimiento, y no muestra los productos funcionando. Quiero hacerla
vendible. Mantené el diseño actual (dark, acento verde-lima, mobile-first) y el contenido;
sumá MOVIMIENTO CON PROPÓSITO y ELEMENTOS DE CONVERSIÓN. Usá framer-motion (o CSS/Intersection
Observer si preferís liviano). Cuidá performance (Lighthouse > 90) y respetá prefers-reduced-motion.

=== 1. MOVIMIENTO (que se sienta viva, sin marearse) ===
- Hero: entrada en cascada (título -> subtítulo -> CTAs -> stats) con fade+slide. Fondo con
  un gradiente/halo verde que respira lento (animación sutil) o un grid/partículas muy tenues.
- Contadores animados: 10K+, 4 países, 24/7 cuentan desde 0 al entrar en viewport.
- Scroll reveals: cada sección y cada tarjeta de feature entra con fade+slide-up escalonado
  (stagger) cuando aparece. Nada debe aparecer de golpe.
- Hover vivo en tarjetas: leve elevación, glow del borde verde y movimiento del ícono.
- Botones CTA: glow pulsante sutil + micro-scale al hover/click.
- Sección de productos: que el bloque de cada producto haga un "sticky scroll" o el mockup
  se deslice/parallaxee mientras leés los features al costado.
- Transición suave de scroll y aparición del nav con blur al bajar.

=== 2. PRUEBA VISUAL (lo que más convierte y hoy falta) ===
- Mostrá CADA producto con un mockup/captura: marco de navegador o de celular con una imagen
  o componente animado del panel (Cajeros App, CRM kanban, Chat Cajero, Bot IA). Si no hay
  capturas reales todavía, generá mockups con datos de ejemplo (placeholders realistas) y
  dejalos listos para reemplazar por screenshots reales.
- Hero: agregá un mock del dashboard con tarjetas (Clics, Chats, Ventas, ROAS) y un mini
  gráfico que se dibuja al entrar.
- Demo animada del flujo: un pequeño "chat de WhatsApp" que se va escribiendo solo
  (mensajes que aparecen) mostrando lead -> comprobante -> carga acreditada.

=== 3. CONVERSIÓN (elementos que faltan) ===
- Una franja "marquee" animada de logos/países/medios de pago que se desliza en loop.
- Testimonios reales en tarjetas con foto, nombre, rol y estrellas (placeholders por ahora),
  en un carrusel con autoplay suave.
- Sección "Cómo funciona" con un diagrama de 4 pasos que se anima/conecta al hacer scroll.
- FAQ con acordeón animado (abrir/cerrar suave).
- CTA final a pantalla completa con fondo animado y un solo botón dominante "Pedí una demo".
- Botón flotante de WhatsApp con número REAL (reemplazar el placeholder +595 981 000 000).
- Un único CTA primario claro y repetido ("Pedí una demo"); el secundario más discreto.

=== 4. DETALLES ===
- Reemplazá TODOS los placeholders (teléfono, email si es de prueba).
- Marcá visualmente como "Próximamente" cualquier feature que todavía no esté funcionando,
  para no sobre-prometer en la demo.
- Mantené el copy actual salvo ajustes menores para los nuevos bloques.

Mostrame primero un plan corto (qué animaciones, qué librería, qué secciones nuevas) antes
de codear. Después implementá y dejame la landing corriendo para verla.
```
