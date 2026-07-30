// Backfill de comprobantes → Purchase a Meta. Lee con IA los comprobantes YA recibidos (que aún no
// dispararon Purchase) en los DOS canales y manda el evento de compra a Meta, para "reentrenar" el
// pixel hacia pagadores. Pedido del dueño (cerrar el círculo de victor).
//   - WhatsApp (Inbox): imágenes entrantes de contactos que NO están en COMPRO → si la IA las lee
//     como comprobante con monto, markPurchase (marca COMPRO + Purchase CAPI).
//   - Chat App (Cajero): cargas con comprobante subido que aún no dispararon Purchase → readReceipt
//     AndFirePurchase (Purchase con el monto declarado; NO acredita fichas, eso sigue en approve).
//
// DRY-RUN por defecto (solo LEE y muestra qué se enviaría). APPLY=1 para mandar de verdad a Meta.
// Uso:  BACKFILL_SLUG=victor            node dist/scripts/backfill-receipts.js     # dry-run
//       BACKFILL_SLUG=victor APPLY=1    node dist/scripts/backfill-receipts.js     # aplica
//       BACKFILL_ALL=1     [APPLY=1]    node dist/scripts/backfill-receipts.js
import { prisma } from "../lib/prisma.js";
import { analyzeReceipt, aiEnabled } from "../lib/ai-receipt.js";
import { markPurchase } from "../lib/purchase.js";
import { readReceiptAndFirePurchase } from "../routes/chat.js";

const CURRENCY = process.env.BACKFILL_CURRENCY ?? "ARS";
const MIN_CONF = Number(process.env.BACKFILL_MIN_CONFIDENCE ?? "0.5");

// ---- WhatsApp: última imagen entrante por contacto no-COMPRO ----
async function backfillWhatsApp(user: { id: string; slug: string }, apply: boolean) {
  const msgs = await prisma.message.findMany({
    where: {
      direction: "in",
      mediaType: { startsWith: "image" },
      mediaData: { not: null },
      contact: { userId: user.id, stage: { not: "COMPRO" } },
    },
    select: { contactId: true, mediaData: true, mediaType: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const latest = new Map<string, (typeof msgs)[number]>();
  for (const m of msgs) if (m.contactId && !latest.has(m.contactId)) latest.set(m.contactId, m);

  let leidos = 0, comprobantes = 0, enviados = 0, fail = 0;
  for (const [contactId, m] of latest) {
    leidos++;
    if (!aiEnabled()) continue;
    const a = await analyzeReceipt(m.mediaData as string, m.mediaType ?? undefined);
    if (!a?.isReceipt || !(a.amount && a.amount > 0) || a.confidence < MIN_CONF) continue;
    comprobantes++;
    console.log(`  [WA] contacto ${contactId}: comprobante $${a.amount} ${CURRENCY} (conf ${a.confidence}) → ${apply ? "ENVIANDO" : "SE ENVIARÍA"}`);
    if (apply) {
      const r = await markPurchase(user.id, contactId, a.amount, CURRENCY); // ARS (todas las líneas)
      if (r?.ok) enviados++; else fail++;
    }
  }
  return { leidos, comprobantes, enviados, fail };
}

// ---- Chat App cajero: cargas con comprobante que aún no dispararon Purchase ----
async function backfillCajero(user: { id: string; slug: string }, apply: boolean) {
  const deps = await prisma.chatDeposit.findMany({
    where: { userId: user.id, purchaseFiredAt: null, comprobanteData: { not: null } },
    select: { id: true, amount: true, comprobanteType: true, comprobanteData: true },
  });
  let leidos = 0, comprobantes = 0, enviados = 0;
  for (const d of deps) {
    leidos++;
    if (apply) {
      await readReceiptAndFirePurchase(d.id);
      const after = await prisma.chatDeposit.findUnique({ where: { id: d.id }, select: { purchaseFiredAt: true } });
      if (after?.purchaseFiredAt) { comprobantes++; enviados++; console.log(`  [Cajero] carga ${d.id}: $${d.amount} → Purchase enviado`); }
      else console.log(`  [Cajero] carga ${d.id}: la IA no lo tomó como comprobante (no se envió)`);
    } else {
      const a = aiEnabled() && d.comprobanteData
        ? await analyzeReceipt(Buffer.from(d.comprobanteData).toString("base64"), d.comprobanteType ?? undefined)
        : null;
      const willFire = !a || (a.isReceipt && a.confidence >= 0.5);
      console.log(`  [Cajero] carga ${d.id}: $${d.amount} ${a ? `(IA isReceipt=${a.isReceipt} conf ${a.confidence})` : "(sin IA)"} → ${willFire ? "SE ENVIARÍA" : "no"}`);
      if (willFire) comprobantes++;
    }
  }
  return { leidos, comprobantes, enviados };
}

async function main() {
  const apply = process.env.APPLY === "1";
  const slug = process.env.BACKFILL_SLUG;
  const all = process.env.BACKFILL_ALL === "1";
  if (!slug && !all) {
    console.error("Falta BACKFILL_SLUG=<slug> o BACKFILL_ALL=1");
    process.exit(1);
  }
  const users = await prisma.user.findMany({
    where: slug ? { slug } : {},
    select: { id: true, slug: true },
  });
  if (users.length === 0) { console.error("Sin usuarios que coincidan."); process.exit(1); }

  console.log(`\n=== BACKFILL COMPROBANTES → META ${apply ? "(APLICANDO)" : "(DRY-RUN, no envía)"} | IA: ${aiEnabled() ? "ON" : "OFF"} ===\n`);
  for (const u of users) {
    console.log(`--- ${u.slug} ---`);
    const wa = await backfillWhatsApp(u, apply);
    const cj = await backfillCajero(u, apply);
    console.log(`  WhatsApp: ${wa.leidos} imágenes leídas · ${wa.comprobantes} comprobantes · ${wa.enviados} enviados · ${wa.fail} fallidos`);
    console.log(`  Cajero:   ${cj.leidos} cargas · ${cj.comprobantes} comprobantes · ${cj.enviados} enviados`);
  }
  console.log(`\n${apply ? "✅ Backfill aplicado." : "ℹ️  DRY-RUN. Corré con APPLY=1 para enviar a Meta."}\n`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
