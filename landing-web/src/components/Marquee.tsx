// Franja en loop infinito: países LATAM + lo que se integra. El contenido se duplica
// para que el translateX(-50%) cierre el ciclo sin saltos.
const ITEMS = [
  "Meta Ads",
  "WhatsApp",
  "Conversions API",
  "MercadoPago",
  "USDT · TRC20",
  "Stripe",
  "🇦🇷 Argentina",
  "🇵🇾 Paraguay",
  "🇺🇾 Uruguay",
  "🇨🇱 Chile",
  "Kommo",
  "ROAS real",
];

export default function Marquee() {
  const list = [...ITEMS, ...ITEMS];
  return (
    <section aria-hidden className="border-y border-white/5 bg-white/[0.02] py-5">
      <div className="marquee-mask overflow-hidden">
        <div className="marquee-track gap-10 px-5">
          {list.map((it, i) => (
            <span key={i} className="flex items-center gap-10 whitespace-nowrap text-sm font-medium text-slate-400">
              {it}
              <span className="text-wa-green/40">•</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
