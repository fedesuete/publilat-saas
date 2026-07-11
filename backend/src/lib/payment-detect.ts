// Detección de pago en el chat (texto + comprobante por imagen con IA).
// Según el modo del usuario:
//   off       -> no hace nada (se marca a mano en Leads).
//   assisted  -> marca el contacto como "pago detectado" + monto pre-cargado; se confirma 1 clic.
//   auto      -> si lee monto con confianza alta, marca COMPRO y dispara el Purchase solo.
import { prisma } from "./prisma.js";
import { emitToUser } from "./io.js";
import { analyzeReceipt, aiEnabled } from "./ai-receipt.js";
import { getMediaBase64 } from "./evolution.js";
import { markPurchase } from "./purchase.js";

// Moneda por defecto cuando la IA no la identifica (Paraguay -> PYG).
const DEFAULT_CURRENCY = process.env.DEFAULT_CURRENCY ?? "PYG";
// Umbral de confianza para disparar el Purchase automáticamente (modo auto).
const AUTO_MIN_CONFIDENCE = Number(process.env.PAYMENT_AUTO_MIN_CONFIDENCE ?? "0.7");
// Máximo de análisis de comprobante por IA por contacto por hora (anti cost-DoS).
const RECEIPT_AI_MAX_PER_HOUR = Number(process.env.RECEIPT_AI_MAX_PER_HOUR ?? "20");

// ¿Se permite analizar otro comprobante de este contacto? Cuenta las imágenes/PDF
// entrantes de la última hora (proxy del nº de análisis disparables por esa persona).
async function receiptAnalysisAllowed(contactId: string): Promise<boolean> {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const recentMedia = await prisma.message.count({
    where: { contactId, direction: "in", mediaType: { not: null }, createdAt: { gte: since } },
  });
  return recentMedia <= RECEIPT_AI_MAX_PER_HOUR;
}

// Palabras/frases que indican que el cliente avisa de un pago.
// Nota: no usamos \b al final de stems con vocal acentuada (é/í) porque \b es ASCII
// y no marca límite después de un carácter acentuado.
const KEYWORDS: RegExp[] = [
  /\bpagu[eé]/i,
  /\babon[eé]/i,
  /\btransfer[ií]/i,
  /\bcomprobante\b/i,
  /\bdeposit[eé]/i,
  /\bhice (la|el) (transferencia|pago|dep[oó]sito)/i,
  /\b(env[ií][eé]|mand[eé]|te paso) el comprobante/i,
  /\blisto el pago\b/i,
  /\bpago (realizado|hecho|enviado)\b/i,
];

export const textSignalsPayment = (text: string): boolean =>
  !!text && KEYWORDS.some((rx) => rx.test(text));

export interface DetectPaymentArgs {
  mode: string; // off | assisted | auto
  userId: string;
  contact: { id: string; externalId: string; stage: string; name: string | null };
  instance: string; // sessionId de la línea (instancia Evolution)
  item: Record<string, any>; // mensaje crudo del webhook
  text: string;
  imageBase64?: string | null; // imagen ya descargada por el webhook (evita re-bajarla)
  imageMediaType?: string | null;
}

/**
 * Evalúa un mensaje entrante y, según el modo, marca el pago como detectado o lo dispara.
 * Best-effort: cualquier error se traga (no rompe el webhook).
 */
export async function detectPayment(args: DetectPaymentArgs): Promise<void> {
  const { mode, userId, contact, instance, item, text } = args;
  if (mode !== "assisted" && mode !== "auto") return;
  if (contact.stage === "COMPRO") return; // ya compró: no re-detectar

  try {
    let signal = textSignalsPayment(text);
    let amount: number | null = null;
    let currency: string | null = null;
    let confidence = signal ? 0.6 : 0; // por texto solo, confianza media

    // ¿Trae comprobante (imagen o PDF)? Intentar leerlo con la IA.
    const doc =
      item?.message?.documentMessage ??
      item?.message?.documentWithCaptionMessage?.message?.documentMessage;
    const hasMedia = !!args.imageBase64 || !!item?.message?.imageMessage || !!doc;
    // Throttle anti cost-DoS: cada análisis es una llamada FACTURADA a la IA de visión, y
    // el input lo provee la contraparte del chat. Un tercero que inunda con imágenes no
    // puede disparar gasto ilimitado: se acota por contacto en una ventana de 1 h.
    if (hasMedia && aiEnabled() && !(await receiptAnalysisAllowed(contact.id))) {
      return; // el mensaje ya quedó guardado por el webhook; solo se saltea el análisis IA
    }
    if (hasMedia && aiEnabled()) {
      // Si el webhook ya bajó el archivo, lo reusamos (no lo bajamos dos veces).
      let base64: string | undefined =
        args.imageBase64 ?? item?.message?.base64 ?? item?.message?.imageMessage?.base64;
      let mediaType: string | undefined =
        args.imageMediaType ?? item?.message?.imageMessage?.mimetype ?? doc?.mimetype;
      if (!base64 && item?.key?.id) {
        const media = await getMediaBase64(instance, String(item.key.id));
        base64 = media?.base64;
        mediaType = media?.mimetype ?? mediaType;
      }
      // Sólo imágenes y PDF son legibles por la IA.
      if (base64 && /image|pdf/i.test(mediaType ?? "")) {
        const a = await analyzeReceipt(base64, mediaType);
        if (a?.isReceipt && a.confidence >= 0.5) {
          signal = true;
          amount = a.amount;
          currency = a.currency ?? currency;
          confidence = Math.max(confidence, a.confidence);
        }
      }
    }

    if (!signal) return;

    // Modo automático: dispara el Purchase sólo con monto leído y confianza alta.
    // (Nunca mandamos un Purchase con value 0: eso corrompería la optimización de Meta.)
    if (mode === "auto" && amount && amount > 0 && confidence >= AUTO_MIN_CONFIDENCE) {
      await markPurchase(userId, contact.id, amount, currency ?? DEFAULT_CURRENCY);
      return;
    }

    // assisted (o auto sin monto/confianza): marcar "pago detectado" para confirmar 1 clic.
    await prisma.contact.update({
      where: { id: contact.id },
      data: {
        paymentDetected: true,
        paymentDetectedAmount: amount ? Math.round(amount * 100) : null,
        paymentDetectedAt: new Date(),
      },
    });
    emitToUser(userId, "payment:detected", {
      contactId: contact.id,
      amount: amount ?? null,
      currency: currency ?? null,
      name: contact.name,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[payment-detect] error:", message);
  }
}
