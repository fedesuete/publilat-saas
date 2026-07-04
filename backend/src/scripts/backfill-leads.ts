// Backfill de Leads a Meta CAPI para contactos que nunca dispararon el evento
// (ej: escribieron directo por WhatsApp antes de que capturáramos esos casos).
// Solo últimos 7 días (límite de la CAPI para event_time retroactivo).
// Uso: BACKFILL_EMAIL=cliente@mail.com node dist/scripts/backfill-leads.js
import { prisma } from "../lib/prisma.js";
import { resolveUserPixel } from "../lib/pixel.js";
import { sendCapiEvent } from "../lib/meta-capi.js";

async function main() {
  const email = process.env.BACKFILL_EMAIL;
  if (!email) {
    console.error("[backfill] falta BACKFILL_EMAIL");
    process.exit(1);
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`[backfill] no existe el usuario ${email}`);
    process.exit(1);
  }
  const since = new Date(Date.now() - 6.5 * 24 * 60 * 60 * 1000); // margen bajo los 7 días

  // Contactos de los últimos 7 días que tienen teléfono y NUNCA dispararon un Lead.
  const contacts = await prisma.contact.findMany({
    where: { userId: user.id, createdAt: { gte: since }, phone: { not: null } },
    select: { id: true, externalId: true, phone: true, ctwaClid: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const withLead = await prisma.metaEvent.findMany({
    where: { userId: user.id, eventName: "Lead", contactId: { in: contacts.map((c) => c.id) }, status: "sent" },
    select: { contactId: true },
  });
  const covered = new Set(withLead.map((e) => e.contactId));
  const pending = contacts.filter((c) => !covered.has(c.id));
  console.log(`[backfill] ${email}: ${contacts.length} contactos últimos 7d, ${pending.length} sin Lead enviado`);

  const creds = await resolveUserPixel(user.id, "Lead");
  if (!creds) {
    console.error("[backfill] el usuario no tiene pixel/token configurado");
    process.exit(1);
  }

  let ok = 0, fail = 0;
  for (const c of pending) {
    try {
      const result = await sendCapiEvent({
        eventName: "Lead",
        externalId: c.externalId,
        phone: c.phone ?? undefined,
        actionSource: "business_messaging", // llegaron por WhatsApp
        ctwaClid: c.ctwaClid ?? undefined,
        eventId: c.externalId, // mismo id de siempre -> Meta deduplica si ya existiera
        eventTime: c.createdAt, // hora REAL del primer contacto
        pixelId: creds.pixelId,
        capiToken: creds.capiToken,
      });
      await prisma.metaEvent.create({
        data: { userId: user.id, contactId: c.id, eventName: "Lead", pixelId: result.pixelId, payload: result.payload as object, status: "sent", response: result.response as object },
      });
      ok++;
    } catch (e) {
      fail++;
      console.error(`[backfill] fallo contacto ${c.id}:`, e instanceof Error ? e.message : String(e));
    }
  }
  console.log(`[backfill] listo: ${ok} Leads enviados, ${fail} fallidos`);
}

main()
  .catch((e) => { console.error("[backfill] error:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
