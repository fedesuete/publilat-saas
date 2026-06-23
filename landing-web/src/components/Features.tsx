import { Target, BarChart3, Phone, Inbox, KanbanSquare, Activity, Plug } from "lucide-react";
import { Reveal } from "./ui/Reveal";

export default function Features() {
  return (
    <section id="caracteristicas" className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
      <Reveal>
        <h2 className="text-center text-3xl font-bold text-white sm:text-4xl">
          Y todo lo demás, <span className="gradient-text">bajo el capó</span>
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-slate-400">
          Un sistema completo: del clic a la venta, con la señal de compra de vuelta en Meta.
        </p>
      </Reveal>

      {/* Bento grid */}
      <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* Grande: atribución */}
        <Reveal className="md:col-span-2" >
          <div className="card-border card-hover h-full overflow-hidden p-7">
            <div className="mb-4 inline-flex rounded-xl bg-wa-green/10 p-3">
              <Target className="h-6 w-6 text-wa-green" />
            </div>
            <h3 className="text-xl font-semibold text-white">Atribución real con Conversions API</h3>
            <p className="mt-2 max-w-lg text-sm text-slate-400">
              Enviamos <strong className="text-slate-200">Lead</strong> y{" "}
              <strong className="text-slate-200">Purchase</strong> server-side con el mismo{" "}
              <code className="rounded bg-white/5 px-1">external_id</code>, <code className="rounded bg-white/5 px-1">fbp</code> y{" "}
              <code className="rounded bg-white/5 px-1">fbc</code>. Meta matchea el comprador y deja
              de optimizar por curiosos.
            </p>
            <div className="mt-5 flex flex-wrap gap-2 text-xs">
              {["event_id dedup", "navegador + servidor", "valor de compra", "Test Events"].map((t) => (
                <span key={t} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-slate-300">
                  {t}
                </span>
              ))}
            </div>
          </div>
        </Reveal>

        {/* ROAS */}
        <Reveal delay={0.05}>
          <div className="card-border card-hover flex h-full flex-col justify-between p-7">
            <div>
              <div className="mb-4 inline-flex rounded-xl bg-lime-400/10 p-3">
                <BarChart3 className="h-6 w-6 text-lime-300" />
              </div>
              <h3 className="text-lg font-semibold text-white">ROAS por campaña, conjunto y anuncio</h3>
              <p className="mt-2 text-sm text-slate-400">
                Mirás tu retorno real desglosado. Sabés exactamente qué escalar y qué cortar.
              </p>
            </div>
            <div className="mt-5 text-3xl font-extrabold gradient-text">4.7x</div>
          </div>
        </Reveal>

        {/* resto */}
        {[
          { icon: Phone, title: "Multi-línea con rotación", desc: "Varias líneas de WhatsApp activas; los clics se reparten solos entre ellas." },
          { icon: Inbox, title: "Inbox unificado", desc: "Todos los chats en un solo lugar, con el lead y su atribución al lado." },
          { icon: KanbanSquare, title: "CRM kanban con montos", desc: "Arrastrá leads por etapa y marcá la venta con su valor en un clic." },
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

        {/* ancho: dashboard + integraciones */}
        <Reveal delay={0.05} className="md:col-span-2">
          <div className="card-border card-hover flex h-full flex-col justify-between gap-4 p-7 sm:flex-row sm:items-center">
            <div>
              <div className="mb-3 inline-flex rounded-xl bg-sky-400/10 p-2.5">
                <Activity className="h-5 w-5 text-sky-400" />
              </div>
              <h3 className="text-lg font-semibold text-white">Dashboard en tiempo real</h3>
              <p className="mt-1.5 max-w-md text-sm text-slate-400">
                Clics, chats, ventas y ROAS al instante, con ventana de hoy, semana y mes.
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
              <Plug className="h-5 w-5 text-wa-green" />
              <span>Integraciones: nativo · Kommo · webhook</span>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
