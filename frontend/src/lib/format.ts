export function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtAmount(cents: number | null): string {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function truncate(value: string | null, len = 14): string {
  if (!value) return "—";
  return value.length > len ? value.slice(0, len) + "…" : value;
}

// Nombre legible de un contacto: nombre -> teléfono -> código corto. NUNCA el UUID crudo.
export function contactName(c: { name?: string | null; phone?: string | null; code?: string | null }): string {
  return c.name || c.phone || c.code || "Sin nombre";
}

/**
 * Tiempo restante hasta `iso` en texto corto ("en 3 días", "en 5 h", "vencida").
 * Devuelve null si `iso` es null/inválido.
 */
export function fmtRemaining(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const diffMs = d.getTime() - Date.now();
  if (diffMs <= 0) return "vencida";
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `vence en ${days} ${days === 1 ? "día" : "días"}`;
  }
  if (hours >= 1) return `vence en ${hours} ${hours === 1 ? "hora" : "horas"}`;
  const mins = Math.max(1, Math.floor(diffMs / (1000 * 60)));
  return `vence en ${mins} min`;
}

export function isExpired(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return false;
  return d.getTime() <= Date.now();
}
