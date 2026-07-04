// Envío de eventos a Meta Conversions API (server-side).
// Esta es la pieza que hace que Meta sepa quién compró y optimice por compradores.
import axios from "axios";
import crypto from "node:crypto";

// Defaults globales del .env (fallback). En multi-tenant cada usuario pasa su pixel/token.
const ENV_PIXEL_ID = process.env.META_PIXEL_ID ?? "";
const ENV_TOKEN = process.env.META_CAPI_TOKEN ?? "";
const ENV_TEST_CODE = process.env.META_TEST_EVENT_CODE || undefined;
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
  actionSource?: "website" | "business_messaging"; // default website (flujo landing)
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
  const pixelId = input.pixelId || ENV_PIXEL_ID;
  const token = input.capiToken || ENV_TOKEN;
  const testCode = input.testEventCode ?? ENV_TEST_CODE;

  if (!pixelId || !token) {
    throw new Error("Falta pixelId/capiToken (ni en el usuario ni en .env)");
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
  } else {
    event.event_source_url = input.eventSourceUrl || SOURCE_URL;
  }

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
