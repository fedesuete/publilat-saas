import { useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "../components/ui";

interface Guide { title: string; to?: string; steps: string[]; }

const GUIDES: Guide[] = [
  {
    title: "1. Cargá tu Pixel de Meta",
    to: "/pixel",
    steps: [
      "Andá a Meta → Administrador de eventos → tu conjunto de datos: copiá el Pixel ID (el número de arriba).",
      "En ese mismo conjunto → Configuración → API de conversiones → Generar token de acceso.",
      "En Publi.lat → Mi Pixel → Agregar pixel: pegá el Pixel ID y el token. Listo: tus eventos van a tu cuenta.",
    ],
  },
  {
    title: "2. Conectá WhatsApp",
    to: "/whatsapp",
    steps: [
      "WhatsApp → Crear línea (poné una etiqueta, ej: Ventas).",
      "Aparece un QR: abrí WhatsApp en el celu → Dispositivos vinculados → Vincular dispositivo → escaneá.",
      "Cuando el estado pase a 'conectada' (verde), la línea queda lista.",
    ],
  },
  {
    title: "3. Cargá días y activá la línea",
    to: "/billing",
    steps: [
      "Créditos → comprá o agregá días.",
      "WhatsApp → en tu línea, poné los días y tocá 'Activar': eso la pone en rotación.",
      "1 día = 24 h de línea activa. Al vencer, sale de rotación automáticamente.",
    ],
  },
  {
    title: "4. Creá tus links y landings",
    to: "/links",
    steps: [
      "Links → copiá tu link directo (/go) o tu landing (/l) para pegar en los anuncios.",
      "Landings → creá una página rastreada por campos o con HTML libre; publicala y compartí su URL.",
      "Ambos disparan el evento Lead (deduplicado navegador + servidor) antes de llevar a WhatsApp.",
    ],
  },
  {
    title: "5. Gestioná leads y ventas",
    to: "/kanban",
    steps: [
      "Inbox: respondé los chats que llegan (se asocian al lead por el código).",
      "Kanban / Agenda: movés el lead por las etapas y ves su atribución completa.",
      "Al cerrar una venta, marcá 'Marcó compra' con el monto: se envía el Purchase a Meta con el mismo identificador.",
    ],
  },
  {
    title: "6. Medí el resultado",
    to: "/dashboard",
    steps: [
      "Dashboard: clics, chats reales, ratio Click→Chat, ventas y conversión por hoy / semana / mes.",
      "Mirá el gráfico de leads de los últimos 30 días y el desglose por campaña y fuente.",
      "Verificá en el Test Events Tool de Meta que Lead y Purchase lleguen con buen Event Match Quality.",
    ],
  },
  {
    title: "7. Integraciones con tu CRM",
    to: "/integraciones",
    steps: [
      "Configuración → elegí el modo: nativo (sin webhook), webhook genérico o Kommo.",
      "Integraciones → poné la URL de tu CRM y un secret (se firma el payload con HMAC).",
      "Por cada lead y compra te enviamos un POST con los datos de atribución.",
    ],
  },
];

function GuideCard({ g }: { g: Guide }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="p-0">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-800/40">
        <span className="text-sm font-semibold text-slate-100">{g.title}</span>
        <span className="text-slate-500">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="border-t border-slate-800 px-4 py-3">
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-300">
            {g.steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
          {g.to && (
            <Link to={g.to} className="mt-3 inline-block text-sm font-medium text-wa-green hover:underline">
              Ir a la sección →
            </Link>
          )}
        </div>
      )}
    </Card>
  );
}

export default function TutorialesPage() {
  return (
    <div className="p-6">
      <h1 className="mb-1 text-xl font-bold">Tutoriales</h1>
      <p className="mb-5 text-sm text-slate-400">Guía rápida para dejar tu atribución WhatsApp → Meta funcionando.</p>
      <div className="max-w-2xl space-y-2">
        {GUIDES.map((g) => <GuideCard key={g.title} g={g} />)}
      </div>
    </div>
  );
}
