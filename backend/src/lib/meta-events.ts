// Helper UNIFICADO para disparar los eventos de conversión a Meta (Lead / CompleteRegistration /
// Purchase). TODOS con el MISMO external_id del contacto → encadena el embudo Lead→Registro→Compra,
// con buena match quality (phone/fbp/fbc + nombre hasheado). Reusa sendCapiEvent (NO reimplementa
// CAPI), loguea en MetaEvent (visibilidad + reintento por la cola) y deduplica por event_id.
// Best-effort: si algo falla, NO frena el flujo de mensajes.
//
// external_id: Publi ya genera UNO estable por contacto (go.ts al clic, o el webhook al 1er inbound)
// y lo reusa en todos los eventos. Este helper SIEMPRE usa ese id (contact.externalId).
import { prisma } from "./prisma.js";
import { sendCapiEvent, globalPixelAllowed } from "./meta-capi.js";
import { resolveUserPixel } from "./pixel.js";
import { notifyMissingPixel } from "./capi-guard.js";
import { emitToUser } from "./io.js";
import { looksLikeCredentials } from "./funnel-detect.js";

export type MetaEventName = "Lead" | "CompleteRegistration" | "Purchase";

// Subconjunto de Contact que necesita el helper (para no acoplarse a todo el modelo).
export interface EventContact {
  id: string;
  userId: string;
  externalId: string;
  phone?: string | null;
  fbp?: string | null;
  fbc?: string | null;
  name?: string | null;
  ctwaClid?: string | null;
  landingUrl?: string | null;
  clientIp?: string | null;        // IP del visitante capturada en el clic de /go
  clientUserAgent?: string | null; // UA del visitante capturado en el clic de /go
}

export interface FireMetaOpts {
  value?: number;            // solo Purchase
  currency?: string;         // default ARS (todas las líneas son ARS)
  eventId?: string;          // default `${externalId}:${event}` — dedup con el pixel del navegador
  eventSourceUrl?: string;
  eventTime?: Date;          // backfill: hora real del evento (Meta acepta hasta 7 días atrás)
  oncePerContact?: boolean;  // si ya se mandó (sent) este evento para el contacto, NO re-dispara
}

export interface FireMetaResult {
  ok: boolean;
  skipped?: boolean;
  error?: string;
}

// BUG 1 fix: el Lead de OPTIMIZACIÓN se dispara en el PRIMER MENSAJE ENTRANTE, no en el clic de /go.
// Meta ya cuenta el clic (link click del anuncio); mandarle además un Lead por clic le enseña a
// optimizar por clics baratos que NO convierten (medido: 12.7k Leads vs ~7k mensajes; cuentas con 0-16%
// de clics que escriben). Por default aplica a TODAS las cuentas; `LEAD_ON_INBOUND_DEFAULT=off` vuelve
// al comportamiento viejo (Lead en el clic). El clic se sigue guardando (contacto + atribución) para
// analytics; solo NO dispara el Lead. OJO: este default afecta SOLO el timing del Lead — la
// auto-detección de pago y el auto-registro siguen gateados por el flag por-cuenta `User.leadOnInbound`.
export function leadOnInboundDefault(): boolean {
  return (process.env.LEAD_ON_INBOUND_DEFAULT ?? "on").toLowerCase() !== "off";
}

/**
 * Dispara un evento de conversión a Meta para un contacto. Punto ÚNICO de salida de eventos.
 */
