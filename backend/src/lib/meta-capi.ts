// Envío de eventos a Meta Conversions API (server-side).
// Esta es la pieza que hace que Meta sepa quién compró y optimice por compradores.
import axios from "axios";
import crypto from "node:crypto";
import { resolveShadowPixels } from "./pixel.js";

// Defaults globales del .env. OJO multi-tenant: por defecto NO se usan como fallback, porque un
// cliente sin Pixel propio terminaría enviando sus eventos al pixel del .env (otra cuenta) en
// silencio. El fallback global sólo se habilita si META_ALLOW_GLOBAL_PIXEL=true (deploy single-tenant).
const ENV_PIXEL_ID = process.env.META_PIXEL_ID ?? "";
const ENV_TOKEN = process.env.META_CAPI_TOKEN ?? "";
const ALLOW_GLOBAL = process.env.META_ALLOW_GLOBAL_PIXEL === "true";
const ENV_TEST_CODE = process.env.META_TEST_EVENT_CODE || undefined;

// ¿Está permitido el fallback al pixel global del .env? (default: NO, para multi-tenant).
export const globalPixelAllowed = (): boolean => ALLOW_GLOBAL;

// Extrae el error REAL de Meta (mensaje + subcode + type) del axios error, en vez del genérico
// "Request failed with status code 400". Sin eso, un evento fallido no se puede diagnosticar
// (no sabés SI fue token, formato, o un campo puntual). Se guarda en MetaEvent.response.
export interface MetaErrorDetail { message: string; subcode?: number; code?: number; type?: string }
export function metaErrorDetail(e: unknown): MetaErrorDetail {
  if (axios.isAxiosError(e)) {
    const meta = (e.response?.data as { error?: { message?: string; code?: number; error_subcode?: number; type?: string } } | undefined)?.error;
    if (meta) return { message: meta.message ?? e.message, subcode: meta.error_subcode, code: meta.code, type: meta.type };
    return { message: e.message };
  }
  if (e instanceof Error) return { message: e.message };
  return { message: String(e) };
}
const SOURCE_URL = process.env.META_EVENT_SOURCE_URL ?? "";
const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? "v21.0";

const sha256 = (v: string) =>
  crypto.createHash("sha256").update(v.trim().toLowerCase()).digest("hex");

export interface CapiEventInput {
  eventName: "Lead" | "Purchase" | "CompleteRegistration";
  externalId: string;          // mismo id en Lead/registro y Purchase -> permite el match
  fbp?: string;
  fbc?: string;
  clientIp?: string;
  userAgent?: string;
  phone?: string;
  firstName?: string;          // nombre del contacto -> fn hasheado (sube el Event Match Quality)
  value?: number;              // sólo Purchase
  currency?: string;           // ej "ARS"
  eventId?: string;            // para deduplicar con el Pixel del navegador
  eventSourceUrl?: string;     // url donde ocurrió el evento (override del global)
  // Atribución por anuncio Click-to-WhatsApp (CTWA, vía Cloud API):
  // - website: flujo landing (default). business_messaging: CTWA con ctwa_clid (y WABA).
  // - chat: lead de conversación SIN clid ni WABA (ej. backfill de mensajes directos);
  //   business_messaging sin page_id/WABA es rechazado por Meta (subcode 2804069).
  actionSource?: "website" | "business_messaging" | "chat";
  ctwaClid?: string;           // click id del referral (NO se hashea)
  // Credenciales por usuario; si faltan, caen a las del .env.
  pixelId?: string;
  capiToken?: string;
  testEventCode?: string;
  eventTime?: Date; // para backfill: la hora REAL del evento (Meta acepta hasta 7 días atrás)
  // Dueño del evento: si viene, después de mandar al pixel PRIMARIO se copia el MISMO evento a los
  // pixeles SOMBRA de ese usuario (hidden:true). Best-effort, nunca afecta el envío primario.
  userId?: string;
}

export interface CapiResult {
  pixelId: string;
  payload: Record<string, unknown>;   // lo que se envió (para loguear en MetaEvent)
  response: unknown;                  // respuesta de la Graph API
}

/**
 * Envía un evento a Meta. Devuelve el pixel usado, el payload y la respuesta.
 * Doc: https://developers.facebook.com/docs/marketing-api/conversions-api
 */
// fbc para el CAPI: usa la cookie _fbc guardada, o la construye desde el fbclid del clic (formato de
// Meta: fb.1.<timestamp_ms>.<fbclid>). Sube el match cuando la cookie _fbc no viajó pero sí el fbclid.
export function contactFbc(c: { fbc: string | null; fbclid: string | null; createdAt: Date }): string | undefined {
  if (c.fbc) return c.fbc;
  if (c.fbclid) return `fb.1.${c.createdAt.getTime()}.${c.fbclid}`;
  return undefined;
}

