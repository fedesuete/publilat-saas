// Auto-dedup de líneas con el MISMO número (mismo cliente). Un número físico de WhatsApp solo
// admite UNA sesión: si por un re-pareo quedan 2 registros de línea apuntando al mismo número, sus
// dos sesiones pelean la identidad -> WhatsApp echa una (stream error "conflict"/device_removed) y
// la línea cae en loop, generando alertas de "línea caída" sin fin.
//
// Cuando una línea CONECTADA resuelve su número, borramos las OTRAS líneas del mismo cliente con ese
// número que NO estén conectadas: reasignamos su historial (contactos/mensajes) a la que queda, le
// pasamos los días (expiresAt más lejano, para no perder tiempo pago) y bajamos su sesión + registro.
//
// Conservador a propósito: NUNCA borra una línea conectada. Si dos están conectadas peleando, se
// espera a que WhatsApp eche una (queda connected:false) y el próximo ciclo la limpia.
import { prisma } from "./prisma.js";
import { getEngine } from "./wa-engine.js";

export async function dedupeSameNumberLines(userId: string, phone: string, keeperId: string): Promise<number> {
  const num = (phone ?? "").trim();
  if (!num) return 0;

  const dups = await prisma.waLine.findMany({
    where: { userId, phone: num, id: { not: keeperId }, provider: { not: "cloud" }, connected: false },
    select: { id: true, expiresAt: true },
  });
  if (dups.length === 0) return 0;

  const keeper = await prisma.waLine.findUnique({ where: { id: keeperId }, select: { expiresAt: true } });
  let bestExp = keeper?.expiresAt ?? null;

  for (const d of dups) {
    if (d.expiresAt && (!bestExp || d.expiresAt.getTime() > bestExp.getTime())) bestExp = d.expiresAt;
    // No perder historial: el evento de Meta no tiene FK a la línea, pero contactos/mensajes sí.
    await prisma.contact.updateMany({ where: { lineId: d.id }, data: { lineId: keeperId } });
    await prisma.message.updateMany({ where: { lineId: d.id }, data: { lineId: keeperId } });
    // Bajar la sesión duplicada (best-effort): logout desvincula el device viejo, delete la borra.
    try { await getEngine().logoutInstance(`line_${d.id}`); } catch { /* sesión ya caída */ }
    try { await getEngine().deleteInstance(`line_${d.id}`); } catch { /* idem */ }
    await prisma.waLine.delete({ where: { id: d.id } });
    console.warn(`[dedupe-lines] borré línea duplicada ${d.id} (mismo número ${num} que ${keeperId}, no conectada)`);
  }

  // Pasar los días a la que queda: si alguna dup expiraba más tarde, extendemos su vencimiento.
  if (bestExp && (!keeper?.expiresAt || bestExp.getTime() !== keeper.expiresAt.getTime())) {
    await prisma.waLine.update({ where: { id: keeperId }, data: { expiresAt: bestExp } });
  }
  return dups.length;
}
