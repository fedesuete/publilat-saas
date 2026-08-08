// Puente cajero de un SOCIO: reenvía un mensaje ENTRANTE a un bot externo, SOLO si esa línea tiene un
// forward configurado en el env `BOT_FORWARD` = {"<lineId>":"<url>"}. Fire-and-forget: timeout 5s, catch
// con log, NUNCA bloquea ni tira. Aditivo y aislado — no toca la persistencia ni la atribución.
//
// APAGADO por defecto: sin `BOT_FORWARD` (o sin la línea en el mapa) es un no-op total. Habilitado por
// pedido EXPLÍCITO del dueño para la línea del socio (ver §9.6). La URL/token NO se commitean: van por env.
export function forwardInboundToBot(lineId: string, data: {
  remoteJid: string;
  messageId: string | undefined;
  senderPn: string;                 // teléfono REAL (549…). Cloud API lo entrega real; Baileys/NOWEB puede dar LID.
  message: unknown;                 // el message tal cual (Evolution-like: conversation / imageMessage / …)
  pushName?: string | null;
  mediaBase64?: string | null;      // imagen/comprobante en base64 SIN prefijo data:
  mediaMimetype?: string | null;
}): void {
  let url: string | undefined;
  try {
    url = (JSON.parse(process.env.BOT_FORWARD || "{}") as Record<string, string>)[lineId];
  } catch {
    return; // BOT_FORWARD mal formado → no reenvía (no rompe el flujo)
  }
  if (!url) return;
  void fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      instance: `publilat-${lineId}`,
      data: {
        key: { remoteJid: data.remoteJid, fromMe: false, id: data.messageId, senderPn: data.senderPn },
        message: data.message,
        pushName: data.pushName ?? undefined,
        mediaBase64: data.mediaBase64 ?? undefined,
        mediaMimetype: data.mediaMimetype ?? undefined,
      },
    }),
    signal: AbortSignal.timeout(5000),
  }).catch((e) => console.warn("[bot-forward]", lineId, e instanceof Error ? e.message : String(e)));
}
