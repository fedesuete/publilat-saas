// Recupera la atribución de compras que quedaron PARTIDAS en el flujo Cloud API: el contacto "wa"
// (COMPRO, sin fbclid) se re-engancha a su contacto de /go por el (ref:CODE) del primer mensaje, y
// se RE-ENVÍA el Purchase a Meta con los identificadores de /go (que matchean el Lead).
// Solo compras de los últimos ~6.5 días (límite CAPI para event_time retroactivo).
// DRY-RUN por defecto; APPLY=1 para aplicar de verdad.
// Uso: BACKFILL_SLUG=joaco [APPLY=1] node dist/scripts/backfill-split-purchases.js
import { prisma } from "../lib/prisma.js";
import { resolveUserPixel } from "../lib/pixel.js";
import { sendCapiEvent } from "../lib/meta-capi.js";

async function main() {
  const slug = process.env.BACKFILL_SLUG;
  const apply = process.env.APPLY === "1";
  if (!slug) { console.error("falta BACKFILL_SLUG"); process.exit(1); }
  const user = await prisma.user.findUnique({ where: { slug } });
  if (!user) { console.error(`no existe el usuario ${slug}`); process.exit(1); }
  const since = new Date(Date.now() - 6.5 * 24 * 60 * 60 * 1000);

  // COMPRO sin fbclid, con monto, comprados en los últimos ~7 días.
  const compras = await prisma.contact.findMany({
    where: { userId: user.id, stage: "COMPRO", fbclid: null, amount: { not: null }, purchasedAt: { gte: since } },
    select: { id: true, phone: true, amount: true, purchasedAt: true },
    orderBy: { purchasedAt: "desc" },
  });
  console.log(`[recover] ${slug}: ${compras.length} compras sin fbclid en los últimos 7 días  (APPLY=${apply})`);

  const creds = await resolveUserPixel(user.id, "Purchase");
  if (!creds) { console.error("[recover] el usuario no tiene pixel/token configurado"); process.exit(1); }

  let recuperables = 0, enviados = 0, sinMatch = 0, fail = 0;
  for (const c of compras) {
    const firstMsg = await prisma.message.findFirst({
      where: { contactId: c.id, direction: "in" },
      orderBy: { createdAt: "asc" },
      select: { body: true },
    });
    const m = firstMsg?.body?.match(/ref:\s*([A-Z0-9]{4,})/i);
    if (!m) { sinMatch++; continue; }
    const code = m[1].toUpperCase();
    const go = await prisma.contact.findFirst({
      where: { userId: user.id, code, OR: [{ fbclid: { not: null } }, { fbp: { not: null } }, { fbc: { not: null } }] },
      select: { externalId: true, fbclid: true, fbp: true, fbc: true, campaignId: true, adId: true, pixelId: true },
    });
    if (!go) { sinMatch++; continue; }
    recuperables++;
    const value = (c.amount ?? 0) / 100;
    console.log(`  compra ${c.id}  $${value}  -> /go code ${code}  (fbclid: ${go.fbclid ? "sí" : "no"}, fbp: ${go.fbp ? "sí" : "no"})`);
    if (!apply) continue;
    try {
      // Copiamos la atribución al contacto COMPRO (para que se vea en la UI de acá en más).
      await prisma.contact.update({ where: { id: c.id }, data: {
        fbclid: go.fbclid ?? undefined, fbp: go.fbp ?? undefined, fbc: go.fbc ?? undefined,
        campaignId: go.campaignId ?? undefined, adId: go.adId ?? undefined, pixelId: go.pixelId ?? undefined,
      }});
      // Re-enviamos el Purchase con los IDs de /go (matchean el Lead ya enviado).
      const result = await sendCapiEvent({
        eventName: "Purchase",
        externalId: go.externalId,
        fbp: go.fbp ?? undefined,
        fbc: go.fbc ?? undefined,
        phone: c.phone ?? undefined,
        value,
        currency: "ARS",
        eventId: `${go.externalId}:purchase`,
        eventTime: c.purchasedAt ?? undefined,
        actionSource: "website",
        pixelId: creds.pixelId,
        capiToken: creds.capiToken,
      });
      await prisma.metaEvent.create({ data: { userId: user.id, contactId: c.id, eventName: "Purchase", pixelId: result.pixelId, payload: result.payload as object, status: "sent", response: result.response as object } });
      enviados++;
    } catch (e) { fail++; console.error(`  fallo ${c.id}:`, e instanceof Error ? e.message : String(e)); }
  }
  console.log(`[recover] RESUMEN: ${recuperables} recuperables · ${sinMatch} sin match · ${apply ? `${enviados} Purchase reenviados, ${fail} fallos` : "DRY-RUN (no se envió nada)"}`);
}
main().catch((e) => { console.error("[recover] error:", e); process.exit(1); }).finally(() => prisma.$disconnect());
