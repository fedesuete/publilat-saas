// custom_data del Lead de una landing calificada (embudo B2B de Lucky Soft): las respuestas del formulario
// viajan a Meta para armar conversiones personalizadas (content_category / plazo / inversion).
// "Plataforma" → "plataforma_enlatada", "A medida" → "a_medida"… (valores que espera Meta del lado B2B).
const CATEGORIA: Record<string, string> = { plataforma: "plataforma_enlatada", "a medida": "a_medida", fichas: "fichas", crm: "crm" };
export function customDataLanding(d: { categoria?: string; plazo?: string; inversion?: string }): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  const cat = d.categoria?.trim().toLowerCase();
  if (cat) out.content_category = CATEGORIA[cat] ?? cat.replace(/\s+/g, "_");
  if (d.plazo) out.plazo = d.plazo;
  if (d.inversion) out.inversion = d.inversion;
  if (Object.keys(out).length) out.origen = "landing";
  return Object.keys(out).length ? out : undefined;
}