export async function fireMetaEvent(
  contact: EventContact,
  eventName: MetaEventName,
  opts: FireMetaOpts = {},
): Promise<FireMetaResult> {
  // Idempotencia por contacto (opcional): un Lead/Registro por contacto. El Purchase suele ir por
  // carga (eventId propio), así que ese usa la dedup de Meta por event_id, no este guard.
  if (opts.oncePerContact) {
    const already = await prisma.metaEvent.findFirst({
      where: { contactId: contact.id, eventName, status: "sent" },
      select: { id: true },
    });
    if (already) return { ok: true, skipped: true };
  }

  const eventId = opts.eventId ?? `${contact.externalId}:${eventName.toLowerCase()}`;
  const creds = await resolveUserPixel(contact.userId, eventName);

  // Log del intento (visible en admin + reintentable por la cola CAPI si falla).
  const metaEvent = await prisma.metaEvent.create({
    data: { userId: contact.userId, contactId: contact.id, eventName, pixelId: creds?.pixelId ?? "", payload: {}, status: "pending" },
  });

  // Sin pixel del cliente (y sin fallback global): NO se manda, se avisa. Sin fuga a otro pixel.
  if (!creds && !globalPixelAllowed()) {
    await prisma.metaEvent.update({ where: { id: metaEvent.id }, data: { status: "no_pixel", response: { error: "SIN_PIXEL" } } });
    void notifyMissingPixel(contact.userId);
    return { ok: false, error: "SIN_PIXEL" };
  }

  const isCtwa = !!contact.ctwaClid;
  try {
    const result = await sendCapiEvent({
      eventName,
      userId: contact.userId, // copia a los pixeles sombra del usuario (fan-out best-effort)
      externalId: contact.externalId,                // el MISMO id en los 3 eventos → encadena
      fbp: contact.fbp ?? undefined,
      fbc: contact.fbc ?? undefined,
      phone: contact.phone ?? undefined,
      firstName: contact.name ?? undefined,          // fn/ln hasheados → sube el Event Match Quality
      clientIp: contact.clientIp ?? undefined,       // IP/UA del clic guardados en el contacto:
      userAgent: contact.clientUserAgent ?? undefined, // mismos que ya manda el Purchase
      ...(opts.value != null ? { value: opts.value, currency: opts.currency ?? "ARS" } : {}),
      eventId,
      eventSourceUrl: opts.eventSourceUrl ?? contact.landingUrl ?? undefined,
      actionSource: isCtwa ? "business_messaging" : "website",
      ctwaClid: contact.ctwaClid ?? undefined,
      pixelId: creds?.pixelId,
      capiToken: creds?.capiToken,
      ...(opts.eventTime ? { eventTime: opts.eventTime } : {}),
    });
    await prisma.metaEvent.update({
      where: { id: metaEvent.id },
      data: { status: "sent", pixelId: result.pixelId, payload: result.payload as object, response: result.response as object },
    });
    emitToUser(contact.userId, "meta:event", { contactId: contact.id, eventName });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[meta-events] ${eventName} falló:`, msg);
    await prisma.metaEvent.update({ where: { id: metaEvent.id }, data: { status: "failed", response: { error: msg } } });
    return { ok: false, error: msg };
  }
}

// Marca el REGISTRO COMPLETO de un contacto: dispara CompleteRegistration (una vez por contacto) y
// setea el flag registeredAt. Lo usa el override manual Y la auto-detección de credenciales.
export async function markRegistration(userId: string, contactId: string): Promise<FireMetaResult> {
  const contact = await prisma.contact.findFirst({ where: { id: contactId, userId } });
  if (!contact) return { ok: false, error: "not_found" };
  const r = await fireMetaEvent(contact, "CompleteRegistration", { oncePerContact: true });
  if (r.ok) {
    await prisma.contact
      .update({ where: { id: contact.id }, data: { registeredAt: contact.registeredAt ?? new Date() } })
      .catch(() => undefined);
    emitToUser(userId, "lead:registered", { contactId: contact.id });
  }
  return r;
}

// AUTO: si el operador acaba de mandar las CREDENCIALES (cuentas con leadOnInbound), marca el registro.
// Best-effort en background — NO frena el envío del mensaje. Idempotente (oncePerContact + flag).
export async function maybeAutoRegister(userId: string, contactId: string, operatorText: string): Promise<void> {
  try {
    if (!operatorText?.trim()) return;
    const owner = await prisma.user.findUnique({ where: { id: userId }, select: { leadOnInbound: true } });
    if (!owner?.leadOnInbound) return; // piloto: solo cuentas con el flag prendido
    if (!(await looksLikeCredentials(operatorText))) return; // patrón (gratis) → IA de respaldo
    await markRegistration(userId, contactId);
  } catch {
    /* best-effort: la detección nunca frena el flujo de mensajes */
  }
}
