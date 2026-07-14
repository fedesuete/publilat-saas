// Guardas de la atribución CAPI: evitan que el envío de eventos a Meta se rompa EN SILENCIO.
// 3 protecciones: (1) aviso si quedó un test_event_code en prod; (2) aviso al cliente sin Pixel
// (para NO mandar al pixel global por error); (3) aviso al cliente+admin si sus eventos fallan.
import { prisma } from "./prisma.js";
import { notify } from "./notifications.js";
import { sendAdminMail } from "./mailer.js";

const RECENT = () => new Date(Date.now() - 20 * 60 * 60 * 1000); // dedupe: 1 aviso cada ~20 h

async function notifiedRecently(userId: string, title: string): Promise<boolean> {
  const hit = await prisma.notification
    .findFirst({ where: { userId, title, createdAt: { gte: RECENT() } }, select: { id: true } })
    .catch(() => null);
  return !!hit;
}

// (1) Al boot en producción: si META_TEST_EVENT_CODE está seteado, TODOS los eventos van a
// "Test Events" (no al pixel en vivo). Fue exactamente el incidente del 14-jul. Avisar fuerte.
export async function warnTestEventCodeAtBoot(): Promise<void> {
  const code = (process.env.META_TEST_EVENT_CODE || "").trim();
  if (process.env.NODE_ENV !== "production" || !code) return;
  const msg =
    `META_TEST_EVENT_CODE="${code}" está SETEADO en producción: TODOS los eventos (Lead y Purchase) ` +
    `se envían a la pestaña Test Events de Meta y NO cuentan como conversiones reales. ` +
    `Vaciá META_TEST_EVENT_CODE en /opt/publilat/.env y recreá el contenedor app.`;
  console.error(`\n🔴🔴🔴 [CAPI] ${msg}\n`);
  const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } }).catch(() => []);
  for (const a of admins) await notify(a.id, "system", "⚠️ CAPI en modo TEST (pixel sin datos en vivo)", msg).catch(() => undefined);
  void sendAdminMail("⚠️ CAPI en modo TEST en producción", msg);
}

// (2) El cliente no tiene Pixel configurado: NO mandamos al pixel global (sería fuga de datos a
// otra cuenta). Marcamos el evento como "no_pixel" (el caller) y avisamos al cliente que lo cargue.
export async function notifyMissingPixel(userId: string): Promise<void> {
  const title = "Configurá tu Pixel de Meta";
  if (await notifiedRecently(userId, title)) return;
  await notify(
    userId,
    "system",
    title,
    "Tus leads y ventas NO se están enviando a Meta porque tu cuenta no tiene un Pixel configurado. " +
      "Cargá tu Pixel ID y token de CAPI en el panel (Mi Pixel) para activar la atribución.",
  ).catch(() => undefined);
}

// (3) Eventos que agotaron los reintentos (dead-letter) por errores REALES de envío
// (token vencido/ inválido, pixel mal, etc.) — NO los "no_pixel". Avisa al dueño y al admin.
export async function alertCapiFailures(): Promise<void> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const dead = await prisma.metaEvent
    .groupBy({
      by: ["userId"],
      where: { status: "failed", attempts: { gte: 5 }, createdAt: { gte: since } },
      _count: { _all: true },
    })
    .catch(() => [] as Array<{ userId: string; _count: { _all: number } }>);
  if (!dead.length) return;
  for (const row of dead) {
    const title = "Tus eventos a Meta están fallando";
    if (await notifiedRecently(row.userId, title)) continue;
    await notify(
      row.userId,
      "system",
      title,
      `Algunos eventos de compra/lead no se pudieron enviar a Meta tras varios intentos ` +
        `(posible token o Pixel vencido/ inválido). Revisá tu Pixel en el panel. Afectados: ${row._count._all}.`,
    ).catch(() => undefined);
  }
  void sendAdminMail("CAPI: cuentas con eventos dead-letter", `Cuentas con eventos CAPI fallidos (dead-letter) en 24h: ${dead.length}. Revisar tokens/pixels.`);
}
