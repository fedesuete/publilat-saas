// Cargas del formulario de una landing B2B (2026-10-19, landing de Lucky Soft): TODA carga, califique o no, se
// guarda (LandingSubmission), le avisa al dueño por WhatsApp con un link wa.me para escribirle, y manda a Meta un
// SubmitApplication (solo para medir el embudo visitas → cargas → calificados). El Lead NO pasa por acá: sigue
// saliendo SOLO de /api/land/track y solo para el que califica (hay campañas optimizando sobre ese evento).
//
// Este archivo es lógica pura (texto del aviso, país, etiquetas): sin base ni red, para poder testearla.

export interface RespuestasCarga {
  rubro?: string; // casino | cajero | otro
  que?: string; // Plataforma | Fichas | CRM
  cuando?: string; // ya | mes | mirando
  inv?: string; // simple | unico | no
}

const RUBRO: Record<string, string> = { casino: "Casino online", cajero: "Cajero (carga fichas a jugadores)", otro: "Otro rubro (IPTV/TV/streaming/otro)" };
const QUE: Record<string, string> = { Plataforma: "Plataforma propia", Fichas: "Fichas para revender", CRM: "Solo el CRM" };
const CUANDO: Record<string, string> = { ya: "Ya, esta semana", mes: "Este mes", mirando: "Solo está averiguando" };
const INV: Record<string, string> = { simple: "Plan Simple USD 200/mes", unico: "Pago único desde USD 2.500", no: "Todavía no tiene para invertir" };

// Prefijos internacionales de los países del selector de la landing (el más largo primero).
const PAISES: [string, string][] = [
  ["595", "Paraguay"], ["598", "Uruguay"], ["591", "Bolivia"], ["593", "Ecuador"], ["54", "Argentina"],
  ["56", "Chile"], ["57", "Colombia"], ["52", "México"], ["51", "Perú"], ["55", "Brasil"],
];

/** País a partir del teléfono internacional (solo dígitos). */
export function paisDeTelefono(tel: string | null | undefined): string {
  const d = (tel ?? "").replace(/\D/g, "");
  if (!d) return "—";
  return PAISES.find(([p]) => d.startsWith(p))?.[1] ?? "Otro";
}

/** Fecha y hora de Paraguay (UTC−3, sin horario de verano desde 2024). */
export function horaParaguay(d: Date): string {
  const p = new Date(d.getTime() - 3 * 3600e3);
  const dd = String(p.getUTCDate()).padStart(2, "0"), mm = String(p.getUTCMonth() + 1).padStart(2, "0");
  const hh = String(p.getUTCHours()).padStart(2, "0"), mi = String(p.getUTCMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${p.getUTCFullYear()} ${hh}:${mi}`;
}

/** Anuncio si vino con fbclid / cookie _fbc / utm de Meta; si no, orgánico. */
export function origenCarga(d: { fbclid?: string | null; fbc?: string | null; utm?: string | null }): string {
  if (d.fbclid || d.fbc) return "anuncio (Meta)";
  if (d.utm) return `campaña (${d.utm})`;
  return "orgánico / directo";
}

export interface DatosAviso {
  marca: string;
  nombre?: string | null;
  telefono?: string | null;
  respuestas: RespuestasCarga;
  califica: boolean;
  motivo?: string | null;
  fbclid?: string | null;
  fbc?: string | null;
  utm?: string | null;
  creada: Date;
  nota?: string; // línea extra (ej. "carga anterior, reenviada")
}

/** Texto del aviso de WhatsApp al dueño. El link wa.me es lo principal: un toque y le escribe. */
export function textoAvisoCarga(d: DatosAviso): string {
  const tel = (d.telefono ?? "").replace(/\D/g, "");
  const r = d.respuestas;
  const plan = r.que === "Plataforma" ? INV[r.inv ?? ""] ?? "—" : "No aplica";
  return [
    `🎯 *Nueva carga — ${d.marca}*`,
    ...(d.nota ? [`_${d.nota}_`] : []),
    `Nombre: ${d.nombre?.trim() || "—"}`,
    `Teléfono: ${tel ? "+" + tel : "—"}`,
    `Escribirle: ${tel ? "https://wa.me/" + tel : "— (no dejó un número válido)"}`,
    `País: ${paisDeTelefono(tel)}`,
    `Tipo de negocio: ${RUBRO[r.rubro ?? ""] ?? "—"}${r.que ? " · " + (QUE[r.que] ?? r.que) : ""}`,
    `¿Cuándo arranca?: ${CUANDO[r.cuando ?? ""] ?? "—"}`,
    `Plan: ${plan}`,
    `CALIFICA: ${d.califica ? "SÍ" : `NO — ${d.motivo?.trim() || "sin motivo"}`}`,
    `Vino de: ${origenCarga(d)}`,
    `Cargado: ${horaParaguay(d.creada)} (hora Paraguay)`,
  ].join("\n");
}
