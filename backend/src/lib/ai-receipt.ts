// Análisis de comprobantes de pago por imagen con Claude (visión).
// Usa Claude Haiku 4.5 — el modelo con visión más económico, ideal para OCR de un
// comprobante. Gateado por ANTHROPIC_API_KEY: sin la clave, devuelve null y el sistema
// cae a la detección por texto.
import Anthropic from "@anthropic-ai/sdk";

// Modelo de visión económico para OCR de comprobantes (1 USD/1M in · 5 USD/1M out).
const MODEL = process.env.ANTHROPIC_VISION_MODEL ?? "claude-haiku-4-5";

export interface ReceiptAnalysis {
  isReceipt: boolean; // ¿es un comprobante/transferencia de pago?
  amount: number | null; // monto en unidad mayor (ej 1500.5), null si no se lee
  currency: string | null; // ISO si se identifica (ej "PYG", "ARS", "USD")
  confidence: number; // 0..1 confianza de que es un pago real
}

let cached: Anthropic | null = null;
function clientOrNull(): Anthropic | null {
  // Dos formas de autenticar:
  //  A) ANTHROPIC_AUTH_TOKEN  -> token OAuth de la suscripción (Claude Code). No cobra
  //     por token aparte; va como Bearer + header anthropic-beta: oauth-2025-04-20.
  //     OJO: es de corta duración y NO se auto-renueva por variable de entorno.
  //  B) ANTHROPIC_API_KEY     -> API key clásica (pago por token).
  // Si están las dos, la API rechaza la request: dejá UNA sola en el .env.
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!authToken && !apiKey) return null;
  if (cached) return cached;

  cached = authToken
    ? new Anthropic({
        authToken,
        apiKey: null, // evita mandar x-api-key además del Bearer
        defaultHeaders: { "anthropic-beta": "oauth-2025-04-20" },
      })
    : new Anthropic(); // lee ANTHROPIC_API_KEY del entorno
  return cached;
}

export const aiEnabled = (): boolean =>
  !!(process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY);

// media_type que acepta la API de visión.
type ImgMedia = "image/jpeg" | "image/png" | "image/gif" | "image/webp";
function normMedia(mt?: string): ImgMedia {
  const m = (mt ?? "").toLowerCase();
  if (m.includes("png")) return "image/png";
  if (m.includes("gif")) return "image/gif";
  if (m.includes("webp")) return "image/webp";
  return "image/jpeg";
}

// Extrae el primer objeto JSON de un texto (tolerante a texto alrededor).
function parseJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const PROMPT =
  "Analizá esta imagen enviada por un cliente en un chat de ventas. ¿Es un comprobante " +
  "de pago o transferencia bancaria (Bancard, Tigo Money, Ueno, Mercado Pago, " +
  "transferencia, depósito, etc.)? Extraé el monto total pagado y la moneda. " +
  'Respondé SOLO con JSON, sin texto adicional, con esta forma exacta: ' +
  '{"is_receipt": true|false, "amount": numero_o_null, "currency": "PYG"|"ARS"|"USD"|null, ' +
  '"confidence": 0.0_a_1.0}. ' +
  "amount es el total pagado como número sin separadores de miles ni símbolo (ej 150000). " +
  "confidence refleja qué tan seguro estás de que es un pago real y exitoso. " +
  "Si no es un comprobante, is_receipt=false y amount=null.";

/**
 * Analiza una imagen (base64) y devuelve si es un comprobante + monto + moneda.
 * Devuelve null si la IA no está configurada o si la llamada falla (no rompe el flujo).
 */
export async function analyzeReceipt(
  base64: string,
  mediaType?: string,
): Promise<ReceiptAnalysis | null> {
  const client = clientOrNull();
  if (!client || !base64) return null;

  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 200,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: normMedia(mediaType), data: base64 },
            },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    });

    const textBlock = resp.content.find((b) => b.type === "text");
    const raw = textBlock && textBlock.type === "text" ? textBlock.text : "";
    const data = parseJson(raw);
    if (!data) return null;

    const amountRaw = data.amount;
    const amount =
      typeof amountRaw === "number" && Number.isFinite(amountRaw) && amountRaw > 0
        ? amountRaw
        : null;

    return {
      isReceipt: data.is_receipt === true,
      amount,
      currency: typeof data.currency === "string" ? data.currency.toUpperCase() : null,
      confidence: typeof data.confidence === "number" ? data.confidence : 0,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[ai-receipt] error:", message);
    return null;
  }
}
