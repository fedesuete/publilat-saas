import {
  Cable,
  Target,
  BarChart3,
  TrendingUp,
  LayoutTemplate,
  Phone,
  Inbox,
  KanbanSquare,
  Share2,
  ScanLine,
} from "lucide-react";
import { Reveal } from "./ui/Reveal";

const FEATURES = [
  {
    icon: Cable,
    title: "Conexión sin código",
    desc: "Vinculás WhatsApp + Meta Ads en minutos, sin tocar código. También Kommo o webhook a tu CRM.",
  },
  {
    icon: Target,
    title: "Atribución real (Pixel + CAPI)",
    desc: "Eventos Lead y Compra server-side con Meta Pixel y la Conversions API. El dato vuelve a Meta.",
  },
  {
    icon: BarChart3,
    title: "ROAS real por campaña",
    desc: "Tu retorno real por campaña, conjunto y anuncio. Medido, no estimado.",
  },
  {
    icon: TrendingUp,
    title: "Optimización por ventas",
    desc: "Le mandamos la compra real a Meta para que el algoritmo traiga compradores, no curiosos.",
  },
  {
    icon: LayoutTemplate,
    title: "Landings rastreadas",
    desc: "Creá una landing por campaña con el builder no-code, ya rastreada y lista para pautar.",
  },
  {
    icon: Phone,
    title: "Multi-línea con rotación",
    desc: "Varias líneas de WhatsApp activas; los clics se reparten solos entre ellas.",
  },
  {
    icon: Inbox,
    title: "Inbox unificado",
    desc: "Respondé todos los chats desde el panel, con la atribución de cada contacto al lado.",
  },
  {
    icon: KanbanSquare,
    title: "CRM kanban con montos",
    desc: "Movés cada lead de Nuevo a Comprado y marcás el monto de la venta en un clic.",
  },
  {
    icon: Share2,
    title: "Dashboard en vivo compartible",
    desc: "Métricas en tiempo real, con link de solo lectura para compartir con tu equipo.",
  },
  {
    icon: ScanLine,
    title: "Detección de comprobante con IA",
    desc: "La IA lee el comprobante (imagen o PDF), extrae el monto y dejás la venta lista con un clic.",
  },
];

export default function Features() {
  return (
    <section id="caracteristicas" className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
      <Reveal>
        <h2 className="text-center text-3xl font-bold text-white sm:text-4xl">
          Todo para vender más <span className="gradient-text">con datos reales</span>
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-slate-400">
          Una sola plataforma: del clic del anuncio a la venta — y de vuelta a Meta.
        </p>
      </Reveal>

      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f, i) => (
          <Reveal key={f.title} delay={(i % 3) * 0.06}>
            <div className="card-border card-hover h-full p-6">
              <div className="mb-3 inline-flex rounded-xl bg-wa-green/10 p-2.5">
                <f.icon className="h-5 w-5 text-wa-green" />
              </div>
              <h3 className="text-base font-semibold text-white">{f.title}</h3>
              <p className="mt-1.5 text-sm text-slate-400">{f.desc}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