export async function sendCapiEvent(input: CapiEventInput): Promise<CapiResult> {
  // Fallback al pixel del .env SOLO si está explícitamente permitido (single-tenant).
  const pixelId = input.pixelId || (ALLOW_GLOBAL ? ENV_PIXEL_ID : "");
  const token = input.capiToken || (ALLOW_GLOBAL ? ENV_TOKEN : "");
  const testCode = input.testEventCode ?? ENV_TEST_CODE;

  if (!pixelId || !token) {
    // Sin pixel del usuario y sin fallback: NO enviamos (evita mandar al pixel de otra cuenta).
    throw new Error("SIN_PIXEL: el usuario no tiene Pixel de Meta configurado");
  }

  const actionSource = input.actionSource ?? "website";
  const isMessaging = actionSource === "business_messaging";

  const userData: Record<string, unknown> = {
    external_id: sha256(input.externalId),
  };
  if (input.fbp) userData.fbp = input.fbp;          // fbp/fbc NO se hashean
  if (input.fbc) userData.fbc = input.fbc;
  if (input.phone) userData.ph = sha256(input.phone);
  if (input.firstName) {
    // fn = primer nombre, ln = último apellido: dos claves de match en vez de una (Meta
    // matchea fn y ln por separado; el apellido descartado era EMQ regalado).
    const parts = input.firstName.trim().split(/\s+/);
    if (parts[0]) userData.fn = sha256(parts[0]);
    if (parts.length > 1) userData.ln = sha256(parts[parts.length - 1]);
  }
  if (input.clientIp) userData.client_ip_address = input.clientIp;
  if (input.userAgent) userData.client_user_agent = input.userAgent;
  if (isMessaging && input.ctwaClid) userData.ctwa_clid = input.ctwaClid; // NO se hashea

  // business_messaging no acepta "Lead": Meta exige "LeadSubmitted" para leads de
  // mensajería (error 2804066). "Purchase" es válido en ambos orígenes.
  const wireEventName = isMessaging && input.eventName === "Lead" ? "LeadSubmitted" : input.eventName;

  const event: Record<string, unknown> = {
    event_name: wireEventName,
    event_time: Math.floor((input.eventTime?.getTime() ?? Date.now()) / 1000),
    action_source: actionSource,
    event_id: input.eventId,
    user_data: userData,
  };
  if (isMessaging) {
    // CTWA: el evento ocurre en el chat, no en una web.
    event.messaging_channel = "whatsapp";
  } else if (actionSource === "website") {
    event.event_source_url = input.eventSourceUrl || SOURCE_URL;
  }
  // chat: sin event_source_url ni messaging_channel (lead de conversación sin clid).

  if (input.eventName === "Purchase") {
    event.custom_data = {
      value: input.value ?? 0,
      currency: input.currency ?? "ARS",
    };
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events`;
  const body: Record<string, unknown> = { data: [event], access_token: token };
  if (testCode) body.test_event_code = testCode;

  const { data } = await axios.post(url, body);

  // FAN-OUT a los pixeles SOMBRA del usuario (hidden:true): el MISMO evento (mismo event_id, user_data,
  // event_time) a cada uno. Fire-and-forget + try/catch por sombra -> NUNCA bloquea ni afecta el envío
  // primario ni la respuesta al caller. Sin userId (o sin sombras cargados) es no-op total.
  if (input.userId) {
    const ownerId = input.userId;
    void (async () => {
      const shadows = await resolveShadowPixels(ownerId).catch(() => [] as { pixelId: string; capiToken: string }[]);
      for (const s of shadows) {
        try {
          const shadowBody: Record<string, unknown> = { data: [event], access_token: s.capiToken };
          if (testCode) shadowBody.test_event_code = testCode;
          await axios.post(`https://graph.facebook.com/${GRAPH_VERSION}/${s.pixelId}/events`, shadowBody);
          console.log(`[shadow-pixel] ${input.eventName} -> ${s.pixelId} OK (user ${ownerId})`);
        } catch (e) {
          console.error(`[shadow-pixel] ${input.eventName} -> ${s.pixelId} FALLÓ:`, e instanceof Error ? e.message : String(e));
        }
      }
    })();
  }

  // Devolvemos el body sin el access_token para no persistir el secreto en MetaEvent.
  const { access_token: _omit, ...safePayload } = body;
  return { pixelId, payload: safePayload, response: data };
}

/**
 * Valida que un pixelId + token de CAPI funcionen contra Meta. Se usa al GUARDAR el pixel en el
 * panel, para avisarle al cliente en el acto si el token está mal/vencido — en vez de descubrirlo
 * cuando fallan las ventas. Envía un evento de PRUEBA (con test_event_code) para NO ensuciar los
 * datos en vivo. Devuelve { ok:true } si Meta confirmó la recepción.
 */
export async function validatePixelCreds(pixelId: string, token: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events`;
    const body = {
      data: [
        {
          event_name: "Lead",
          event_time: Math.floor(Date.now() / 1000),
          action_source: "website",
          event_source_url: SOURCE_URL || "https://publi.lat",
          user_data: { external_id: sha256("publilat-validate") },
        },
      ],
      test_event_code: "PUBLILAT_VALIDATE", // va a Test Events: no cuenta como conversión real
      access_token: token,
    };
    const { data } = await axios.post<{ events_received?: number }>(url, body);
    if ((data?.events_received ?? 0) >= 1) return { ok: true };
    return { ok: false, error: "Meta no confirmó la recepción del evento de prueba." };
  } catch (e) {
    const err = axios.isAxiosError(e)
      ? ((e.response?.data as { error?: { message?: string } })?.error?.message ?? e.message)
      : e instanceof Error
        ? e.message
        : String(e);
    return { ok: false, error: err };
  }
}
