// custom_data del Lead de una landing calificada (embudo B2B de Lucky Soft): las respuestas del formulario
// viajan a Meta para armar conversiones personalizadas (content_category / plazo / inversion).
// "Plataforma" → "plataforma_enlatada", "A medida" → "a_medida"… (valores que espera Meta del lado B2B).
const CATEGORIA: Record<string, string> = { plataforma: "plataforma_enlatada", "a medida": "a_medida", fichas: "fichas", crm: "crm" };

// Productos que el operador puede marcar en el Inbox (mismo orden que el selector).
export const CATEGORIAS = ["Plataforma", "A medida", "Fichas", "CRM"] as const;

// El valor EXACTO de content_category que esperan las reglas de las conversiones en Meta.
export function contentCategory(categoria: string | null | undefined): string | undefined {
  const cat = categoria?.trim().toLowerCase();
  if (!cat) return undefined;
  return CATEGORIA[cat] ?? cat.replace(/\s+/g, "_");
}

export function customDataLanding(d: { categoria?: string; plazo?: string; inversion?: string }): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  const cc = contentCategory(d.categoria);
  if (cc) out.content_category = cc;
  if (d.plazo) out.plazo = d.plazo;
  if (d.inversion) out.inversion = d.inversion;
  if (Object.keys(out).length) out.origen = "landing";
  return Object.keys(out).length ? out : undefined;
}
