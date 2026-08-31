// Plantilla del mensaje a un lead: {{nombre}} (primer nombre), {{nombre_completo}}, {{email}} y
// {{respuesta}} (la 1ª respuesta del formulario que NO es un dato de contacto — suele ser "qué te
// interesa"). Vive en lib/ para que lo usen tanto el auto-responder (routes/leadgen) como el motor
// de envíos masivos (lib/bulk-sender) sin dependencia circular.
export interface LeadData {
  name: string | null;
  phone: string | null;
  email: string | null;
  answers: Array<{ q: string; a: string }>;
}

const CONTACT_FIELDS = [
  "full_name", "name", "nombre", "nombre_completo",
  "phone_number", "phone", "telefono", "teléfono", "celular",
  "email", "correo",
];

export function renderLeadReply(tpl: string, lead: LeadData): string {
  const full = (lead.name ?? "").trim();
  const first = full.split(/\s+/)[0] ?? "";
  const extra = lead.answers.find((x) => !CONTACT_FIELDS.includes((x.q ?? "").toLowerCase()) && (x.a ?? "").trim())?.a ?? "";
  return tpl
    .replace(/\{\{\s*nombre_completo\s*\}\}/gi, full)
    .replace(/\{\{\s*nombre\s*\}\}/gi, first)
    .replace(/\{\{\s*email\s*\}\}/gi, lead.email ?? "")
    .replace(/\{\{\s*respuesta\s*\}\}/gi, extra)
    .trim();
}
