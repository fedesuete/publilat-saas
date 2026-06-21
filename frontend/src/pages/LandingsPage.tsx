import { useEffect, useState, type FormEvent } from "react";
import { api, apiError } from "../lib/api";
import { API_BASE } from "../lib/config";
import { fmtDate } from "../lib/format";
import { Button, Input, Card, ErrorMsg } from "../components/ui";

interface LandingConfig {
  title?: string;
  headline?: string;
  subtitle?: string;
  buttonText?: string;
  msg?: string;
}

interface Landing {
  id: string;
  name: string;
  slug: string;
  config: LandingConfig | null;
  isPrimary: boolean;
  published: boolean;
  publishedUrl: string | null;
  createdAt: string;
}

function landingUrl(slug: string): string {
  return `${API_BASE}/p/${slug}`;
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Button variant="secondary" onClick={() => void copy()}>
      {copied ? "¡Copiado!" : "Copiar"}
    </Button>
  );
}

interface FormState {
  name: string;
  title: string;
  headline: string;
  subtitle: string;
  buttonText: string;
  msg: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  title: "",
  headline: "",
  subtitle: "",
  buttonText: "",
  msg: "",
};

export default function LandingsPage() {
  const [landings, setLandings] = useState<Landing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<Landing | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<{ landings: Landing[] }>("/api/landings");
      setLandings(data.landings);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const startCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setLastSaved(null);
  };

  const startEdit = (l: Landing) => {
    setEditingId(l.id);
    setLastSaved(null);
    const c = l.config ?? {};
    setForm({
      name: l.name,
      title: c.title ?? "",
      headline: c.headline ?? "",
      subtitle: c.subtitle ?? "",
      buttonText: c.buttonText ?? "",
      msg: c.msg ?? "",
    });
  };

  const buildConfig = (): LandingConfig => ({
    title: form.title || undefined,
    headline: form.headline || undefined,
    subtitle: form.subtitle || undefined,
    buttonText: form.buttonText || undefined,
    msg: form.msg || undefined,
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError("El nombre es obligatorio.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const config = buildConfig();
      if (editingId) {
        const { data } = await api.put<{ landing: Landing }>(
          `/api/landings/${editingId}`,
          { name: form.name.trim(), config }
        );
        setLastSaved(data.landing);
      } else {
        const { data } = await api.post<{ landing: Landing }>("/api/landings", {
          name: form.name.trim(),
          config,
        });
        setLastSaved(data.landing);
      }
      setForm(EMPTY_FORM);
      setEditingId(null);
      await load();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  const publish = async (l: Landing) => {
    setBusyId(l.id);
    setError(null);
    try {
      const { data } = await api.post<{
        landing: { id: string; slug: string; published: boolean; publishedUrl: string | null };
        host: "s3" | "local";
      }>(`/api/landings/${l.id}/publish`);
      setLandings((prev) =>
        prev.map((x) =>
          x.id === l.id
            ? { ...x, published: data.landing.published, publishedUrl: data.landing.publishedUrl }
            : x
        )
      );
      setLastSaved(null);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusyId(null);
    }
  };

  const makePrimary = async (l: Landing) => {
    setBusyId(l.id);
    setError(null);
    try {
      await api.put<{ landing: Landing }>(`/api/landings/${l.id}`, { isPrimary: true });
      await load();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (l: Landing) => {
    if (!window.confirm(`¿Borrar la landing "${l.name}"? Esta acción no se puede deshacer.`)) {
      return;
    }
    setBusyId(l.id);
    setError(null);
    try {
      await api.delete<{ ok: true }>(`/api/landings/${l.id}`);
      if (editingId === l.id) startCreate();
      await load();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusyId(null);
    }
  };

  const setField = (key: keyof FormState, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="p-6">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-xl font-bold">Landings</h1>
        <Button variant="secondary" onClick={() => void load()}>
          Actualizar
        </Button>
      </div>
      <p className="mb-5 text-sm text-slate-400">
        Páginas rastreadas que disparan el evento Lead antes de llevar a WhatsApp.
        Cada landing trae el Pixel del navegador y el botón deduplicado con el servidor.
      </p>

      {error && (
        <div className="mb-4">
          <ErrorMsg>{error}</ErrorMsg>
        </div>
      )}

      {lastSaved && (
        <Card className="mb-4 border-wa-green/40 bg-wa-green/5">
          <div className="mb-1 text-sm font-semibold text-wa-green">
            Landing guardada: {lastSaved.name}
          </div>
          <p className="mb-2 text-xs text-slate-400">
            Esta landing ya trae el Pixel del navegador y el botón que dispara el Lead
            (deduplicado con el server).
          </p>
          <div className="flex gap-2">
            <input
              readOnly
              value={landingUrl(lastSaved.slug)}
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-300"
            />
            <CopyButton value={landingUrl(lastSaved.slug)} />
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* List */}
        <div>
          {loading ? (
            <p className="text-slate-400">Cargando…</p>
          ) : landings.length === 0 ? (
            <Card>
              <p className="text-slate-300">Todavía no hay landings.</p>
              <p className="mt-1 text-sm text-slate-500">
                Creá tu primera landing con el formulario de la derecha.
              </p>
            </Card>
          ) : (
            <div className="space-y-3">
              {landings.map((l) => (
                <Card key={l.id}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-100">{l.name}</span>
                        {l.isPrimary && (
                          <span className="rounded-full bg-wa-green px-2 py-0.5 text-xs font-semibold text-slate-900">
                            primaria
                          </span>
                        )}
                        {l.published ? (
                          <span className="rounded-full bg-emerald-700 px-2 py-0.5 text-xs font-semibold text-emerald-50">
                            publicada
                          </span>
                        ) : (
                          <span className="rounded-full bg-slate-600 px-2 py-0.5 text-xs font-semibold text-slate-100">
                            borrador
                          </span>
                        )}
                      </div>
                      <div className="mt-1 font-mono text-xs text-slate-500">/{l.slug}</div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        creada {fmtDate(l.createdAt)}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <input
                      readOnly
                      value={landingUrl(l.slug)}
                      className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 font-mono text-xs text-slate-300"
                    />
                    <CopyButton value={landingUrl(l.slug)} />
                  </div>

                  {l.published && l.publishedUrl && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-emerald-300">Publicada en:</span>
                      <a
                        href={l.publishedUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="min-w-0 flex-1 truncate font-mono text-xs text-emerald-200 underline"
                      >
                        {l.publishedUrl}
                      </a>
                      <CopyButton value={l.publishedUrl} />
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => window.open(landingUrl(l.slug), "_blank")}
                    >
                      Ver
                    </Button>
                    <Button variant="secondary" onClick={() => startEdit(l)}>
                      Editar
                    </Button>
                    <Button
                      variant="primary"
                      disabled={busyId === l.id}
                      onClick={() => void publish(l)}
                    >
                      {busyId === l.id ? "…" : "Publicar"}
                    </Button>
                    {!l.isPrimary && (
                      <Button
                        variant="ghost"
                        disabled={busyId === l.id}
                        onClick={() => void makePrimary(l)}
                      >
                        Marcar primaria
                      </Button>
                    )}
                    <Button
                      variant="danger"
                      disabled={busyId === l.id}
                      onClick={() => void remove(l)}
                    >
                      Borrar
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Editor */}
        <Card className="h-fit">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-200">
              {editingId ? "Editar landing" : "Nueva landing"}
            </h2>
            {editingId && (
              <Button variant="ghost" onClick={startCreate}>
                Nueva
              </Button>
            )}
          </div>
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Nombre</label>
              <Input
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
                placeholder="Promo verano"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Título (title)</label>
              <Input
                value={form.title}
                onChange={(e) => setField("title", e.target.value)}
                placeholder="Título de la pestaña"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Encabezado (headline)</label>
              <Input
                value={form.headline}
                onChange={(e) => setField("headline", e.target.value)}
                placeholder="¡Aprovechá la promo!"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Subtítulo (subtitle)</label>
              <Input
                value={form.subtitle}
                onChange={(e) => setField("subtitle", e.target.value)}
                placeholder="Escribinos y te asesoramos"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Texto del botón (buttonText)</label>
              <Input
                value={form.buttonText}
                onChange={(e) => setField("buttonText", e.target.value)}
                placeholder="Escribir por WhatsApp"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Mensaje de WhatsApp (msg)</label>
              <Input
                value={form.msg}
                onChange={(e) => setField("msg", e.target.value)}
                placeholder="Hola, quiero info"
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? "Guardando…" : editingId ? "Guardar cambios" : "Crear landing"}
              </Button>
              {editingId && (
                <Button type="button" variant="ghost" onClick={startCreate}>
                  Cancelar
                </Button>
              )}
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
