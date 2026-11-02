// Puente cajero de un SOCIO: reenvía un mensaje ENTRANTE a un bot externo, SOLO si esa línea tiene un
// forward configurado en el env `BOT_FORWARD` = {"<lineId>":"<url>"} o {"user:<userId>":"<url>"}
// (la clave por cuenta cubre TODAS las líneas de ese dueño, presentes y futuras). Fire-and-forget: timeout 5s, catch
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
}, ownerUserId?: string | null): void {
  let url: string | undefined;
  try {
    const map = JSON.parse(process.env.BOT_FORWARD || "{}") as Record<string, string>;
    // La clave por LINEA manda (config explícita, comportamiento de siempre). Si no está, se
    // busca por CUENTA con la clave `user:<userId>`: así el puente sobrevive a que el dueño
    // borre y reconecte la línea. Cuando eso pasa el lineId cambia y, sin este fallback, el
    // bot del socio quedaba mudo hasta que alguien editaba este env a mano (incidentes
    // 11/08 y 09/09). Sigue siendo opt-in y por env: sin clave, no reenvía nada.
    url = map[lineId] ?? (ownerUserId ? map[`user:${ownerUserId}`] : undefined);
  } catch {
    return; // BOT_FORWARD mal formado → no reenvía (no rompe el flujo)
  }
  if (!url) return;
  void fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      instance: `publilat-${lineId}`,
      // Dueño de la línea: permite que el bot del socio resuelva por CUENTA y no por lineId,
      // así tampoco necesita reconfigurarse cuando la línea se borra y se reconecta.
      // Campo aditivo: quien no lo mire, sigue funcionando igual.
      ownerUserId: ownerUserId ?? undefined,
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
