import { Link } from "react-router-dom";
import { Card, Button } from "../components/ui";
import { Target, MessageCircle, Coins, Link2, KanbanSquare, GraduationCap, PlayCircle, LifeBuoy } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const SUPPORT = "https://wa.me/595975112248?text=" + encodeURIComponent("Hola, necesito ayuda con Publi.lat 🙌");

const STEPS: Array<{ n: number; icon: LucideIcon; title: string; desc: string; to: string; cta: string }> = [
  { n: 1, icon: Target, title: "Cargá tu Pixel de Meta", desc: "Pegá tu Pixel ID y el token de la API de Conversiones. Sin esto, Meta no recibe tus ventas.", to: "/pixel", cta: "Ir a Mi Pixel" },
  { n: 2, icon: MessageCircle, title: "Conectá WhatsApp", desc: "Creá una línea y escaneá el QR desde tu celular. Cuando quede en verde, está lista.", to: "/whatsapp", cta: "Ir a WhatsApp" },
  { n: 3, icon: Coins, title: "Cargá días y activá la línea", desc: "1 día = 24 h de línea activa en rotación. Comprá o sumá días y activá tu línea.", to: "/billing", cta: "Ir a Créditos" },
  { n: 4, icon: Link2, title: "Creá tu link o landing", desc: "Copiá tu link rastreado (/go) o tu landing y pegalo en los anuncios de Meta.", to: "/links", cta: "Ir a Links" },
  { n: 5, icon: KanbanSquare, title: "Gestioná leads y marcá ventas", desc: "Respondé en el Inbox, movés el lead por etapas y al cerrar marcás la compra con el monto.", to: "/kanban", cta: "Ir al CRM" },
];

export default function EmpezarPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">¡Bienvenido a Publi.lat! 🚀</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">
          Publi.lat cierra el círculo de tus anuncios: <span className="text-slate-200">anuncio de Meta → tu WhatsApp → venta</span>,
          y le devuelve la compra a Meta para que optimice por <span className="text-slate-200">compradores reales</span>, no por
          mensajes. Seguí estos pasos y en minutos lo tenés funcionando.
        </p>
      </div>

      {/* Accesos rápidos */}
      <div className="mb-6 flex flex-wrap gap-3">
        <Link to="/tutoriales">
          <Button className="flex items-center gap-2"><PlayCircle className="h-4 w-4" /> Ver los videos</Button>
        </Link>
        <a href={SUPPORT} target="_blank" rel="noopener noreferrer">
          <Button variant="ghost" className="flex items-center gap-2"><LifeBuoy className="h-4 w-4" /> Hablar con soporte</Button>
        </a>
        <button
          onClick={() => window.dispatchEvent(new Event("pl:start-tour"))}
          className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
        >
          Ver el recorrido guiado
        </button>
      </div>

      {/* Pasos */}
      <div className="grid max-w-4xl gap-4 sm:grid-cols-2">
        {STEPS.map((s) => (
          <Card key={s.n} className="flex flex-col">
            <div className="mb-2 flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-wa-green/15 text-wa-green">
                <s.icon className="h-5 w-5" />
              </span>
              <div className="text-sm font-semibold text-slate-100">
                <span className="text-slate-500">Paso {s.n}.</span> {s.title}
              </div>
            </div>
            <p className="mb-3 flex-1 text-sm text-slate-400">{s.desc}</p>
            <Link to={s.to} className="text-sm font-medium text-wa-green hover:underline">{s.cta} →</Link>
          </Card>
        ))}

        <Card className="flex flex-col justify-center border-wa-green/30 bg-wa-green/5">
          <div className="mb-2 flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-wa-green/15 text-wa-green">
              <GraduationCap className="h-5 w-5" />
            </span>
            <div className="text-sm font-semibold text-slate-100">¿Preferís verlo en video?</div>
          </div>
          <p className="mb-3 flex-1 text-sm text-slate-400">En Tutoriales tenés todo explicado paso a paso.</p>
          <Link to="/tutoriales" className="text-sm font-medium text-wa-green hover:underline">Ir a Tutoriales →</Link>
        </Card>
      </div>
    </div>
  );
}
