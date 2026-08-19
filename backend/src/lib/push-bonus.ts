// Piloto "App + Notis": bono de fichas por activar las notificaciones, prendido POR CUENTA
// vía env — PUSH_BONUS_BY_SLUG='{"matias":2000}'. Sin migración de DB; si el piloto rinde,
// esto pasa a columna + UI en el panel. La acreditación es MANUAL del cajero (el hito se lo
// marca en el hilo); acá solo se decide el monto y la redacción del chip.
//
// OJO redacción: los chips de sistema los ven el JUGADOR y el OPERADOR a la vez, así que el
// texto tiene que servirle a los dos (el jugador reclama, el cajero acredita).

export function pushBonusFor(slug: string): number | null {
  try {
    const raw = process.env.PUSH_BONUS_BY_SLUG;
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, unknown>;
    const n = Number(map[slug]);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

const fmt = (n: number) => n.toLocaleString("es-AR");

export function pushOnMilestoneBody(bonus: number | null): string {
  if (bonus) {
    return `🔔 Notificaciones activadas ✓ — 🎁 Bono de ${fmt(bonus)} fichas por única vez: pedíselas al cajero acá mismo.`;
  }
  return "🔔 Notificaciones activadas ✓";
}

export function appInstalledMilestoneBody(): string {
  return "📲 App instalada ✓";
}
