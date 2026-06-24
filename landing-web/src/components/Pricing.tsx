import { Check, ArrowRight } from "lucide-react";
import { Reveal } from "./ui/Reveal";
import { REGISTER_URL, PRICE_PER_DAY_USD } from "../config";

const INCLUDES = [
  "1 día = 1 línea de WhatsApp activa 24 h",
  "Atribución Lead + Purchase por CAPI",
  "Dashboard de ROAS en tiempo real",
  "Inbox + CRM kanban con montos",
  "Multi-línea con rotación de clics",
  "Integraciones: nativo, Kommo, webhook",
];

const PACKS = [
  { days: 10, popular: false },
  { days: 30, popular: true },
  { days: 90, popular: false },
];

export default function Pricing() {
  return (
    <section id="precios" className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
      <Reveal>
        <h2 className="text-center text-3xl font-bold text-white sm:text-4xl">
          Precio simple: <span className="gradient-text">pagás por lo que usás</span>
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-slate-400">
          Sin mensualidades atadas. Cargás días y los usás cuando querés. 1 día = 1 línea activa
          24 horas, distribuibles entre tus líneas.
        </p>
      </Reveal>

      <div className="mx-auto mt-12 grid max-w-5xl items-stretch gap-6 lg:grid-cols-2">
        {/* Tarjeta principal */}
        <Reveal>
          <div className="card-border glow relative h-full overflow-hidden p-8">
            <div className="text-sm font-semibold uppercase tracking-wide text-wa-green">Por día</div>
            <div className="mt-2 flex items-end gap-1">
              <span className="text-5xl font-extrabold text-white">US${PRICE_PER_DAY_USD}</span>
              <span className="mb-1 text-slate-400">/ día por línea</span>
            </div>
            <p className="mt-2 text-sm text-slate-400">
              Empezás gratis para probar el loop. Después cargás días según tu operación.
            </p>
            <a href={REGISTER_URL} className="btn-primary mt-6 w-full">
              Empezar gratis <ArrowRight className="h-4 w-4" />
            </a>
            <ul className="mt-7 space-y-2.5">
              {INCLUDES.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-slate-300">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-wa-green" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </Reveal>

        {/* Packs de días */}
        <Reveal delay={0.08}>
          <div className="flex h-full flex-col gap-4">
            {PACKS.map((p) => (
              <div
                key={p.days}
                className={`flex items-center justify-between rounded-2xl border p-5 transition ${
                  p.popular
                    ? "border-wa-green/50 bg-wa-green/[0.06]"
                    : "border-white/10 bg-white/[0.03]"
                }`}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold text-white">{p.days} días</span>
                    {p.popular && (
                      <span className="rounded-full bg-wa-green/15 px-2 py-0.5 text-[11px] font-semibold text-wa-green">
                        Más elegido
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-slate-400">
                    Distribuibles entre tus líneas de WhatsApp
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-extrabold text-white">
                    US${p.days * PRICE_PER_DAY_USD}
                  </div>
                  <div className="text-[11px] text-slate-500">US${PRICE_PER_DAY_USD}/día</div>
                </div>
              </div>
            ))}
            <a href={REGISTER_URL} className="btn-ghost mt-auto w-full">
              Crear cuenta y cargar días
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
