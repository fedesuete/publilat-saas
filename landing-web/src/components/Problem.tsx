import { MessageSquareOff, EyeOff, Wallet } from "lucide-react";
import { Reveal } from "./ui/Reveal";

const PROBLEMS = [
  {
    icon: MessageSquareOff,
    title: "Meta optimiza por mensajes, no por ventas",
    desc: "Pagás por “conversaciones iniciadas”, aunque la mayoría nunca compre. El dato de la venta nunca vuelve a Meta.",
  },
  {
    icon: EyeOff,
    title: "No sabés qué campaña te factura",
    desc: "Vendés por WhatsApp pero no podés decir qué anuncio, conjunto o campaña trajo ese comprador. Volás a ciegas.",
  },
  {
    icon: Wallet,
    title: "Quemás presupuesto en leads fríos",
    desc: "Sin la señal de compra, el algoritmo trae más curiosos y menos compradores. Tu plata se va en chats que no cierran.",
  },
];

export default function Problem() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
      <Reveal>
        <h2 className="text-center text-3xl font-bold text-white sm:text-4xl">
          ¿Cansado de <span className="gradient-text">adivinar</span>?
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-slate-400">
          Si vendés por WhatsApp con tráfico de Meta, seguro te pasa esto:
        </p>
      </Reveal>

      <div className="mt-12 grid gap-5 md:grid-cols-3">
        {PROBLEMS.map((p, i) => (
          <Reveal key={p.title} delay={i * 0.08}>
            <div className="card-border h-full p-6">
              <div className="mb-4 inline-flex rounded-xl bg-red-500/10 p-3">
                <p.icon className="h-6 w-6 text-red-400" />
              </div>
              <h3 className="text-lg font-semibold text-white">{p.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{p.desc}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
