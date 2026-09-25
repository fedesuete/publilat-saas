// TOPE DURO de consumo del plan de proxies.
//
// Por qué existe (2026-09-25, pedido del dueño: "cargué hace dos días y consumió todo; no vuelvo a
// cargar hasta que esto funcione bien"): el gasto no tenía techo. Una línea que se cae y reconecta
// sin parar puede comerse un plan entero en un día, y hasta ahora nadie lo frenaba — solo se avisaba
// cuando ya no quedaba nada.
//
// Ahora el consumo tiene un techo por construcción: si el ritmo supera el presupuesto, se le saca el
// proxy a la línea que más se está cayendo (la que más gasta) y queda bloqueada 24 h. La línea SIGUE
// TRABAJANDO por la IP del servidor: no se corta el servicio de nadie, solo deja de gastar plan.
// Si en el próximo chequeo el ritmo sigue alto, cae la siguiente. En el peor caso quedan todas sin
// proxy y el gasto es cero: nunca más se vacía el plan solo.
import { prisma } from "./prisma.js";
import { recentFlaps } from "./line-weights.js";
import { pasarLineaADirecto } from "./proxy-emergencia.js";

// Techo de gasto. 0,3 GB/día alcanza de sobra para ~10 líneas estables (medido: ~0,15 GB/día).
export const PRESUPUESTO_GB_DIA = Number(process.env.PROXY_PRESUPUESTO_GB_DIA ?? "0.3");
export const BLOQUEO_HORAS = Number(process.env.PROXY_BLOQUEO_HORAS ?? "24");

export function presupuestoActivo(): boolean {
  return (process.env.PROXY_PRESUPUESTO ?? "on").trim().toLowerCase() !== "off";
}

/** ¿El ritmo medido se pasó del techo? null = todavía no hay medición confiable. */
export function excedido(ritmoGbDia: number | null): boolean {
  if (!presupuestoActivo() || ritmoGbDia == null) return false;
  return ritmoGbDia > PRESUPUESTO_GB_DIA;
}

/**
 * A quién cortarle el proxy: la que más se cayó en la última hora, porque cada caída rehace la
 * conexión por el proxy y eso es lo que gasta. Con empate (o sin caídas registradas) va la más
 * nueva: las recién vinculadas son las que peor se portan y las que menos historia pierden.
 */
export function elegirVictima(
  lineas: Array<{ id: string; createdAt: Date }>,
  now: number = Date.now(),
): string | null {
  if (!lineas.length) return null;
  const conPeso = lineas.map((l) => ({ id: l.id, caidas: recentFlaps(l.id, now), nacida: l.createdAt.getTime() }));
  conPeso.sort((a, b) => (b.caidas - a.caidas) || (b.nacida - a.nacida));
  return conPeso[0].id;
}

/** Texto del aviso. Aparte para poder testearlo. */
export function textoTope(nombre: string, ritmoGbDia: number, horas: number): string {
  return (
    `El proxy venía gastando ${ritmoGbDia.toFixed(2)} GB por día, más del techo de ${PRESUPUESTO_GB_DIA}.\n\n` +
    `Le saqué el proxy a "${nombre}", que es la que más se está cayendo (cada caída rehace la conexión y eso es lo que gasta). ` +
    `La línea SIGUE FUNCIONANDO por la IP del servidor: no se le cortó el WhatsApp a nadie.\n\n` +
    `Vuelve a tener proxy sola en ${horas} h. Si querés que vuelva antes, volvé a vincularla (Conectar / Ver QR): ` +
    `una sesión nueva suele dejar de caerse.`
  );
}

/**
 * Aplica el tope: corta UNA línea por vuelta (la que más gasta) mientras el ritmo esté por encima.
 * De a una para no dejar a toda la flota sin proxy por un pico puntual. Devuelve el nombre de la
 * línea cortada, o null si no hizo falta cortar nada.
 */
export async function aplicarTope(ritmoGbDia: number | null): Promise<{ nombre: string; lineId: string } | null> {
  if (!excedido(ritmoGbDia)) return null;
  const candidatas = await prisma.waLine
    .findMany({
      where: {
        proxyId: { not: null },
        provider: { not: "cloud" },
        banned: false,
        status: "active",
        expiresAt: { gt: new Date() },
      },
      select: { id: true, phone: true, label: true, createdAt: true },
    })
    .catch(() => []);
  const victimaId = elegirVictima(candidatas);
  if (!victimaId) return null;
  const v = candidatas.find((l) => l.id === victimaId)!;

  const hasta = new Date(Date.now() + BLOQUEO_HORAS * 3600_000);
  const movida = await pasarLineaADirecto(victimaId, `tope de consumo (${(ritmoGbDia ?? 0).toFixed(2)} GB/día)`);
  if (!movida) return null;
  // El bloqueo va DESPUÉS de moverla: pasarLineaADirecto deja proxyWait=true y sin esto el job de
  // recupero le devolvería el proxy en 2 minutos, y volvería a gastar.
  await prisma.waLine.update({ where: { id: victimaId }, data: { proxyBlockedUntil: hasta, proxyWait: false } }).catch(() => undefined);
  const nombre = v.label ?? `…${v.phone.slice(-4)}`;
  console.warn(`[proxy-presupuesto] ${nombre} sin proxy por ${BLOQUEO_HORAS} h: ritmo ${ritmoGbDia?.toFixed(2)} GB/día`);
  return { nombre, lineId: victimaId };
}
