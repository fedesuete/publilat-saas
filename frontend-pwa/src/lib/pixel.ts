// Dispara un evento del Meta Pixel del navegador (además de la CAPI del server). El `eventId`
// deduplica con la CAPI (mismo evento contado una vez). `externalId` = usuario (advanced matching),
// para que matchee el Purchase de la carga. Carga fbevents.js una sola vez. Fase C. Best-effort.
declare global { interface Window { fbq?: (...args: unknown[]) => void; _fbq?: unknown } }

export function fireMetaPixel(
  pixelId: string,
  eventName: string,
  opts: { eventId?: string; externalId?: string } = {},
): void {
  try {
    const w = window as Window & { fbq?: any; _fbq?: any };
    if (!w.fbq) {
      /* snippet estándar de Meta Pixel (carga async fbevents.js) */
      const n: any = (w.fbq = function (...args: unknown[]) {
        n.callMethod ? n.callMethod.apply(n, args) : n.queue.push(args);
      });
      if (!w._fbq) w._fbq = n;
      n.push = n; n.loaded = true; n.version = "2.0"; n.queue = [];
      const t = document.createElement("script");
      t.async = true; t.src = "https://connect.facebook.net/en_US/fbevents.js";
      const s = document.getElementsByTagName("script")[0];
      s.parentNode?.insertBefore(t, s);
    }
    w.fbq!("init", pixelId, opts.externalId ? { external_id: opts.externalId } : undefined);
    w.fbq!("track", eventName, {}, opts.eventId ? { eventID: opts.eventId } : undefined);
  } catch {
    /* si el pixel no carga (adblock, etc.), la CAPI del server ya cubrió el evento */
  }
}
