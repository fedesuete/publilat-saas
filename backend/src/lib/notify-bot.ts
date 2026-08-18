// Aviso al BOT CAJERO del socio cuando el OPERADOR responde en el inbox: el bot se calla 30 min en esa
// conversación (operator hold) para no pisar al humano. Solo si la línea tiene forward configurado en
// BOT_FORWARD (mismo gate que forwardInboundToBot). Reusa la URL del forward, cambiando /webhook por
// /operator-active. Fire-and-forget: timeout 5 s, catch con log, NUNCA bloquea ni rompe el envío.
export function notifyBotOperatorActive(lineId: string, phone: string | null | undefined): void {
  if (!phone) return;
  let webhookUrl: string | undefined;
  try {
    webhookUrl = (JSON.parse(process.env.BOT_FORWARD || "{}") as Record<string, string>)[lineId];
  } catch {
    return; // BOT_FORWARD mal formado → no avisa (no rompe)
  }
  if (!webhookUrl) return;
  const url = webhookUrl.replace("/api/wa/webhook", "/api/wa/operator-active");
  void fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instance: `publilat-${lineId}`, phone: String(phone).replace(/\D/g, "") }),
    signal: AbortSignal.timeout(5000),
  }).catch((e) => console.warn("[notify-bot-op]", lineId, e instanceof Error ? e.message : String(e)));
}
