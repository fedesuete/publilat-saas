import { Clock, ShieldAlert, UserX } from "lucide-react";
import { Reveal } from "./ui/Reveal";

const PROBLEMS = [
  {
    icon: Clock,
    title: "Cargás todo a mano y se hace lento",
    desc: "Cada comprobante se revisa y carga manual. El jugador espera, se impacienta y a veces se va antes de jugar.",
  },
  {
    icon: ShieldAlert,
    title: "Cajeros sin control ni auditoría",
    desc: "No sabés en tiempo real cuánto movió cada cajero, ni tenés un registro claro de cargas, retiros y saldos.",
  },
  {
    icon: UserX,
    title: "Jugadores que se van sin seguimiento",
    desc: "Sin un CRM, no sabés quién depositó, quién dejó de jugar ni a quién reactivar. Perdés recompra todos los días.",
  },
];

export default function Problem() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
      <Reveal>
        <h2 className="text-center text-3xl font-bold text-white sm:text-4xl">
          ¿Tu operación es un <span className="gradient-text">caos</span>?
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-slate-400">
          Si manejás un casino online con cajeros y cargas por transferencia, seguro te pasa esto:
        </p>
      </Reveal>

      <div className="mt-12 grid gap-5 md:grid-cols-3">
        {PROBLEMS.map((p, i) => (
          <Reveal key={p.title} delay={i * 0.08}>
            <div className="card-border card-hover h-full p-6">
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
