// Puente entre el PORTAL de clientes de Lucky Soft (softlucky.com/portal) y el grupo SOPORTE de WhatsApp
// (2026-10-23). Cada ticket del portal es un hilo más del relay (lib/soporte-relay.ts):
//   - Entrada: el portal llama POST /api/soporte/portal/mensaje (firmado) por cada ticket nuevo o mensaje del
//     cliente → se reenvía a SOPORTE con el código del hilo, igual que un grupo de cliente.
//   - Salida: el equipo responde en SOPORTE con "B- …" citando ese mensaje → se llama al webhook del portal
//     (firmado). El portal guarda la respuesta en el ticket y le manda el CORREO al cliente: publi.lat NO
//     manda correo (si no, le llegan dos).
// Firma: HMAC-SHA256 en hex del cuerpo crudo con PORTAL_RELAY_SECRET, en el header X-Firma ("sha256=" opcional).
import crypto from "node:crypto";

export const secretoPortal = () => process.env.PORTAL_RELAY_SECRET ?? "";
const urlRespuesta = () => process.env.PORTAL_RESPUESTA_URL ?? "https://softlucky.com/portal/api/soporte-respuesta.php";

export function firmar(cuerpo: string | Buffer, secreto = secretoPortal()): string {
  return crypto.createHmac("sha256", secreto).update(cuerpo).digest("hex");
}

/** ¿El header X-Firma corresponde al cuerpo crudo? Comparación en tiempo constante. */
export function firmaValida(cuerpo: Buffer | undefined, header: string | undefined, secreto = secretoPortal()): boolean {
  if (!secreto || !cuerpo || !cuerpo.length || !header) return false;
  const recibida = header.trim().replace(/^sha256=/i, "").toLowerCase();
  const esperada = firmar(cuerpo, secreto);
  const a = Buffer.from(recibida), b = Buffer.from(esperada);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export interface MensajePortal {
  code: string;
  ticketId: string;
  cliente: string;
  email: string;
  asunto: string;
  mensaje: string;
  categoria?: string;
  prioridad?: string;
  url?: string;
}

/** Lo que se deja en SOPORTE por un mensaje del portal. Mismo estilo que los grupos (🆕 #código …). */
export function textoDesdePortal(m: MensajePortal): string {
  const etiquetas = [m.categoria, m.prioridad ? `prioridad ${m.prioridad}` : ""].filter(Boolean).join(" · ");
  return [
    `🆕 #${m.code} · Portal · Ticket ${m.ticketId}${m.asunto ? ` · ${m.asunto}` : ""}`,
    `👤 ${m.cliente || "Cliente"}${m.email ? ` (${m.email})` : ""}`,
    ...(etiquetas ? [`🏷️ ${etiquetas}`] : []),
    "",
    m.mensaje.trim() || "(mensaje vacío)",
    "",
    ...(m.url ? [`🔗 ${m.url}`] : []),
    "↩️ Para contestarle en el portal (le llega por correo): respondé ESTE mensaje citándolo y empezá con B-",
  ].join("\n");
}

// ============================ Envíos salientes (facturas) ============================

export type DestinoPortal =
  | { ok: true; chatId: string; log: string }
  | { ok: false; status: number; error: string };

/**
 * Adónde manda el portal: el grupo (por JID, o por nombre EXACTO sin espacios a los costados e ignorando
 * mayúsculas, entre los grupos del número de soporte) o, sin grupo, el 1 a 1 de `to`. Nunca adivina:
 * sin coincidencia o con más de una devuelve 404.
 */
export function resolverDestino(grupo: string, to: string, grupos: { jid: string; nombre: string }[]): DestinoPortal {
  const g = grupo.trim();
  if (g) {
    if (/^[\d-]+@g\.us$/i.test(g)) return { ok: true, chatId: g, log: g };
    const buscado = g.toLowerCase();
    const hits = grupos.filter((x) => x.nombre.trim().toLowerCase() === buscado);
    if (hits.length === 1) return { ok: true, chatId: hits[0].jid, log: hits[0].jid };
    return { ok: false, status: 404, error: hits.length ? "grupo ambiguo" : "grupo no encontrado" };
  }
  const t = to.trim();
  if (!/^\d{8,15}$/.test(t)) return { ok: false, status: 422, error: "to inválido (solo dígitos con código de país)" };
  return { ok: true, chatId: `${t}@c.us`, log: `…${t.slice(-4)}` };
}

/**
 * Manda la respuesta "B-" al ticket del portal. Reintenta 3 veces ante error de red o 5xx (el portal es
 * idempotente por eventoId: un reintento no duplica). Devuelve el estado que deja el portal o el error.
 */
export async function responderEnPortal(r: { ticketId: string; mensaje: string; eventoId: string }): Promise<{ ok: boolean; estado?: string; error?: string }> {
  if (!secretoPortal()) return { ok: false, error: "falta PORTAL_RELAY_SECRET" };
  const cuerpo = JSON.stringify({ ticketId: r.ticketId, mensaje: r.mensaje, autor: "Soporte Lucky Soft", ts: new Date().toISOString(), eventoId: r.eventoId });
  let ultimo = "";
  for (let intento = 1; intento <= 3; intento++) {
    try {
      const res = await fetch(urlRespuesta(), {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Firma": firmar(cuerpo) },
        body: cuerpo,
        signal: AbortSignal.timeout(15_000),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; estado?: string; error?: string };
      if (res.ok) return { ok: true, estado: data.estado };
      ultimo = `HTTP ${res.status}${data.error ? ` (${data.error})` : ""}`;
      if (res.status < 500) break; // 401/404/400: reintentar no lo arregla
    } catch (e) {
      ultimo = e instanceof Error ? e.message : String(e);
    }
    await new Promise((z) => setTimeout(z, intento * 2000));
  }
  return { ok: false, error: ultimo };
}
