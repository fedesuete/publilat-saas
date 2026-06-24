import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Star, ChevronLeft, ChevronRight } from "lucide-react";
import { Reveal } from "./ui/Reveal";

const TESTIMONIALS = [
  {
    quote:
      "Pasé de optimizar por mensajes a optimizar por compras. En 3 semanas bajé el costo por venta a la mitad y por fin sé qué campaña me factura.",
    name: "Martín Ferreyra",
    role: "Indumentaria · Asunción",
    initials: "MF",
  },
  {
    quote:
      "Tenía 4 vendedoras con 4 líneas y no sabía nada. Ahora veo el ROAS por anuncio y reparto los clics solo. Cambió cómo manejo la pauta.",
    name: "Carla Giménez",
    role: "Cosmética · Córdoba",
    initials: "CG",
  },
  {
    quote:
      "Lo mejor es que la venta vuelve a Meta automática. El algoritmo empezó a traerme gente que compra, no que pregunta y desaparece.",
    name: "Diego Rolón",
    role: "Electro · Encarnación",
    initials: "DR",
  },
  {
    quote:
      "La detección de comprobantes me ahorra cargar ventas a mano. La IA lee el monto y yo solo confirmo. Una locura lo que escala.",
    name: "Sofía Medina",
    role: "Accesorios · Montevideo",
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
