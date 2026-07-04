// Lead de anuncios Click-to-WhatsApp (CTWA): dispara el Lead por CAPI con
// action_source=business_messaging + ctwa_clid. Compartido por ambos webhooks
// (Cloud API oficial y Baileys/Evolution — los mensajes de CTWA traen el clid
// en el contextInfo.externalAdReply aunque no pasen por la landing).
import { prisma } from "./prisma.js";
import { resolveUserPixel } from "./pixel.js";
import { sendCapiEvent } from "./meta-capi.js";

export async function fireCtwaLead(
  userId: string,
  contact: { id: string; externalId: string; phone: string | null; ctwaClid: string | null },
): Promise<void> {
  const creds = await resolveUserPixel(userId, "Lead");
  const metaEvent = await prisma.metaEvent.create({
    data: {
      userId,
      contactId: contact.id,
      eventName: "Lead",
      pixelId: creds?.pixelId ?? process.env.META_PIXEL_ID ?? "",
      payload: {},
      status: "pending",
    },
  });
  try {
    const result = await sendCapiEvent({
      eventName: "Lead",
      externalId: contact.externalId,
      phone: contact.phone ?? undefined,
      actionSource: "business_messaging",
      ctwaClid: contact.ctwaClid ?? undefined,
      eventId: contact.externalId,
      pixelId: creds?.pixelId,
      capiToken: creds?.capiToken,
    });
    await prisma.metaEvent.update({
      where: { id: metaEvent.id },
      data: { status: "sent", pixelId: result.pixelId, payload: result.payload as object, response: result.response as object },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[CTWA Lead] error:", message);
    await prisma.metaEvent.update({ where: { id: metaEvent.id }, data: { status: "failed", response: { error: message } } });
  }
}

// Extrae la atribución CTWA de un mensaje crudo de Baileys/Evolution.
// Los mensajes que vienen de un anuncio Click-to-WhatsApp traen contextInfo.externalAdReply
// con ctwaClid (y sourceId/sourceUrl del anuncio), en cualquier tipo de mensaje.
export interface CtwaRef { ctwaClid: string; sourceId?: string; sourceUrl?: string }
export function extractCtwaFromBaileys(item: Record<string, any>): CtwaRef | null {
  const msg = item?.message ?? {};
  const candidates = [
    msg?.extendedTextMessage?.contextInfo,
    msg?.conversation?.contextInfo,
    msg?.imageMessage?.contextInfo,
    msg?.videoMessage?.contextInfo,
    msg?.buttonsResponseMessage?.contextInfo,
    msg?.templateButtonReplyMessage?.contextInfo,
    item?.contextInfo,
  ];
  for (const ctx of candidates) {
    const ad = ctx?.externalAdReply;
    const clid: string | undefined = ad?.ctwaClid ?? ctx?.ctwaClid;
    if (clid && typeof clid === "string") {
      return { ctwaClid: clid, sourceId: ad?.sourceId ?? undefined, sourceUrl: ad?.sourceUrl ?? undefined };
    }
  }
  return null;
}
