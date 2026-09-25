// RITMO de consumo de IPRoyal (GB por día), no solo el saldo.
//
// Por qué existe (2026-09-24): el saldo se agotó dos veces en dos días. El aviso de "saldo bajo" llega
// cuando ya casi no queda, y no dice POR QUÉ se está yendo. Medido el 24/09 con 8 líneas: 44 MB por
// hora (≈1 GB/día), contra los ~0,15 GB/día que gastarían esas mismas líneas estables. La diferencia
// son las RECONEXIONES: cada una rehace el handshake y sincroniza estado por el proxy. Ese día tres
// líneas hicieron 297 de las 359 reconexiones (83%): freydis 167, lacavictoria 80, naturalcosmetica 50.
//
// Con el ritmo se ve el problema el mismo día y con nombre y apellido, en vez de descubrirlo cuando
// el proxy ya se cayó. Todo en memoria: tras un deploy tarda una hora en tener referencia.
import { recentFlaps } from "./line-weights.js";

// Por encima de esto el gasto NO es normal (10 líneas estables ≈ 0,35 GB/día).
export const BURN_ALERT_GB_DIA = Number(process.env.IPROYAL_BURN_ALERT_GB ?? "0.6");

export interface Lectura {
  gb: number;
  at: number;
}

/** GB por día entre dos lecturas del saldo. null si la ventana es muy corta o el saldo subió (recarga). */
export function ritmoGbDia(previa: Lectura | null, actual: Lectura): number | null {
  if (!previa) return null;
  const minutos = (actual.at - previa.at) / 60_000;
  if (minutos < 20) return null; // ventana muy corta: el ruido domina
  const consumido = previa.gb - actual.gb;
  if (consumido <= 0) return null; // recargó, o no se movió
  return (consumido / minutos) * 60 * 24;
}

/** Horas que quedan de saldo al ritmo actual. null si no hay ritmo. */
export function horasRestantes(gb: number, gbDia: number | null): number | null {
  if (!gbDia || gbDia <= 0) return null;
  return (gb / gbDia) * 24;
}

/**
 * Las líneas que más se están cayendo ahora mismo. Sirve para señalar al culpable en el aviso: el
 * gasto se concentra en unas pocas. El costo por reconexión varía mucho (según cuánta cola de
 * mensajes y estado haya que sincronizar), así que se ordena por CAÍDAS, que es el dato firme.
 */
export const MB_POR_RECONEXION = Number(process.env.PROXY_MB_POR_RECONEXION ?? "1");

export function culpables(lineIds: string[], now: number = Date.now()): Array<{ lineId: string; caidas: number; mbHora: number }> {
  return lineIds
    .map((lineId) => {
      const caidas = recentFlaps(lineId, now);
      return { lineId, caidas, mbHora: caidas * MB_POR_RECONEXION };
    })
    .filter((x) => x.caidas > 0)
    .sort((a, b) => b.caidas - a.caidas);
}

/** Texto del aviso. Se arma acá para poder testearlo sin tocar red ni base. */
export function textoAviso(
  gb: number,
  gbDia: number,
  culpas: Array<{ nombre: string; caidas: number }>,
): string {
  const horas = horasRestantes(gb, gbDia);
  const lineas = [
    `El proxy está consumiendo ${gbDia.toFixed(2)} GB por día (lo normal es menos de ${BURN_ALERT_GB_DIA}).`,
    `Quedan ${gb.toFixed(2)} GB${horas ? `: a este ritmo se agota en ~${Math.round(horas)} h` : ""}.`,
  ];
  if (culpas.length) {
    lineas.push("");
    lineas.push("Las líneas que más se están cayendo (cada caída vuelve a sincronizar por el proxy):");
    for (const c of culpas.slice(0, 3)) lineas.push(`• ${c.nombre}: ${c.caidas} caídas en la última hora`);
    lineas.push("");
    lineas.push("Volvé a vincular esas líneas (Conectar / Ver QR) o sacalas de rotación: son la mayor parte del gasto.");
  }
  return lineas.join("\n");
}
