import { ShieldCheck, Bot, CreditCard, Layers } from "lucide-react";
import { Reveal } from "./ui/Reveal";

const ITEMS = [
  {
    icon: Bot,
    title: "Un bot que trabaja por vos",
    desc: "Acredita cargas leyendo el comprobante, atiende 24/7 y libera a tus cajeros de la parte repetitiva.",
  },
  {
    icon: CreditCard,
    title: "Pagos locales de verdad",
    desc: "Bancard, Tigo Money, Ueno, transferencias y USDT. Como cobra y paga tu operación en LATAM.",
  },
  {
    icon: Layers,
    title: "Multi-marca y multi-caja",
    desc: "Manejá varias marcas y cajas desde un panel, con datos y permisos separados por cada una.",
  },
  {
    icon: ShieldCheck,
    title: "Seguridad y auditoría",
    desc: "Cada carga, retiro y acción queda registrada. Roles, permisos y respaldo nivel producción.",
  },
];

export default function WhyUs() {
  return (
    <section className="relative mx-auto max-w-7xl px-4 py-24 sm:px-6">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="halo absolute left-1/2 top-1/2 h-[30rem] w-[30rem] -translate-x-1/2 -translate-y-1/2 opacity-40" />
      </div>
      <Reveal>
        <h2 className="text-center text-3xl font-bold text-white sm:text-4xl">
          ¿Por qué <span className="gradient-text">Publi.lat</span>?
        </h2>
      </Reveal>
      <div className="mx-auto mt-12 grid max-w-4xl gap-4 sm:grid-cols-2">
        {ITEMS.map((it, i) => (
          <Reveal key={it.title} delay={i * 0.06}>
            <div className="flex gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <div className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-wa-green/10">
                <it.icon className="h-5 w-5 text-wa-green" />
              </div>
              <div>
                <h3 className="font-semibold text-white">{it.title}</h3>
                <p className="mt-1 text-sm text-slate-400">{it.desc}</p>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
