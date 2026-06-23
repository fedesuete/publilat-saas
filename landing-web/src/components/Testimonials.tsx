import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Star, ChevronLeft, ChevronRight } from "lucide-react";
import { Reveal } from "./ui/Reveal";

const TESTIMONIALS = [
  {
    quote:
      "El bot acredita las cargas solo. Mis cajeros pasaron de cargar a mano toda la noche a supervisar nomás. La operación vuela.",
    name: "Martín Ferreyra",
    role: "Operador · Asunción",
    initials: "MF",
  },
  {
    quote:
      "Antes no sabía cuánto movía cada caja. Ahora tengo el GGR del día y el arqueo en tiempo real. Cero planillas de Excel.",
    name: "Carla Giménez",
    role: "Casino online · Córdoba",
    initials: "CG",
  },
  {
    quote:
      "Tener WhatsApp y Telegram en un solo Inbox, con el historial del jugador al lado, me cambió la atención. Respondemos al toque.",
    name: "Diego Rolón",
    role: "Plataforma de apuestas · Encarnación",
    initials: "DR",
  },
  {
    quote:
      "El CRM de jugadores me dejó ver quién se enfriaba. Reactivamos VIPs y subió la recompra sin gastar más en tráfico.",
    name: "Sofía Medina",
    role: "Operadora · Montevideo",
    initials: "SM",
  },
];

export default function Testimonials() {
  const reduce = useReducedMotion();
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || reduce) return;
    const id = setInterval(() => setIdx((v) => (v + 1) % TESTIMONIALS.length), 5000);
    return () => clearInterval(id);
  }, [paused, reduce]);

  const t = TESTIMONIALS[idx];

  return (
    <section className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
      <Reveal>
        <h2 className="text-center text-3xl font-bold text-white sm:text-4xl">
          Negocios que ya <span className="gradient-text">escalan con datos</span>
        </h2>
      </Reveal>

      <Reveal delay={0.05}>
        <div
          className="relative mx-auto mt-12 max-w-2xl"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          <div className="card-border min-h-[220px] p-8">
            <AnimatePresence mode="wait">
              <motion.figure
                key={idx}
                initial={{ opacity: 0, y: reduce ? 0 : 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: reduce ? 0 : -16 }}
                transition={{ duration: 0.4 }}
              >
                <div className="mb-3 flex gap-0.5 text-wa-green">
                  {Array.from({ length: 5 }).map((_, k) => (
                    <Star key={k} className="h-4 w-4 fill-current" />
                  ))}
                </div>
                <blockquote className="text-lg leading-relaxed text-slate-200">“{t.quote}”</blockquote>
                <figcaption className="mt-6 flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-wa-green to-emerald-500 text-sm font-bold text-ink">
                    {t.initials}
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-white">{t.name}</span>
                    <span className="block text-xs text-slate-500">{t.role}</span>
                  </span>
                </figcaption>
              </motion.figure>
            </AnimatePresence>
          </div>

          {/* controles */}
          <div className="mt-5 flex items-center justify-center gap-4">
            <button
              onClick={() => setIdx((v) => (v - 1 + TESTIMONIALS.length) % TESTIMONIALS.length)}
              className="rounded-full border border-white/10 bg-white/5 p-2 text-slate-300 transition hover:text-white"
              aria-label="Anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="flex gap-1.5">
              {TESTIMONIALS.map((_, k) => (
                <button
                  key={k}
                  onClick={() => setIdx(k)}
                  aria-label={`Testimonio ${k + 1}`}
                  className={`h-2 rounded-full transition-all ${k === idx ? "w-6 bg-wa-green" : "w-2 bg-white/20"}`}
                />
              ))}
            </div>
            <button
              onClick={() => setIdx((v) => (v + 1) % TESTIMONIALS.length)}
              className="rounded-full border border-white/10 bg-white/5 p-2 text-slate-300 transition hover:text-white"
              aria-label="Siguiente"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
