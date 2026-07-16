import { useEffect, useState, type FormEvent } from "react";
import { api, apiError } from "../../lib/api";
import { Button, Input, Card, ErrorMsg } from "../../components/ui";
import VideoEmbed from "../../components/VideoEmbed";
import { Trash2, ArrowUp, ArrowDown, Eye, EyeOff } from "lucide-react";

interface Tutorial {
  id: string;
  title: string;
  description: string | null;
  videoUrl: string;
  order: number;
  active: boolean;
}

export default function AdminTutorials() {
  const [items, setItems] = useState<Tutorial[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Alta
  const [title, setTitle] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setError(null);
    try {
      const { data } = await api.get<{ tutorials: Tutorial[] }>("/api/admin/tutorials");
      setItems(data.tutorials);
    } catch (e) {
      setError(apiError(e));
    }
  };
  useEffect(() => { void load(); }, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !videoUrl.trim()) { setError("Poné un título y el link del video."); return; }
    setBusy(true); setError(null);
    try {
      await api.post("/api/admin/tutorials", {
        title: title.trim(),
        videoUrl: videoUrl.trim(),
        description: description.trim() || null,
      });
      setTitle(""); setVideoUrl(""); setDescription("");
      await load();
    } catch (err) { setError(apiError(err)); } finally { setBusy(false); }
  };

  const patch = async (id: string, body: Partial<Tutorial>) => {
    setError(null);
    try { await api.put(`/api/admin/tutorials/${id}`, body); await load(); }
    catch (err) { setError(apiError(err)); }
  };

  const del = async (id: string) => {
    if (!confirm("¿Borrar este tutorial?")) return;
    setError(null);
    try { await api.delete(`/api/admin/tutorials/${id}`); await load(); }
    catch (err) { setError(apiError(err)); }
  };

  // Reordenar: intercambia el "order" con el vecino de arriba/abajo.
  const move = async (idx: number, dir: -1 | 1) => {
    const a = items[idx];
    const b = items[idx + dir];
    if (!a || !b) return;
    setError(null);
    try {
      await Promise.all([
        api.put(`/api/admin/tutorials/${a.id}`, { order: b.order }),
        api.put(`/api/admin/tutorials/${b.id}`, { order: a.order }),
      ]);
      await load();
    } catch (err) { setError(apiError(err)); }
  };

  return (
    <div className="p-6">
      <h1 className="mb-1 text-xl font-bold">Tutoriales</h1>
      <p className="mb-4 text-sm text-slate-400">
        Videos que ven todos los clientes en <span className="text-slate-200">Tutoriales</span>. Subí el video a
        YouTube/Vimeo (podés ponerlo como <span className="text-slate-200">"no listado"</span>) o usá un link .mp4, y pegá acá la URL.
      </p>
      {error && <div className="mb-3"><ErrorMsg>{error}</ErrorMsg></div>}

      {/* Alta */}
      <Card className="mb-6 max-w-2xl">
        <div className="mb-2 text-sm font-semibold text-slate-200">Agregar tutorial</div>
        <form onSubmit={create} className="space-y-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título (ej: Cómo conectar WhatsApp)" />
          <Input value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="Link del video (YouTube, Vimeo o .mp4)" />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Descripción (opcional)"
            rows={2}
            className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-wa-green focus:outline-none"
          />
          {videoUrl.trim() && <VideoEmbed url={videoUrl.trim()} className="max-w-sm" />}
          <Button type="submit" disabled={busy}>{busy ? "Guardando…" : "Agregar"}</Button>
        </form>
      </Card>

      {/* Listado */}
      <div className="space-y-4">
        {items.map((t, i) => (
          <TutorialRow
            key={t.id}
            t={t}
            first={i === 0}
            last={i === items.length - 1}
            onSave={(body) => patch(t.id, body)}
            onDelete={() => del(t.id)}
            onUp={() => move(i, -1)}
            onDown={() => move(i, 1)}
          />
        ))}
        {items.length === 0 && (
          <Card><p className="text-sm text-slate-500">Todavía no hay tutoriales. Agregá el primero arriba.</p></Card>
        )}
      </div>
    </div>
  );
}

function TutorialRow({
  t, first, last, onSave, onDelete, onUp, onDown,
}: {
  t: Tutorial;
  first: boolean;
  last: boolean;
  onSave: (body: Partial<Tutorial>) => void;
  onDelete: () => void;
  onUp: () => void;
  onDown: () => void;
}) {
  const [title, setTitle] = useState(t.title);
  const [videoUrl, setVideoUrl] = useState(t.videoUrl);
  const [description, setDescription] = useState(t.description ?? "");
  const dirty = title !== t.title || videoUrl !== t.videoUrl || description !== (t.description ?? "");

  return (
    <Card className={t.active ? "" : "opacity-60"}>
      <div className="flex flex-col gap-3 md:flex-row">
        <div className="w-full md:w-64 shrink-0">
          <VideoEmbed url={videoUrl.trim() || t.videoUrl} />
        </div>
        <div className="flex-1 space-y-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título" />
          <Input value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="Link del video" />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Descripción (opcional)"
            rows={2}
            className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-wa-green focus:outline-none"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => onSave({ title: title.trim(), videoUrl: videoUrl.trim(), description: description.trim() || null })}
              disabled={!dirty}
            >
              Guardar
            </Button>
            <button
              onClick={() => onSave({ active: !t.active })}
              className="flex items-center gap-1 rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
              title={t.active ? "Ocultar a los clientes" : "Mostrar a los clientes"}
            >
              {t.active ? <><EyeOff className="h-4 w-4" /> Ocultar</> : <><Eye className="h-4 w-4" /> Mostrar</>}
            </button>
            <div className="ml-auto flex items-center gap-1">
              <button onClick={onUp} disabled={first} className="rounded-md border border-slate-700 p-2 text-slate-300 hover:bg-slate-800 disabled:opacity-30" title="Subir"><ArrowUp className="h-4 w-4" /></button>
              <button onClick={onDown} disabled={last} className="rounded-md border border-slate-700 p-2 text-slate-300 hover:bg-slate-800 disabled:opacity-30" title="Bajar"><ArrowDown className="h-4 w-4" /></button>
              <button onClick={onDelete} className="rounded-md border border-red-500/40 p-2 text-red-300 hover:bg-red-500/10" title="Borrar"><Trash2 className="h-4 w-4" /></button>
            </div>
          </div>
          {!t.active && <p className="text-xs text-amber-400">Oculto — los clientes no lo ven.</p>}
        </div>
      </div>
    </Card>
  );
}
