// Aviso al BOT CAJERO del socio cuando el OPERADOR responde en el inbox: el bot se calla 30 min en esa
// conversación (operator hold) para no pisar al humano. Solo si la línea tiene forward configurado en
// BOT_FORWARD (mismo gate que forwardInboundToBot). Reusa la URL del forward, cambiando /webhook por
// /operator-active. Fire-and-forget: timeout 5 s, catch con log, NUNCA bloquea ni rompe el envío.
export function notifyBotOperatorActive(lineId: string, phone: string | null | undefined, ownerUserId?: string | null): void {
  if (!phone) return;
  let webhookUrl: string | undefined;
  try {
    const map = JSON.parse(process.env.BOT_FORWARD || "{}") as Record<string, string>;
    // Mismo criterio que forwardInboundToBot: por línea y, si no, por CUENTA (`user:<userId>`). Antes
    // solo se buscaba por lineId: las líneas mapeadas por cuenta (las actuales de matias y raul, 12/09)
    // reenviaban los mensajes al bot pero NUNCA le avisaban que un operador había respondido, y el bot
    // le encimaba mensajes al humano.
    webhookUrl = map[lineId] ?? (ownerUserId ? map[`user:${ownerUserId}`] : undefined);
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
