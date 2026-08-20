// Pixel de MARKETING de Publi.lat (dataset "Clientes-publilat"): eventos del embudo de auto-alta que
// vende Publi.lat en sí (NO el pixel del cliente). Lead/CompleteRegistration al registrarse desde la
// landing + Purchase al pagar los días → Meta optimiza el anuncio por COMPRADORES reales.
// Gateado por env: sin PUBLILAT_MKT_PIXEL_ID + PUBLILAT_MKT_CAPI_TOKEN es no-op. Best-effort: nunca frena.
import { sendCapiEvent } from "./meta-capi.js";

const PIXEL = (process.env.PUBLILAT_MKT_PIXEL_ID ?? "").trim();
const TOKEN = (process.env.PUBLILAT_MKT_CAPI_TOKEN ?? "").trim();

export function marketingPixelEnabled(): boolean {
  return PIXEL.length > 0 && TOKEN.length > 0;
}

export interface MarketingEvent {
  eventName: "Lead" | "CompleteRegistration" | "Purchase";
  externalId: string;   // el MISMO en registro y compra (user.id) → matchea Lead↔Purchase
  fbp?: string | null;
  fbc?: string | null;
  phone?: string | null;
  firstName?: string | null;
  value?: number;       // solo Purchase
  currency?: string;    // ej "ARS"
  eventId?: string;     // dedup con el pixel del navegador
  clientIp?: string;
  userAgent?: string;
}

export async function fireMarketingEvent(e: MarketingEvent): Promise<void> {
  if (!marketingPixelEnabled()) return;
  try {
    await sendCapiEvent({
      pixelId: PIXEL,
      capiToken: TOKEN,
      eventName: e.eventName,
      externalId: e.externalId,
      fbp: e.fbp ?? undefined,
      fbc: e.fbc ?? undefined,
      phone: e.phone ?? undefined,
      firstName: e.firstName ?? undefined,
      value: e.value,
      currency: e.currency,
      eventId: e.eventId,
      clientIp: e.clientIp,
      userAgent: e.userAgent,
    });
  } catch (err) {
    console.error("[mkt-capi]", e.eventName, err instanceof Error ? err.message : String(err));
  }
}
