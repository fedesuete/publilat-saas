// Análisis de comprobantes de pago por imagen con IA (visión).
// Soporta dos proveedores, en este orden de prioridad:
//   1) OpenAI   (OPENAI_API_KEY)         -> modelo barato con visión, def gpt-4o-mini.
//   2) Anthropic (ANTHROPIC_AUTH_TOKEN o ANTHROPIC_API_KEY) -> Claude Haiku 4.5.
// Sin ninguna credencial, devuelve null y el sistema cae a la detección por texto.
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

const ANTHROPIC_MODEL = process.env.ANTHROPIC_VISION_MODEL ?? "claude-haiku-4-5";
// gpt-4o-mini: el modelo con visión más barato de OpenAI (centavos por comprobante).
const OPENAI_MODEL = process.env.OPENAI_VISION_MODEL ?? "gpt-4o-mini";

export interface ReceiptAnalysis {
  isReceipt: boolean; // ¿es un comprobante/transferencia de pago?
  amount: number | null; // monto en unidad mayor (ej 1500.5), null si no se lee
  currency: string | null; // ISO si se identifica (ej "PYG", "ARS", "USD")
  confidence: number; // 0..1 confianza de que es un pago real
}

type Provider = "openai" | "anthropic";
function provider(): Provider | null {
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY) return "anthropic";
  return null;
}

export const aiEnabled = (): boolean => provider() !== null;

// media_type aceptado por las APIs de visión.
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

const isPdf = (mediaType?: string): boolean => (mediaType ?? "").toLowerCase().includes("pdf");

// ---- OpenAI (gpt-4o-mini, detalle bajo para gastar lo mínimo) ----
let openaiClient: OpenAI | null = null;
async function rawOpenAI(base64: string, mediaType?: string): Promise<string> {
  if (!openaiClient) openaiClient = new OpenAI(); // lee OPENAI_API_KEY del entorno
  // PDF -> content part "file"; imagen -> "image_url".
  const mediaPart = isPdf(mediaType)
    ? {
        type: "file" as const,
        file: { filename: "comprobante.pdf", file_data: `data:application/pdf;base64,${base64}` },
      }
    : {
        type: "image_url" as const,
        image_url: { url: `data:${normMedia(mediaType)};base64,${base64}`, detail: "low" as const },
      };
  const resp = await openaiClient.chat.completions.create({
    model: OPENAI_MODEL,
    max_tokens: 200,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: [{ type: "text", text: PROMPT }, mediaPart] }],
  });
  return resp.choices[0]?.message?.content ?? "";
}

// ---- Anthropic (Claude Haiku 4.5) ----
let anthropicClient: Anthropic | null = null;
async function rawAnthropic(base64: string, mediaType?: string): Promise<string> {
  if (!anthropicClient) {
    const authToken = process.env.ANTHROPIC_AUTH_TOKEN;
    anthropicClient = authToken
      ? new Anthropic({
          authToken,
          apiKey: null,
          defaultHeaders: { "anthropic-beta": "oauth-2025-04-20" },
        })
      : new Anthropic(); // lee ANTHROPIC_API_KEY del entorno
  }
  // PDF -> bloque "document"; imagen -> bloque "image".
  const mediaBlock = isPdf(mediaType)
    ? {
        type: "document" as const,
        source: { type: "base64" as const, media_type: "application/pdf" as const, data: base64 },
      }
    : {
        type: "image" as const,
        source: { type: "base64" as const, media_type: normMedia(mediaType), data: base64 },
      };
  const resp = await anthropicClient.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 200,
    messages: [{ role: "user", content: [mediaBlock, { type: "text", text: PROMPT }] }],
  });
  const block = resp.content.find((b) => b.type === "text");
  return block && block.type === "text" ? block.text : "";
}

/**
 * Analiza una imagen (base64) y devuelve si es un comprobante + monto + moneda.
 * Devuelve null si la IA no está configurada o si la llamada falla (no rompe el flujo).
 */
export async function analyzeReceipt(
  base64: string,
  mediaType?: string,
): Promise<ReceiptAnalysis | null> {
  const p = provider();
  if (!p || !base64) return null;

  try {
    const raw = p === "openai" ? await rawOpenAI(base64, mediaType) : await rawAnthropic(base64, mediaType);
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
