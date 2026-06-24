import { ShieldCheck, GitCompareArrows, CreditCard, Users } from "lucide-react";
import { Reveal } from "./ui/Reveal";

const ITEMS = [
  {
    icon: GitCompareArrows,
    title: "Deduplicación navegador + servidor",
    desc: "El mismo evento desde el Pixel y desde CAPI, sin contar doble. Match de máxima calidad.",
  },
  {
    icon: CreditCard,
    title: "Pagás con MercadoPago o USDT",
    desc: "Cargá días desde LATAM con MercadoPago o cripto. Sin fricción, sin tarjetas raras.",
  },
  {
    icon: Users,
    title: "Multi-cliente con tu propio Pixel",
    desc: "¿Agencia? Cada cuenta usa su propio Pixel y token de CAPI. Datos separados y seguros.",
  },
  {
    icon: ShieldCheck,
    title: "Seguridad nivel producción",
    desc: "Tokens cifrados, multi-tenant, rate limiting y reintentos automáticos de eventos.",
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
