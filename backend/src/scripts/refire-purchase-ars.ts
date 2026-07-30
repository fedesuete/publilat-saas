// Re-envía a Meta el Purchase de los contactos COMPRO de un usuario, en ARS y con un eventId NUEVO.
// POR QUÉ eventId nuevo: Meta DEDUPLICA por (event_name + event_id). Re-enviar con el mismo id que
// el evento viejo (que salió en PYG) NO cambia nada — Meta se queda con el primero. Con un id nuevo
// (`:purchase:ars`) el evento en ARS SÍ entra. Idempotente en re-corridas (mismo id `:ars`).
// Uso puntual para corregir los Purchase de victor que salieron en PYG por error.
//   BACKFILL_SLUG=victor            node dist/scripts/refire-purchase-ars.js   # dry-run
//   BACKFILL_SLUG=victor APPLY=1    node dist/scripts/refire-purchase-ars.js   # envía
import { prisma } from "../lib/prisma.js";
import { resolveUserPixel } from "../lib/pixel.js";
import { sendCapiEvent } from "../lib/meta-capi.js";

const CURRENCY = "ARS";

async function main() {
  const apply = process.env.APPLY === "1";
  const slug = process.env.BACKFILL_SLUG;
  if (!slug) { console.error("Falta BACKFILL_SLUG=<slug>"); process.exit(1); }
  const user = await prisma.user.findUnique({ where: { slug }, select: { id: true, slug: true } });
  if (!user) { console.error("Usuario no encontrado"); process.exit(1); }
  const creds = await resolveUserPixel(user.id, "Purchase");
  if (!creds) { console.error("Sin pixel/token del cliente → no se puede reenviar"); process.exit(1); }

  const contacts = await prisma.contact.findMany({
    where: { userId: user.id, stage: "COMPRO", amount: { not: null } },
    select: { id: true, externalId: true, amount: true, phone: true, fbp: true, fbc: true, name: true, ctwaClid: true, landingUrl: true },
  });
  console.log(`\n=== RE-ENVÍO Purchase en ARS ${apply ? "(APLICANDO)" : "(DRY-RUN, no envía)"} | ${user.slug}: ${contacts.length} compras ===\n`);

  let ok = 0, fail = 0;
  for (const c of contacts) {
    const value = (c.amount ?? 0) / 100; // amount está en centavos
    if (value <= 0) continue;
    console.log(`  ${c.externalId.slice(0, 12)}…  $${value} ARS  → ${apply ? "ENVIANDO" : "SE ENVIARÍA"}`);
    if (!apply) continue;

    const isCtwa = !!c.ctwaClid;
    const metaEvent = await prisma.metaEvent.create({
      data: { userId: user.id, contactId: c.id, eventName: "Purchase", pixelId: creds.pixelId ?? "", payload: {}, status: "pending" },
    });
    try {
      const result = await sendCapiEvent({
        eventName: "Purchase",
        externalId: c.externalId,
        fbp: c.fbp ?? undefined,
        fbc: c.fbc ?? undefined,
        phone: c.phone ?? undefined,
        firstName: c.name ?? undefined,
        value,
        currency: CURRENCY,
        eventId: `${c.externalId}:purchase:ars`, // id NUEVO → no lo deduplica con el PYG viejo
        eventSourceUrl: c.landingUrl ?? undefined,
        actionSource: isCtwa ? "business_messaging" : "website",
        ctwaClid: c.ctwaClid ?? undefined,
        pixelId: creds.pixelId,
        capiToken: creds.capiToken,
      });
      await prisma.metaEvent.update({ where: { id: metaEvent.id }, data: { status: "sent", pixelId: result.pixelId, payload: result.payload as object, response: result.response as object } });
      console.log(`    ✔ Meta OK: ${JSON.stringify(result.response)}`);
      ok++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await prisma.metaEvent.update({ where: { id: metaEvent.id }, data: { status: "failed", response: { error: msg } } });
      console.log(`    ✗ FALLÓ: ${msg}`);
      fail++;
    }
  }
  console.log(`\n${apply ? `✅ Re-enviado en ARS: ${ok} OK, ${fail} fallidos.` : "ℹ️  DRY-RUN. Corré con APPLY=1 para enviar."}\n`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
