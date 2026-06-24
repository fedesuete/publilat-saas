import { Bot, Zap, Trophy } from "lucide-react";
import { Reveal } from "./ui/Reveal";

const ITEMS = [
  {
    icon: Bot,
    title: "Bot de IA 24/7",
    desc: "Un asistente que atiende a tus clientes, responde dudas y guía la compra solo, las 24 horas.",
  },
  {
    icon: Zap,
    title: "Acreditación 100% automática",
    desc: "El comprobante se valida y la venta se confirma sola, sin que nadie toque nada.",
  },
  {
    icon: Trophy,
    title: "Chat con gamificación",
    desc: "Niveles, premios y recompensas para que tus clientes vuelvan a comprar más seguido.",
  },
];

export default function Roadmap() {
  return (
    <section id="proximamente" className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
      <Reveal>
        <div className="text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-wa-green/30 bg-wa-green/10 px-3 py-1 text-xs font-semibold text-wa-green">
            Roadmap
          </span>
          <h2 className="mt-4 text-3xl font-bold text-white sm:text-4xl">
            Lo que viene <span className="gradient-text">próximamente</span>
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-slate-400">
            En lo que estamos trabajando para que vendas todavía con menos esfuerzo.
          </p>
        </div>
      </Reveal>

      <div className="mt-12 grid gap-5 md:grid-cols-3">
        {ITEMS.map((it, i) => (
          <Reveal key={it.title} delay={i * 0.08}>
            <div className="relative h-full rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-6">
              <span className="absolute right-4 top-4 rounded-full bg-white/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Próximamente
              </span>
              <div className="mb-4 inline-flex rounded-xl bg-white/5 p-3">
                <it.icon className="h-6 w-6 text-slate-300" />
              </div>
              <h3 className="text-lg font-semibold text-slate-100">{it.title}</h3>
              <p className="mt-2 text-sm text-slate-500">{it.desc}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
