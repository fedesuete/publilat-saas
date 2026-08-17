// Cliente mínimo de la API v4 de Kommo para la integración "estilo ScaleOS": el cliente pega su
// URL + token de larga duración en el panel, Kommo nos manda sus webhooks y nosotros leemos el
// lead/contacto por la API para cerrar el loop (etapa ganada -> Purchase CAPI).
//
// SSRF guard: SOLO aceptamos hosts *.kommo.com — la URL la escribe el usuario a mano y sin este
// guard el server podría terminar fetch-eando un host interno (mismo criterio que el fix C2).
// Best-effort en todo: cualquier fallo devuelve null y el caller decide (nunca rompe el webhook).

const KOMMO_HOST = /^[a-z0-9][a-z0-9-]*\.kommo\.com$/i;

// Normaliza la URL base cargada por el usuario ("https://miempresa.kommo.com/loquesea" ->
// "https://miempresa.kommo.com"), o null si no es un dominio de Kommo válido.
export function normalizeKommoBase(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (!KOMMO_HOST.test(url.hostname)) return null;
  return `https://${url.hostname.toLowerCase()}`;
}

async function kommoGet(baseUrl: string, token: string, path: string): Promise<unknown | null> {
  // Re-validamos la base SIEMPRE (defensa en profundidad: aunque en la DB entre algo raro, acá no sale).
  if (!normalizeKommoBase(baseUrl)) return null;
  try {
    const r = await fetch(`${baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    return (await r.json()) as unknown;
  } catch {
    return null;
  }
}

export interface KommoLeadInfo {
  price: number;
  statusId: number;
  pipelineId: number;
  contactIds: string[];
}

// Lead con sus contactos embebidos (precio para el monto del Purchase + contactos para el teléfono).
export async function kommoLead(baseUrl: string, token: string, leadId: string): Promise<KommoLeadInfo | null> {
  const data = (await kommoGet(baseUrl, token, `/api/v4/leads/${encodeURIComponent(leadId)}?with=contacts`)) as {
    price?: number; status_id?: number; pipeline_id?: number;
    _embedded?: { contacts?: Array<{ id?: number | string; is_main?: boolean }> };
  } | null;
  if (!data) return null;
  const contacts = data._embedded?.contacts ?? [];
  // El contacto principal primero (suele ser el que tiene el teléfono del cliente).
  contacts.sort((a, b) => Number(b.is_main ?? false) - Number(a.is_main ?? false));
  return {
    price: Number(data.price ?? 0),
    statusId: Number(data.status_id ?? 0),
    pipelineId: Number(data.pipeline_id ?? 0),
    contactIds: contacts.map((c) => String(c.id ?? "")).filter(Boolean),
  };
}

// Teléfono de un contacto de Kommo (custom field con field_code PHONE).
export async function kommoContactPhone(baseUrl: string, token: string, contactId: string): Promise<string | null> {
  const data = (await kommoGet(baseUrl, token, `/api/v4/contacts/${encodeURIComponent(contactId)}`)) as {
    custom_fields_values?: Array<{ field_code?: string; values?: Array<{ value?: unknown }> }>;
  } | null;
  const phoneField = data?.custom_fields_values?.find((f) => (f.field_code ?? "").toUpperCase() === "PHONE");
  const value = String(phoneField?.values?.[0]?.value ?? "").replace(/\D/g, "");
  return value || null;
}

// Nombre de una etapa del pipeline (para la heurística de "ganado"). Con cache en memoria (10 min):
// cada movimiento de lead dispara un webhook y sin cache le pegaríamos a la API de Kommo por CADA
// arrastre de tarjeta en embudos con miles de leads.
const statusNameCache = new Map<string, { name: string | null; at: number }>();
const STATUS_CACHE_MS = 10 * 60 * 1000;
export async function kommoStatusName(baseUrl: string, token: string, pipelineId: string, statusId: string): Promise<string | null> {
  const key = `${baseUrl}|${pipelineId}|${statusId}`;
  const hit = statusNameCache.get(key);
  if (hit && Date.now() - hit.at < STATUS_CACHE_MS) return hit.name;
  const data = (await kommoGet(
    baseUrl, token,
    `/api/v4/leads/pipelines/${encodeURIComponent(pipelineId)}/statuses/${encodeURIComponent(statusId)}`
  )) as { name?: string } | null;
  const name = data?.name ?? null;
  if (name !== null) statusNameCache.set(key, { name, at: Date.now() }); // los fallos no se cachean
  return name;
}

// En Kommo/amoCRM los ids 142/143 son UNIVERSALES: 142 = "Closed - won", 143 = "Closed - lost".
export const KOMMO_WON_STATUS_ID = 142;
export const KOMMO_LOST_STATUS_ID = 143;

// Heurística de etapa "ganada" por NOMBRE (estilo ScaleOS): ganado/compró/venta/won/aprobado/pagado…
// Con guard negativo: "cerrado PERDIDO" no es venta aunque contenga "cerrad".
export function isWonStageName(name: string): boolean {
  if (/perdid|lost|rechazad|cancelad/i.test(name)) return false;
  // "Logrado con éxito" es la etapa ganada DEFAULT de Kommo en español. "cargad/acredit" = jerga
  // casino ("CARGADO $$$" en el embudo de Fortune): el jugador depositó. OJO: "NO CARGO" no matchea
  // /cargad/ (termina en "cargo"), así que la columna de los que NO depositaron queda afuera.
  return /ganad|compr[oó]|venta|vendid|won|cerrad|aprobad|pagad|logrado|[ée]xito|cargad|acredit/i.test(name);
}

// Extrae el código de referencia (ref:XXXX del /go) del texto de un mensaje. Mismo espíritu que el
// matcheo del webhook de WhatsApp: "ref:ABC123", "REF ABC123", "(ref: abc-123)".
export function extractRefFromText(text: string): string | null {
  const m = /\bref\b[\s:#-]*([A-Z0-9][A-Z0-9-]{2,15})/i.exec(text);
  if (!m) return null;
  const code = m[1].toUpperCase().replace(/[^A-Z0-9]/g, "");
  return code.length >= 3 ? code : null;
}
