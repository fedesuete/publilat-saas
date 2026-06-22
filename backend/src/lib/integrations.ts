// Integraciones con CRM externo (Fase 5). Dispara webhooks salientes por evento
// (lead / purchase) hacia la URL configurada por el usuario. Best-effort: no bloquea
// el flujo principal y loguea errores. Firma el payload con HMAC-SHA256 si hay secret.
import crypto from "node:crypto";
import axios from "axios";
import { prisma } from "./prisma.js";

export type IntegrationEvent = "lead" | "purchase";

// Firma HMAC-SHA256 del payload (header X-Publilat-Signature). Exportada para tests.
export function signPayload(raw: string, secret: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
}

// Envía el evento a la integración del usuario si está habilitada para ese evento.
export async function fireIntegration(
  userId: string,
  event: IntegrationEvent,
  data: Record<string, unknown>
): Promise<void> {
  try {
    const integ = await prisma.integration.findUnique({ where: { userId } });
    if (!integ || !integ.enabled || !integ.webhookUrl) return;
    if (integ.mode === "nativo") return; // sin webhook saliente
    if (event === "lead" && !integ.onLead) return;
    if (event === "purchase" && !integ.onPurchase) return;

    // Kommo: payload plano que un webhook entrante / Salesbot mapea fácil a campos de lead.
    // Webhook genérico: estructura {event, mode, data}.
    const body =
      integ.mode === "kommo"
        ? {
            event, // "lead" | "purchase"
            name: (data.name as string) ?? `Lead ${String(data.code ?? data.externalId ?? "")}`,
            price: typeof data.amount === "number" ? data.amount : 0,
            source: (data.source as string) ?? "publilat",
            pipeline: "publilat",
            tags: ["publi.lat", event],
            custom_fields: {
              external_id: data.externalId ?? null,
              code: data.code ?? null,
              campaign: data.campaignId ?? null,
              currency: data.currency ?? null,
            },
            sentAt: new Date().toISOString(),
          }
        : { event, mode: integ.mode, data, sentAt: new Date().toISOString() };

    const raw = JSON.stringify(body);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (integ.secret) headers["X-Publilat-Signature"] = signPayload(raw, integ.secret);

    await axios.post(integ.webhookUrl, body, { headers, timeout: 8000 });
  } catch (e) {
    console.error("[integration] error:", e instanceof Error ? e.message : String(e));
  }
}

// Envía un evento de prueba (para el botón "probar" del panel). Lanza si falla.
export async function sendTestIntegration(userId: string): Promise<number> {
  const integ = await prisma.integration.findUnique({ where: { userId } });
  if (!integ?.webhookUrl) throw new Error("No hay webhook configurado");
  const body = {
    event: "test",
    mode: integ.mode,
    data: { message: "Webhook de prueba de Publi.lat" },
    sentAt: new Date().toISOString(),
  };
  const raw = JSON.stringify(body);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (integ.secret) headers["X-Publilat-Signature"] = signPayload(raw, integ.secret);
  const r = await axios.post(integ.webhookUrl, body, { headers, timeout: 8000, validateStatus: () => true });
  return r.status;
}
