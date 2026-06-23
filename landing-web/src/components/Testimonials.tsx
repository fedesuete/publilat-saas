import { Star } from "lucide-react";
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
];

export default function Testimonials() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
      <Reveal>
        <h2 className="text-center text-3xl font-bold text-white sm:text-4xl">
          Negocios que ya <span className="gradient-text">escalan con datos</span>
        </h2>
      </Reveal>
      <div className="mt-12 grid gap-5 md:grid-cols-3">
        {TESTIMONIALS.map((t, i) => (
          <Reveal key={t.name} delay={i * 0.08}>
            <figure className="card-border flex h-full flex-col p-6">
              <div className="mb-3 flex gap-0.5 text-wa-green">
                {Array.from({ length: 5 }).map((_, k) => (
                  <Star key={k} className="h-4 w-4 fill-current" />
                ))}
              </div>
              <blockquote className="flex-1 text-sm leading-relaxed text-slate-300">
                “{t.quote}”
              </blockquote>
              <figcaption className="mt-5 flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-wa-green to-emerald-500 text-sm font-bold text-ink">
                  {t.initials}
                </span>
                <span>
                  <span className="block text-sm font-semibold text-white">{t.name}</span>
                  <span className="block text-xs text-slate-500">{t.role}</span>
                </span>
              </figcaption>
            </figure>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
