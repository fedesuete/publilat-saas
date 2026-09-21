// Rotación de líneas con PESO por línea (bajar tráfico a números frágiles sin apagarlos).
// El peso vive en el env LINE_WEIGHTS = JSON {lineId: peso}; default 1.0 para las no listadas.
// Peso 0.2 => la línea recibe ~1/5 de los clics. Sin migración de DB (patrón PUSH_BONUS_BY_SLUG).
//
// Además del peso MANUAL, hay un peso AUTOMÁTICO por salud: una línea que se está cayendo recibe
// menos clics hasta que se estabiliza. Medido en prod (naturalcosmetica, 2026-09-21), la rotación
// pareja mandaba un tercio del tráfico a una línea que casi no entregaba:
//     número      antigüedad   caídas/6h   clics   mensajes que entraron
//     …979503     2 días            16     1.318          45
//     …947791     5 horas           84       775          18
//     …697836     5 horas          128       700           7   <- 170 min sin recibir nada
// Los números recién vinculados se caen mucho y se estabilizan con los días; hasta que eso pase,
// conviene mandarles poco tráfico en vez de perder los mensajes.

// Caídas por línea en la última hora (en memoria, como session-guard: la API y el worker corren en
// el mismo proceso). Se pierde en cada deploy, y está bien: arranca sin penalizar a nadie.
const FLAP_WINDOW_MS = 60 * 60 * 1000;
const flaps = new Map<string, number[]>();

// La registra `scheduleLineDownAlert` cada vez que una línea se cae (line-alert.ts).
export function recordLineFlap(lineId: string): void {
  const now = Date.now();
  const list = (flaps.get(lineId) ?? []).filter((t) => now - t < FLAP_WINDOW_MS);
  list.push(now);
  flaps.set(lineId, list);
}

export function recentFlaps(lineId: string, now: number = Date.now()): number {
  const list = (flaps.get(lineId) ?? []).filter((t) => now - t < FLAP_WINDOW_MS);
  if (list.length) flaps.set(lineId, list);
  else flaps.delete(lineId);
  return list.length;
}

// Peso por salud. NUNCA llega a 0: una línea castigada sigue recibiendo algo (así se recupera sola y,
// si TODAS están mal, los clics igual salen en vez de quedarse sin línea).
export function healthWeight(caidas: number): number {
  if (caidas <= 2) return 1;      // ruido normal
  if (caidas <= 5) return 0.5;
  if (caidas <= 10) return 0.25;
  return 0.1;                      // se está cayendo sin parar: ~1 de cada 10 clics
}

// Sin argumentos a propósito: `go.ts` (el redirector) la llama así en cada clic y no se toca.
// Las líneas penalizadas salen del registro de caídas, no de la lista de candidatas.
export function lineWeights(): Record<string, number> {
  const out: Record<string, number> = {};
  // 1) Peso automático: toda línea con caídas recientes registradas.
  const now = Date.now();
  for (const id of [...flaps.keys()]) {
    const w = healthWeight(recentFlaps(id, now));
    if (w !== 1) out[id] = w;
  }
  // 2) El peso MANUAL del env manda por encima del automático (es una decisión explícita del admin).
  try {
    const raw = process.env.LINE_WEIGHTS;
    if (!raw) return out;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const [k, v] of Object.entries(parsed)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) out[k] = n;
    }
    return out;
  } catch {
    return out;
  }
}

// LRU ponderado: score = antigüedad_efectiva = (now - lastUsedAt) * peso. Gana el mayor score.
// null lastUsedAt = nunca usada = antigüedad máxima (now). Con peso 0.2 la línea necesita estar
// ~5x más vieja para ganar un turno → recibe ~1/5 del tráfico. Determinístico (sin random).
export function pickWeighted<T extends { id: string; lastUsedAt: Date | null }>(
  lines: T[],
  weights: Record<string, number>,
  now: number,
): T | null {
  let best: T | null = null;
  let bestScore = -Infinity;
  for (const line of lines) {
    const w = weights[line.id] ?? 1;
    const last = line.lastUsedAt ? line.lastUsedAt.getTime() : 0; // null → usada "en el epoch" = máxima antigüedad
    const score = (now - last) * w;
    if (score > bestScore) {
      bestScore = score;
      best = line;
    }
  }
  return best;
}
