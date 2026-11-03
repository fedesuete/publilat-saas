// Agenda de contactos en vCard 3.0 (.vcf) para importar de una en el celular o en Google Contactos
// (2026-11-03, pedido del dueño: agendar a todos los clientes). Un archivo con muchas tarjetas.

const ETAPAS: Record<string, string> = {
  NUEVO: "Nuevo", CONTACTADO: "Contactado", INTERESADO: "Interesado", COMPRO: "Compró", PERDIDO: "Perdido",
};

/** Escapa un valor de texto según RFC 6350 (barra, coma, punto y coma, saltos de línea). */
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\r?\n/g, "\\n");

/** Teléfono en formato internacional (+595…), o null si no parece un número real (LID, vacío, corto). */
export function telefonoVcard(phone: string | null | undefined): string | null {
  const d = (phone ?? "").replace(/\D/g, "");
  return d.length >= 8 && d.length <= 15 ? `+${d}` : null;
}

export interface ContactoVcard { name: string | null; phone: string | null; stage: string }

/**
 * Un .vcf con una tarjeta por número (sin repetidos). Nombre = el de WhatsApp/CRM + la etiqueta (" - Publi"
 * por defecto) para encontrarlos juntos en la agenda; sin nombre, "Cliente" + los últimos 4 dígitos.
 * La etapa va en CATEGORIES (Google Contactos la usa como etiqueta).
 */
export function armarVcf(contactos: ContactoVcard[], etiqueta = "Publi"): { vcf: string; total: number } {
  const vistos = new Set<string>();
  const tarjetas: string[] = [];
  for (const c of contactos) {
    const tel = telefonoVcard(c.phone);
    if (!tel || vistos.has(tel)) continue;
    vistos.add(tel);
    const base = (c.name ?? "").replace(/\s+/g, " ").trim() || `Cliente ${tel.slice(-4)}`;
    const nombre = etiqueta ? `${base} - ${etiqueta}` : base;
    const cats = [etiqueta, ETAPAS[c.stage] ?? c.stage].filter(Boolean).map(esc).join(",");
    tarjetas.push([
      "BEGIN:VCARD", "VERSION:3.0",
      `FN:${esc(nombre)}`, `N:;${esc(nombre)};;;`,
      `TEL;TYPE=CELL:${tel}`,
      ...(cats ? [`CATEGORIES:${cats}`] : []),
      "END:VCARD",
    ].join("\r\n"));
  }
  return { vcf: tarjetas.join("\r\n") + (tarjetas.length ? "\r\n" : ""), total: tarjetas.length };
}
