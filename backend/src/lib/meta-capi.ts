// Envío de eventos a Meta Conversions API (server-side).
// Esta es la pieza que hace que Meta sepa quién compró y optimice por compradores.
import axios from "axios";
import crypto from "node:crypto";

// Defaults globales del .env. OJO multi-tenant: por defecto NO se usan como fallback, porque un
// cliente sin Pixel propio terminaría enviando sus eventos al pixel del .env (otra cuenta) en
// silencio. El fallback global sólo se habilita si META_ALLOW_GLOBAL_PIXEL=true (deploy single-tenant).
const ENV_PIXEL_ID = process.env.META_PIXEL_ID ?? "";
const ENV_TOKEN = process.env.META_CAPI_TOKEN ?? "";
const ALLOW_GLOBAL = process.env.META_ALLOW_GLOBAL_PIXEL === "true";
const ENV_TEST_CODE = process.env.META_TEST_EVENT_CODE || undefined;

// ¿Está permitido el fallback al pixel global del .env? (default: NO, para multi-tenant).
export const globalPixelAllowed = (): boolean => ALLOW_GLOBAL;
const SOURCE_URL = process.env.META_EVENT_SOURCE_URL ?? "";
const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? "v20.0";

const sha256 = (v: string) =>
  crypto.createHash("sha256").update(v.trim().toLowerCase()).digest("hex");

export interface CapiEventInput {
  eventName: "Lead" | "Purchase";
  externalId: string;          // mismo id en Lead y Purchase -> permite el match
  fbp?: string;
  fbc?: string;
  clientIp?: string;
  userAgent?: string;
  phone?: string;
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
