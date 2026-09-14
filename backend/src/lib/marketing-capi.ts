// Pixel de MARKETING de Publi.lat (dataset "Publi.lat Clientes"): eventos del embudo de auto-alta que
// vende Publi.lat en sí (NO el pixel del cliente). CompleteRegistration al registrarse (landing externa o
// panel) + Purchase al pagar los días → Meta optimiza el anuncio por COMPRADORES reales.
// Gateado por env: sin PUBLILAT_MKT_PIXEL_ID + PUBLILAT_MKT_CAPI_TOKEN es no-op. Best-effort: nunca frena.
// El env se lee en CADA llamada (no al importar): si se carga el token con el proceso vivo, arranca solo.
import { sendCapiEvent } from "./meta-capi.js";

const pixelId = () => (process.env.PUBLILAT_MKT_PIXEL_ID ?? "").trim();
const capiToken = () => (process.env.PUBLILAT_MKT_CAPI_TOKEN ?? "").trim();

export function marketingPixelEnabled(): boolean {
  return pixelId().length > 0 && capiToken().length > 0;
}

// Config PÚBLICA para el frontend (pixel del navegador en login/registro). Nunca expone el token.
export function publicMarketingConfig(): { mktPixelId: string | null } {
  const id = pixelId();
  return { mktPixelId: id || null };
}

export interface MarketingEvent {
  eventName: "Lead" | "CompleteRegistration" | "Purchase";
  externalId: string;   // el MISMO en registro y compra (user.id) → matchea Registro↔Purchase
  email?: string | null;
  fbp?: string | null;
  fbc?: string | null;
  phone?: string | null;
  firstName?: string | null;
  value?: number;       // solo Purchase
  currency?: string;    // ej "PYG"
  eventId?: string;     // dedup con el pixel del navegador
  clientIp?: string;
  userAgent?: string;
}

export async function fireMarketingEvent(e: MarketingEvent): Promise<void> {
  if (!marketingPixelEnabled()) return;
  try {
    const r = await sendCapiEvent({
      pixelId: pixelId(),
      capiToken: capiToken(),
      eventName: e.eventName,
      externalId: e.externalId,
      email: e.email ?? undefined,
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
    console.log(`[mkt-capi] ${e.eventName} OK pixel ${r?.pixelId ?? pixelId()} (ext ${e.externalId})`);
  } catch (err) {
    console.error("[mkt-capi]", e.eventName, err instanceof Error ? err.message : String(err));
  }
}
