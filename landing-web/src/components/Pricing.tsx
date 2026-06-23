import { Check, ArrowRight, MessageCircle } from "lucide-react";
import { Reveal } from "./ui/Reveal";
import { REGISTER_URL, WHATSAPP_URL } from "../config";

const INCLUDES = [
  "Panel de cajeros (cargas, retiros, arqueo)",
  "CRM de jugadores con etapas y VIP",
  "Inbox de WhatsApp y Telegram multi-agente",
  "Bot de IA que acredita cargas 24/7",
  "Reportes en tiempo real (GGR, depósitos, retiros)",
  "Multi-marca, roles y permisos",
  "Pagos locales: Bancard, Tigo Money, Ueno, USDT",
];

export default function Pricing() {
  return (
    <section id="precios" className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
      <Reveal>
        <h2 className="text-center text-3xl font-bold text-white sm:text-4xl">
          Precio simple, <span className="gradient-text">sin sorpresas</span>
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-slate-400">
          Probá la plataforma y armamos un plan a la medida de tu operación. Sin instalaciones ni
          contratos eternos.
        </p>
      </Reveal>

      <Reveal delay={0.05}>
        <div className="card-border glow mx-auto mt-12 max-w-3xl overflow-hidden p-8 sm:p-10">
          <div className="flex flex-col gap-8 sm:flex-row sm:items-center">
            <div className="flex-1">
              <div className="text-sm font-semibold uppercase tracking-wide text-wa-green">Plan Operador</div>
              <div className="mt-2 flex items-end gap-2">
                <span className="text-4xl font-extrabold text-white sm:text-5xl">A tu medida</span>
              </div>
              <p className="mt-3 max-w-sm text-sm text-slate-400">
                Según tu volumen de cargas, cajeros y marcas. Empezás probándolo gratis, sin tarjeta.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <a href={REGISTER_URL} className="btn-primary animate-ctaGlow">
                  Crear mi cuenta <ArrowRight className="h-4 w-4" />
                </a>
                <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="btn-ghost">
                  <MessageCircle className="h-4 w-4" /> Pedí una demo
                </a>
              </div>
            </div>

            <ul className="flex-1 space-y-2.5">
              {INCLUDES.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-slate-300">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-wa-green" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
