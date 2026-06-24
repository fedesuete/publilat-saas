import { motion } from "framer-motion";
import { Link2, MessageCircle, ShoppingBag, Repeat } from "lucide-react";
import { Reveal } from "./ui/Reveal";

const STEPS = [
  {
    icon: Link2,
    n: "01",
    title: "Link rastreado",
    desc: "Compartís un link de Publi.lat en tu anuncio. Captura el clic, el fbclid y las cookies de Meta.",
  },
  {
    icon: MessageCircle,
    n: "02",
    title: "Dispara el Lead y va a WhatsApp",
    desc: "El clic envía el evento Lead a Meta y redirige al cliente a tu WhatsApp con un código de seguimiento.",
  },
  {
    icon: ShoppingBag,
    n: "03",
    title: "El cliente compra",
    desc: "Atendés el chat en el Inbox. Al cerrar la venta, la marcás con el monto en el CRM.",
  },
  {
    icon: Repeat,
    n: "04",
    title: "La venta vuelve a Meta",
    desc: "Se envía el Purchase por CAPI con el mismo identificador y el valor. Meta optimiza por compradores reales.",
  },
];

export default function HowItWorks() {
  return (
    <section id="como-funciona" className="relative mx-auto max-w-7xl px-4 py-24 sm:px-6">
      <Reveal>
        <h2 className="text-center text-3xl font-bold text-white sm:text-4xl">
          Cómo funciona el <span className="gradient-text">círculo cerrado</span>
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-slate-400">
          Del clic del anuncio a la venta — y de vuelta a Meta. En 4 pasos.
        </p>
      </Reveal>

      <div className="relative mt-14 grid gap-6 md:grid-cols-4">
        {/* línea conectora en desktop — se dibuja al entrar */}
        <motion.div
          className="absolute left-0 right-0 top-9 hidden h-px origin-left bg-gradient-to-r from-transparent via-wa-green/50 to-transparent md:block"
          initial={{ scaleX: 0 }}
          whileInView={{ scaleX: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 1, ease: "easeOut" }}
        />
        {STEPS.map((s, i) => (
          <Reveal key={s.n} delay={i * 0.1}>
            <div className="relative flex flex-col items-center text-center">
              <div className="relative z-10 mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-wa-green/30 bg-ink2 p-4 shadow-lg shadow-emerald-500/10">
                <s.icon className="h-7 w-7 text-wa-green" />
              </div>
              <div className="text-xs font-bold tracking-widest text-wa-green">{s.n}</div>
              <h3 className="mt-1 text-base font-semibold text-white">{s.title}</h3>
              <p className="mt-2 text-sm text-slate-400">{s.desc}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
