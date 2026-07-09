export type Stage = "NUEVO" | "CONTACTADO" | "INTERESADO" | "COMPRO" | "PERDIDO";

export interface User {
  id: string;
  email: string;
  slug: string;
  name?: string | null;
  role?: "USER" | "ADMIN";
}

export interface Lead {
  id: string;
  externalId: string;
  name: string | null;
  phone?: string | null;
  stage: Stage;
  source: string | null;
  campaignId: string | null;
  adId: string | null;
  pixelId: string | null;
  fbclid: string | null;
  code: string | null;
  landingUrl: string | null;
  amount: number | null;
  purchasedAt: string | null;
  paymentDetected?: boolean;
  paymentDetectedAmount?: number | null; // centavos
  createdAt: string;
}

export interface Line {
  id: string;
  phone: string;
  label: string | null;
  status: string;
  provider: "baileys" | "cloud" | "external";
  connected: boolean;
  expiresAt: string | null;
  createdAt: string;
  // Cloud API (CTWA):
  wabaPhoneNumberId?: string | null;
  wabaId?: string | null;
  verifyToken?: string | null;
  tokenMask?: string | null;
  webhookUrl?: string | null;
  registered?: boolean;
  qualityRating?: string | null; // Cloud API: GREEN | YELLOW | RED
}

export interface Msg {
  id: string;
  direction: "in" | "out";
  body: string;
  status?: "sent" | "delivered" | "read" | "failed" | null; // ack de WhatsApp (solo salientes)
  error?: string | null; // motivo si WhatsApp rechazó el envío
  mediaUrl?: string | null; // data URL de la imagen (comprobante), si el mensaje trae una
  createdAt: string;
}

export interface LeadDetail extends Lead {
  phone: string | null;
  line: { phone: string; label: string | null } | null;
}

export interface Pixel {
  id: string;
  pixelId: string;
  eventType: "Lead" | "Purchase";
  siteUrl: string | null;
  tokenMask: string;
  createdAt: string;
}
