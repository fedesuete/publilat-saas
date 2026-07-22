// Marcar una venta: pasa el contacto a COMPRO, dispara el webhook al CRM y envía el
// Purchase a Meta por CAPI con el MISMO externalId/fbp/fbc + value (habilita el match).
// Se usa desde el endpoint /api/leads/:id/purchase Y desde la detección automática de pago.
import { prisma } from "./prisma.js";
import { sendCapiEvent, globalPixelAllowed } from "./meta-capi.js";
import { resolveUserPixel } from "./pixel.js";
import { fireIntegration } from "./integrations.js";
import { emitToUser } from "./io.js";
import { notify } from "./notifications.js";
import { notifyMissingPixel } from "./capi-guard.js";

export interface MarkPurchaseResult {
  ok: boolean;
  error?: string;
  capi?: unknown;
  lead: { id: string; stage: string; amount: number | null; purchasedAt: Date | null };
}

/**
 * Marca COMPRO y envía el Purchase. `amount` en unidad mayor (ej 1500.50 ARS);
 * se guarda en centavos (Int). Si Meta falla, la venta queda marcada igual (reintenta
 * la cola de CAPI). Devuelve ok=false con el detalle del error en ese caso.
 */
export async function markPurchase(
  userId: string,
  contactId: string,
  amount: number,
  currency = "ARS",
): Promise<MarkPurchaseResult | null> {
  const contact = await prisma.contact.findFirst({ where: { id: contactId, userId } });
  if (!contact) return null;

  // ¿Ya estaba marcada como compra? Entonces esto es una EDICIÓN del monto: conservamos la fecha
  // original y no re-notificamos "nueva venta" (evita ruido al corregir un monto mal cargado).
  const isEdit = contact.stage === "COMPRO";

  const updated = await prisma.contact.update({
    where: { id: contact.id },
    data: {
      stage: "COMPRO",
      amount: Math.round(amount * 100),
      purchasedAt: contact.purchasedAt ?? new Date(), // conserva la fecha original al editar
      paymentDetected: false,
    },
  });

  if (!isEdit) void notify(userId, "purchase", "¡Nueva venta! 🎉", `Se registró una compra de ${amount} ${currency}.`);

  // Webhook saliente al CRM externo (si está configurado). Best-effort.
  void fireIntegration(userId, "purchase", {
    contactId: contact.id,
    externalId: contact.externalId,
    amount,
    currency,
    code: contact.code,
    campaignId: contact.campaignId,
    source: contact.source,
  });

  const creds = await resolveUserPixel(userId, "Purchase");
  const metaEvent = await prisma.metaEvent.create({
    data: {
      userId,
      contactId: contact.id,
      eventName: "Purchase",
      pixelId: creds?.pixelId ?? "",
      payload: {},
      status: "pending",
    },
  });

  const lead = {
    id: updated.id,
    stage: updated.stage,
    amount: updated.amount,
    purchasedAt: updated.purchasedAt,
  };

  // Sin Pixel del cliente (y sin fallback global): la venta queda marcada COMPRO igual, pero el
  // Purchase NO se manda al pixel del .env. Marcamos "no_pixel" y avisamos al cliente. Sin fuga.
  if (!creds && !globalPixelAllowed()) {
    await prisma.metaEvent.update({ where: { id: metaEvent.id }, data: { status: "no_pixel", response: { error: "SIN_PIXEL" } } });
    void notifyMissingPixel(userId);
    emitToUser(userId, "lead:purchased", { contactId: contact.id, amount: updated.amount });
    return { ok: false, error: "SIN_PIXEL: configurá tu Pixel de Meta", lead };
  }

  // Si el contacto vino por un anuncio Click-to-WhatsApp, el Purchase va como
  // business_messaging con el ctwa_clid; si no, sigue el flujo web (landing).
  const isCtwa = !!contact.ctwaClid;
  try {
    const result = await sendCapiEvent({
      eventName: "Purchase",
      externalId: contact.externalId, // <- mismo id que el Lead: habilita el match
      fbp: contact.fbp ?? undefined,
      fbc: contact.fbc ?? undefined,
      phone: contact.phone ?? undefined,
      value: amount,
      currency,
      eventId: `${contact.externalId}:purchase`,
      eventSourceUrl: contact.landingUrl ?? undefined,
      actionSource: isCtwa ? "business_messaging" : "website",
      ctwaClid: contact.ctwaClid ?? undefined,
      pixelId: creds?.pixelId,
      capiToken: creds?.capiToken,
    });
    await prisma.metaEvent.update({
      where: { id: metaEvent.id },
      data: {
        status: "sent",
        pixelId: result.pixelId,
        payload: result.payload as object,
        response: result.response as object,
      },
    });
    emitToUser(userId, "lead:purchased", { contactId: contact.id, amount: updated.amount });
    return { ok: true, capi: result.response, lead };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[CAPI Purchase] error:", message);
    await prisma.metaEvent.update({
      where: { id: metaEvent.id },
      data: { status: "failed", response: { error: message } },
    });
    emitToUser(userId, "lead:purchased", { contactId: contact.id, amount: updated.amount });
    return { ok: false, error: message, lead };
  }
}
