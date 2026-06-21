import { useEffect, useState, type FormEvent } from "react";
import { api, apiError } from "../lib/api";
import { fmtDate } from "../lib/format";
import { Button, Input, Card, ErrorMsg } from "../components/ui";
import type { Pixel } from "../lib/types";

type EventType = "Lead" | "Purchase";

interface FormState {
  id: string | null;
  pixelId: string;
  capiToken: string;
  eventType: EventType;
  siteUrl: string;
}

const EMPTY: FormState = { id: null, pixelId: "", capiToken: "", eventType: "Lead", siteUrl: "" };

export default function PixelPage() {
  const [pixels, setPixels] = useState<Pixel[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editing = form.id !== null;

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<{ pixels: Pixel[] }>("/api/pixels");
      setPixels(data.pixels);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const startEdit = (p: Pixel) => {
    setForm({ id: p.id, pixelId: p.pixelId, capiToken: "", eventType: p.eventType, siteUrl: p.siteUrl ?? "" });
    setError(null);
  };

  const reset = () => setForm(EMPTY);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        const body: Record<string, unknown> = {
          pixelId: form.pixelId,
          eventType: form.eventType,
          siteUrl: form.siteUrl,
        };
        if (form.capiToken.trim()) body.capiToken = form.capiToken.trim();
        await api.put(`/api/pixels/${form.id}`, body);
      } else {
        await api.post("/api/pixels", {
          pixelId: form.pixelId,
          capiToken: form.capiToken,
          eventType: form.eventType,
          siteUrl: form.siteUrl,
        });
      }
      reset();
      await load();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p: Pixel) => {
    if (!confirm(`¿Borrar el pixel ${p.pixelId}?`)) return;
    setError(null);
    try {
      await api.delete(`/api/pixels/${p.id}`);
      if (form.id === p.id) reset();
      await load();
    } catch (err) {
      setError(apiError(err));
    }
  };

  return (
    <div className="p-6">
      <h1 className="mb-1 text-xl font-bold">Mi Pixel</h1>
      <p className="mb-5 text-sm text-slate-400">
        Cargá tu Pixel de Meta y tu token de Conversions API. El loop de atribución usa estos
        datos para enviar los eventos <span className="text-slate-200">Lead</span> y{" "}
        <span className="text-slate-200">Purchase</span> a <em>tu</em> cuenta de Meta.
      </p>

      {error && (
        <div className="mb-4">
          <ErrorMsg>{error}</ErrorMsg>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Formulario */}
        <Card>
          <div className="mb-3 text-sm font-semibold">{editing ? "Editar pixel" : "Agregar pixel"}</div>
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Pixel ID (Dataset ID)</label>
              <Input
                value={form.pixelId}
                onChange={(e) => setForm({ ...form, pixelId: e.target.value })}
                placeholder="ej: 893375649719739"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">
                Token de Conversions API {editing && <span className="text-slate-500">(dejar vacío para no cambiar)</span>}
              </label>
              <Input
                value={form.capiToken}
                onChange={(e) => setForm({ ...form, capiToken: e.target.value })}
                placeholder={editing ? "••••" : "EAA..."}
                type="password"
                required={!editing}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Evento</label>
              <select
                value={form.eventType}
                onChange={(e) => setForm({ ...form, eventType: e.target.value as EventType })}
                className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-wa-green"
              >
                <option value="Lead">Lead (y Purchase si no hay otro)</option>
                <option value="Purchase">Purchase</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">URL del sitio (opcional)</label>
              <Input
                value={form.siteUrl}
                onChange={(e) => setForm({ ...form, siteUrl: e.target.value })}
                placeholder="https://tudominio.com"
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? "Guardando…" : editing ? "Guardar cambios" : "Agregar pixel"}
              </Button>
              {editing && (
                <Button type="button" variant="ghost" onClick={reset}>
                  Cancelar
                </Button>
              )}
            </div>
          </form>

          <div className="mt-4 rounded-md border border-slate-700 bg-slate-900/50 p-3 text-xs text-slate-400">
            <div className="mb-1 font-semibold text-slate-300">¿De dónde saco estos datos?</div>
            <ul className="list-disc space-y-1 pl-4">
              <li><b>Pixel ID</b>: Meta → Administrador de eventos → tu conjunto de datos (arriba, el número).</li>
              <li><b>Token CAPI</b>: ese conjunto → Configuración → API de conversiones → <i>Generar token de acceso</i>.</li>
            </ul>
          </div>
        </Card>

        {/* Lista */}
        <div>
          <div className="mb-2 text-sm font-semibold text-slate-200">Tus pixels</div>
          {loading ? (
            <p className="text-slate-400">Cargando…</p>
          ) : pixels.length === 0 ? (
            <Card>
              <p className="text-sm text-slate-400">
                Todavía no cargaste ningún pixel. Mientras tanto, el sistema usa el pixel global por
                defecto. Cargá el tuyo para atribuir a tu cuenta de Meta.
              </p>
            </Card>
          ) : (
            <div className="space-y-2">
              {pixels.map((p) => (
                <Card key={p.id}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-mono text-sm text-slate-100">{p.pixelId}</div>
                      <div className="mt-0.5 text-xs text-slate-400">
                        Evento: <span className="text-slate-200">{p.eventType}</span> · Token:{" "}
                        <span className="font-mono">{p.tokenMask}</span>
                      </div>
                      {p.siteUrl && <div className="truncate text-xs text-slate-500">{p.siteUrl}</div>}
                      <div className="mt-0.5 text-xs text-slate-600">{fmtDate(p.createdAt)}</div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button variant="secondary" onClick={() => startEdit(p)}>Editar</Button>
                      <Button variant="danger" onClick={() => void remove(p)}>Borrar</Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
