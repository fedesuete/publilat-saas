// Rotación de líneas con PESO por línea (bajar tráfico a números frágiles sin apagarlos).
// El peso vive en el env LINE_WEIGHTS = JSON {lineId: peso}; default 1.0 para las no listadas.
// Peso 0.2 => la línea recibe ~1/5 de los clics. Sin migración de DB (patrón PUSH_BONUS_BY_SLUG).

export function lineWeights(): Record<string, number> {
  try {
    const raw = process.env.LINE_WEIGHTS;
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) out[k] = n;
    }
    return out;
  } catch {
    return {};
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
