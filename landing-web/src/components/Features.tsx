import { BarChart3, Layers, ShieldCheck, ArrowDownUp, Activity, Plug } from "lucide-react";
import { Reveal } from "./ui/Reveal";

export default function Features() {
  return (
    <section id="caracteristicas" className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
      <Reveal>
        <h2 className="text-center text-3xl font-bold text-white sm:text-4xl">
          Y todo lo demás, <span className="gradient-text">bajo el capó</span>
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-slate-400">
          Una plataforma completa para operar tu casino sin planillas ni sorpresas.
        </p>
      </Reveal>

      {/* Bento grid */}
      <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* Grande: reportes */}
        <Reveal className="md:col-span-2">
          <div className="card-border card-hover h-full overflow-hidden p-7">
            <div className="mb-4 inline-flex rounded-xl bg-wa-green/10 p-3">
              <BarChart3 className="h-6 w-6 text-wa-green" />
            </div>
            <h3 className="text-xl font-semibold text-white">Reportes en tiempo real</h3>
            <p className="mt-2 max-w-lg text-sm text-slate-400">
              GGR, depósitos, retiros y jugadores activos al instante. Desglosá por{" "}
              <strong className="text-slate-200">marca</strong>,{" "}
              <strong className="text-slate-200">cajero</strong> y{" "}
              <strong className="text-slate-200">período</strong> para saber exactamente cómo viene la operación.
            </p>
            <div className="mt-5 flex flex-wrap gap-2 text-xs">
              {["GGR diario", "por cajero", "por marca", "exportable"].map((t) => (
                <span key={t} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-slate-300">
                  {t}
                </span>
              ))}
            </div>
          </div>
        </Reveal>

        {/* Cargas / retiros */}
        <Reveal delay={0.05}>
          <div className="card-border card-hover flex h-full flex-col justify-between p-7">
            <div>
              <div className="mb-4 inline-flex rounded-xl bg-lime-400/10 p-3">
                <ArrowDownUp className="h-6 w-6 text-lime-300" />
              </div>
              <h3 className="text-lg font-semibold text-white">Cargas y retiros auditados</h3>
              <p className="mt-2 text-sm text-slate-400">
                Cada movimiento queda registrado con su comprobante. Arqueo de caja sin dolores de cabeza.
              </p>
            </div>
            <div className="mt-5 text-3xl font-extrabold gradient-text">100% trazable</div>
          </div>
        </Reveal>

        {/* resto */}
        {[
          { icon: Layers, title: "Multi-marca y multi-caja", desc: "Operá varias marcas y cajas desde un solo panel, con datos separados por cada una." },
          { icon: ShieldCheck, title: "Roles y permisos", desc: "Cada cajero, supervisor y admin ve solo lo que le corresponde. Control total de accesos." },
          { icon: ArrowDownUp, title: "Pagos locales", desc: "Bancard, Tigo Money, Ueno, transferencias y USDT. Como cobra y paga tu operación." },
        ].map((f, i) => (
          <Reveal key={f.title} delay={i * 0.05}>
            <div className="card-border card-hover h-full p-6">
              <div className="mb-3 inline-flex rounded-xl bg-emerald-400/10 p-2.5">
                <f.icon className="h-5 w-5 text-emerald-400" />
              </div>
              <h3 className="text-base font-semibold text-white">{f.title}</h3>
              <p className="mt-1.5 text-sm text-slate-400">{f.desc}</p>
            </div>
          </Reveal>
        ))}

        {/* ancho: seguridad + integraciones */}
        <Reveal delay={0.05} className="md:col-span-2">
          <div className="card-border card-hover flex h-full flex-col justify-between gap-4 p-7 sm:flex-row sm:items-center">
            <div>
              <div className="mb-3 inline-flex rounded-xl bg-sky-400/10 p-2.5">
                <Activity className="h-5 w-5 text-sky-400" />
              </div>
              <h3 className="text-lg font-semibold text-white">Tablero de operación 24/7</h3>
              <p className="mt-1.5 max-w-md text-sm text-slate-400">
                Mirá el pulso de tu casino en vivo: cargas, retiros, jugadores y alertas, desde cualquier dispositivo.
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
              <Plug className="h-5 w-5 text-wa-green" />
              <span>Integra: WhatsApp · Telegram · pagos</span>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
