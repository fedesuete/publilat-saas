// Limpieza de contactos DUPLICADOS (leads que se crearon dos veces por la carrera del
// webhook antes del fix InboundDedup). Agrupa por (userId, waJid) y, en su defecto,
// (userId, phone); elige un contacto CANÓNICO y funde los demás en él (mueve mensajes,
// flowRuns y metaEvents), luego borra los duplicados vacíos.
//
// Uso:
//   tsx src/scripts/dedupe-contacts.ts            -> DRY-RUN: solo reporta qué haría.
//   tsx src/scripts/dedupe-contacts.ts --apply    -> aplica los merges.
//
// Seguro por diseño: en dry-run no escribe nada. Correr SIEMPRE con backup de la DB.
import { prisma } from "../lib/prisma.js";

const APPLY = process.argv.includes("--apply");

// Prioridad de etapa: nos quedamos como canónico con el contacto MÁS avanzado en el
// funnel (una venta nunca se pierde), y a igualdad, el más antiguo (el original).
const STAGE_RANK: Record<string, number> = { COMPRO: 5, INTERESADO: 4, CONTACTADO: 3, NUEVO: 2, PERDIDO: 1 };

interface Row {
  id: string;
  userId: string;
  phone: string | null;
  waJid: string | null;
  code: string | null;
  stage: string;
  amount: number | null;
  createdAt: Date;
}

function pickCanonical(rows: Row[]): Row {
  return [...rows].sort((a, b) => {
    const sr = (STAGE_RANK[b.stage] ?? 0) - (STAGE_RANK[a.stage] ?? 0);
    if (sr !== 0) return sr;
    // a igual etapa, preferimos el que tiene código (vino del /go, con atribución) ...
    const ca = (a.code ? 1 : 0) - (b.code ? 1 : 0);
    if (ca !== 0) return -ca;
    // ... y el más antiguo.
    return a.createdAt.getTime() - b.createdAt.getTime();
  })[0];
}

async function mergeGroup(rows: Row[]): Promise<number> {
  const canonical = pickCanonical(rows);
  const dups = rows.filter((r) => r.id !== canonical.id);
  if (!dups.length) return 0;

  const dupIds = dups.map((d) => d.id);
  const key = canonical.waJid ?? canonical.phone ?? canonical.id;
  console.log(
    `  grupo ${key}: ${rows.length} contactos -> canónico ${canonical.id} (${canonical.stage}${canonical.code ? ", code " + canonical.code : ""}); funde ${dupIds.length}`,
  );

  if (!APPLY) return dupIds.length;

  await prisma.$transaction(async (tx) => {
    // Mover todo lo que referencia a los duplicados hacia el canónico.
    await tx.message.updateMany({ where: { contactId: { in: dupIds } }, data: { contactId: canonical.id } });
    await tx.flowRun.updateMany({ where: { contactId: { in: dupIds } }, data: { contactId: canonical.id } });
    await tx.metaEvent.updateMany({ where: { contactId: { in: dupIds } }, data: { contactId: canonical.id } });
    // Completar en el canónico los datos de atribución que le falten (best-effort).
    const patch: Record<string, unknown> = {};
    if (!canonical.phone) { const p = dups.find((d) => d.phone)?.phone; if (p) patch.phone = p; }
    if (!canonical.waJid) { const j = dups.find((d) => d.waJid)?.waJid; if (j) patch.waJid = j; }
    if (!canonical.code) { const c = dups.find((d) => d.code)?.code; if (c) patch.code = c; }
    if (Object.keys(patch).length) {
      // waJid/code son @unique: si otro contacto ya lo tiene, ignoramos ese campo.
      await tx.contact.update({ where: { id: canonical.id }, data: patch }).catch(() => undefined);
    }
    // Borrar los duplicados ya vacíos de referencias.
    await tx.contact.deleteMany({ where: { id: { in: dupIds } } });
  });
  return dupIds.length;
}

async function main() {
  console.log(APPLY ? "== MODO APPLY (escribe cambios) ==" : "== DRY-RUN (no escribe nada; usá --apply) ==");
  const contacts = await prisma.contact.findMany({
    select: { id: true, userId: true, phone: true, waJid: true, code: true, stage: true, amount: true, createdAt: true },
  });

  // Agrupar por (userId, waJid) si hay waJid; si no, por (userId, phone). Sin ninguno, no se agrupa.
  const groups = new Map<string, Row[]>();
  for (const c of contacts as Row[]) {
    const ident = c.waJid || c.phone;
    if (!ident) continue; // contactos sin teléfono/jid (clics /go sin mensaje) no se tocan
    const k = `${c.userId}::${ident}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(c);
  }

  let dupGroups = 0;
  let merged = 0;
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    dupGroups++;
    merged += await mergeGroup(rows);
  }

  console.log(`\nGrupos con duplicados: ${dupGroups}. Contactos ${APPLY ? "fundidos" : "que se fundirían"}: ${merged}.`);
  if (!APPLY && merged) console.log("Reejecutá con --apply para aplicar.");
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
