// Recupera la atribución de compras que quedaron PARTIDAS (Cloud API / mensaje directo): el contacto
// "wa" (COMPRO, sin fbclid) se re-engancha a su contacto de /go por el (ref:CODE) del primer mensaje,
// se COPIA el fbclid/fbp/fbc al contacto (queda en la BD) y se RE-ENVÍA el Purchase a Meta con los
// identificadores de /go (que matchean el Lead). Solo compras de los últimos ~6.5 días (límite CAPI).
// Idempotente: una vez recuperada, la compra ya tiene fbclid → no se vuelve a tocar.
// DRY-RUN por defecto; APPLY=1 para aplicar.
// Uso:  BACKFILL_ALL=1 [APPLY=1] node dist/scripts/backfill-split-purchases.js
//   o:  BACKFILL_SLUG=joaco [APPLY=1] node dist/scripts/backfill-split-purchases.js
import { prisma } from "../lib/prisma.js";
import { resolveUserPixel } from "../lib/pixel.js";
import { sendCapiEvent } from "../lib/meta-capi.js";

const CURRENCY = process.env.BACKFILL_CURRENCY ?? "ARS";

async function recoverForUser(user: { id: string; slug: string }, apply: boolean) {
  const since = new Date(Date.now() - 6.5 * 24 * 60 * 60 * 1000);
  const compras = await prisma.contact.findMany({
    where: { userId: user.id, stage: "COMPRO", fbclid: null, amount: { not: null }, purchasedAt: { gte: since } },
    select: { id: true, phone: true, amount: true, purchasedAt: true },
    orderBy: { purchasedAt: "desc" },
  });
  if (compras.length === 0) return { compras: 0, recuperables: 0, enviados: 0, sinMatch: 0, fail: 0 };

  const creds = await resolveUserPixel(user.id, "Purchase");
  if (!creds) {
    console.log(`[recover] ${user.slug}: ${compras.length} compras sin fbclid, pero SIN pixel/token → salteo`);
    return { compras: compras.length, recuperables: 0, enviados: 0, sinMatch: 0, fail: 0 };
  }

  let recuperables = 0, enviados = 0, sinMatch = 0, fail = 0;
  for (const c of compras) {
    const firstMsg = await prisma.message.findFirst({
      where: { contactId: c.id, direction: "in" }, orderBy: { createdAt: "asc" }, select: { body: true },
    });
    const m = firstMsg?.body?.match(/ref:\s*([A-Z0-9]{4,})/i);
    if (!m) { sinMatch++; continue; }
    const go = await prisma.contact.findFirst({
      where: { userId: user.id, code: m[1].toUpperCase(), OR: [{ fbclid: { not: null } }, { fbp: { not: null } }, { fbc: { not: null } }] },
      select: { externalId: true, fbclid: true, fbp: true, fbc: true, campaignId: true, adId: true, pixelId: true },
    });
    if (!go) { sinMatch++; continue; }
    recuperables++;
    const value = (c.amount ?? 0) / 100;
    if (!apply) continue;
    try {
      await prisma.contact.update({ where: { id: c.id }, data: {
        fbclid: go.fbclid ?? undefined, fbp: go.fbp ?? undefined, fbc: go.fbc ?? undefined,
        campaignId: go.campaignId ?? undefined, adId: go.adId ?? undefined, pixelId: go.pixelId ?? undefined,
      }});
      const result = await sendCapiEvent({
        eventName: "Purchase", externalId: go.externalId, fbp: go.fbp ?? undefined, fbc: go.fbc ?? undefined,
        phone: c.phone ?? undefined, value, currency: CURRENCY, eventId: `${go.externalId}:purchase`,
        eventTime: c.purchasedAt ?? undefined, actionSource: "website", pixelId: creds.pixelId, capiToken: creds.capiToken,
      });
      await prisma.metaEvent.create({ data: { userId: user.id, contactId: c.id, eventName: "Purchase", pixelId: result.pixelId, payload: result.payload as object, status: "sent", response: result.response as object } });
      enviados++;
    } catch (e) { fail++; console.error(`  [${user.slug}] fallo ${c.id}:`, e instanceof Error ? e.message : String(e)); }
  }
  console.log(`[recover] ${user.slug}: ${compras.length} sin fbclid · ${recuperables} recuperables · ${sinMatch} sin match · ${apply ? `${enviados} reenviados, ${fail} fallos` : "dry-run"}`);
  return { compras: compras.length, recuperables, enviados, sinMatch, fail };
}

async function main() {
  const apply = process.env.APPLY === "1";
  const all = process.env.BACKFILL_ALL === "1";
  const slug = process.env.BACKFILL_SLUG;
  let users: { id: string; slug: string }[];
  if (all) users = await prisma.user.findMany({ select: { id: true, slug: true } });
  else if (slug) {
    const u = await prisma.user.findUnique({ where: { slug }, select: { id: true, slug: true } });
    if (!u) { console.error(`no existe ${slug}`); process.exit(1); }
    users = [u];
  } else { console.error("falta BACKFILL_ALL=1 o BACKFILL_SLUG=<slug>"); process.exit(1); }

  console.log(`[recover] ${users.length} usuario(s) · moneda ${CURRENCY} · APPLY=${apply}`);
  const tot = { compras: 0, recuperables: 0, enviados: 0, sinMatch: 0, fail: 0 };
  for (const u of users) {
    const r = await recoverForUser(u, apply);
    tot.compras += r.compras; tot.recuperables += r.recuperables; tot.enviados += r.enviados; tot.sinMatch += r.sinMatch; tot.fail += r.fail;
  }
  console.log(`[recover] TOTAL: ${tot.compras} compras sin fbclid · ${tot.recuperables} recuperables · ${tot.sinMatch} sin match · ${apply ? `${tot.enviados} Purchase reenviados, ${tot.fail} fallos` : "DRY-RUN"}`);
}
main().catch((e) => { console.error("[recover] error:", e); process.exit(1); }).finally(() => prisma.$disconnect());
