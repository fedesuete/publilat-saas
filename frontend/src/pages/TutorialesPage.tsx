import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "../components/ui";
import { api } from "../lib/api";
import VideoEmbed from "../components/VideoEmbed";

interface VideoTutorial { id: string; title: string; description: string | null; videoUrl: string; }

interface Guide { title: string; to?: string; steps: string[]; }

// ¿es un archivo de video directo (.mp4 propio) o un embed (YouTube/Vimeo)? Los propios permiten
// detectar el fin del video (onEnded) para auto-avanzar; los embed no, se marcan "vista" a mano.
const isDirectVideo = (url: string) => /\.(mp4|webm|ogg|mov|m4v)(\?.*)?$/i.test(url);

// Progreso del curso guardado en el navegador del cliente (por lección vista).
const DONE_KEY = "publilat.tutoriales.completed";
function loadDone(): Set<string> {
  try {
    const arr = JSON.parse(localStorage.getItem(DONE_KEY) || "[]");
    return new Set(Array.isArray(arr) ? (arr as string[]) : []);
  } catch { return new Set(); }
}

// ---------- Curso en video: lecciones apiladas, se expanden, con progreso y auto-avance ----------
function VideoCourse({ videos }: { videos: VideoTutorial[] }) {
  const [done, setDone] = useState<Set<string>>(() => loadDone());
  const [openId, setOpenId] = useState<string | null>(videos[0]?.id ?? null);
  const [autoplayId, setAutoplayId] = useState<string | null>(null);

  useEffect(() => { localStorage.setItem(DONE_KEY, JSON.stringify([...done])); }, [done]);
  useEffect(() => { setOpenId((cur) => cur ?? videos[0]?.id ?? null); }, [videos]);

  const total = videos.length;
  const completed = videos.filter((v) => done.has(v.id)).length;
  const pct = total ? Math.round((completed / total) * 100) : 0;
  const allDone = total > 0 && completed === total;

  const markDone = (id: string) => setDone((s) => new Set(s).add(id));
  const toggle = (id: string) => { setOpenId((cur) => (cur === id ? null : id)); setAutoplayId(null); };

  // Marca la lección como vista y avanza a la siguiente (autoplay solo si vino de terminar el video).
  const goNext = (id: string, autoplay: boolean) => {
    markDone(id);
    const next = videos[videos.findIndex((v) => v.id === id) + 1];
    if (next) {
      setOpenId(next.id);
      setAutoplayId(autoplay ? next.id : null);
      setTimeout(() => document.getElementById(`lec-${next.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
    } else {
      setOpenId(null); // era la última → curso completo
    }
  };

  return (
    <div className="mb-8 max-w-3xl">
      {/* Barra de progreso con ⚡ al final */}
      <div className="mb-5 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-200">Tu progreso</span>
          <span className="text-xs font-medium tabular-nums text-slate-400">{completed} de {total} lecciones</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative h-3 flex-1 rounded-full bg-slate-800">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-emerald-400 to-wa-green transition-[width] duration-700 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className={`text-xl leading-none transition ${allDone ? "text-wa-green drop-shadow-[0_0_8px_rgba(37,211,102,0.85)]" : "text-slate-600"}`}>⚡</span>
          <span className={`w-10 text-right text-sm font-bold tabular-nums ${allDone ? "text-wa-green" : "text-slate-300"}`}>{pct}%</span>
        </div>
        {allDone && <p className="mt-2 text-sm font-medium text-wa-green">🎉 ¡Completaste todos los tutoriales!</p>}
      </div>

      {/* Lecciones apiladas */}
      <div className="space-y-2.5">
        {videos.map((v, i) => {
          const isOpen = openId === v.id;
          const isDone = done.has(v.id);
          const direct = isDirectVideo(v.videoUrl);
          return (
            <div
              key={v.id}
              id={`lec-${v.id}`}
              className={`overflow-hidden rounded-xl border transition ${isOpen ? "border-wa-green/40 bg-slate-800/40" : "border-slate-800 bg-slate-900/40 hover:border-slate-700"}`}
            >
              <button onClick={() => toggle(v.id)} className="flex w-full items-center gap-3 px-3 py-3 text-left">
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${isDone ? "bg-wa-green text-slate-900" : isOpen ? "bg-wa-green/20 text-wa-green ring-1 ring-wa-green/50" : "bg-slate-800 text-slate-400"}`}>
                  {isDone ? "✓" : i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-100">{v.title}</span>
                  <span className="block text-xs text-slate-500">Lección {i + 1} de {total}{isDone ? " · vista" : ""}</span>
                </span>
                <span className="shrink-0 text-slate-500">{isOpen ? "▲" : "▼"}</span>
              </button>

              {isOpen && (
                <div className="border-t border-slate-800 p-3">
                  <div className="overflow-hidden rounded-lg bg-black">
                    {direct ? (
                      <video
                        key={v.id}
                        src={v.videoUrl}
                        controls
                        playsInline
                        autoPlay={autoplayId === v.id}
                        onEnded={() => goNext(v.id, true)}
                        className="aspect-video w-full"
                      />
                    ) : (
                      <VideoEmbed url={v.videoUrl} />
                    )}
                  </div>
                  {v.description && <p className="mt-3 whitespace-pre-line text-sm text-slate-400">{v.description}</p>}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {!isDone && (
                      <button onClick={() => markDone(v.id)} className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">
                        ✓ Marcar como vista
                      </button>
                    )}
                    {i + 1 < total && (
                      <button onClick={() => goNext(v.id, false)} className="rounded-lg bg-wa-green px-3 py-1.5 text-sm font-semibold text-slate-900 hover:brightness-95">
                        Siguiente lección →
                      </button>
                    )}
                    {!direct && <span className="text-xs text-slate-500">Al terminar, marcá "vista" para avanzar.</span>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

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
  const [videos, setVideos] = useState<VideoTutorial[]>([]);

  useEffect(() => {
    api.get<{ tutorials: VideoTutorial[] }>("/api/tutorials")
      .then(({ data }) => setVideos(data.tutorials))
      .catch(() => { /* sin videos: se muestran igual las guías de texto */ });
  }, []);

  return (
    <div className="p-6">
      <h1 className="mb-1 text-xl font-bold">Tutoriales</h1>
      <p className="mb-5 text-sm text-slate-400">Mirá las lecciones en video. Cada una avanza sola al terminar y podés seguir tu progreso.</p>

      {videos.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">🎓 Curso en video</h2>
          <VideoCourse videos={videos} />
        </div>
      )}

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Guía paso a paso</h2>
      <div className="max-w-2xl space-y-2">
        {GUIDES.map((g) => <GuideCard key={g.title} g={g} />)}
      </div>
    </div>
  );
}
