import { useEffect, useState } from "react";
import { MessageSquare, Clock, Reply, ArrowUp, ArrowDown, Trash2, Plus } from "lucide-react";
import { api, apiError } from "../lib/api";
import { Button, Input, Card, ErrorMsg } from "../components/ui";

type StepType = "message" | "delay" | "wait_reply";
interface Step { id: string; type: StepType; text?: string; minutes?: number }
interface Flow { id: string; name: string; enabled: boolean; trigger: "first_message" | "keyword"; keyword: string | null; steps: Step[] }

const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "s" + Math.random().toString(36).slice(2));
const newStep = (type: StepType): Step => (type === "message" ? { id: uid(), type, text: "" } : type === "delay" ? { id: uid(), type, minutes: 60 } : { id: uid(), type });

const STEP_META: Record<StepType, { icon: typeof MessageSquare; label: string; color: string }> = {
  message: { icon: MessageSquare, label: "Enviar mensaje", color: "text-wa-green" },
  delay: { icon: Clock, label: "Esperar", color: "text-amber-300" },
  wait_reply: { icon: Reply, label: "Esperar respuesta del cliente", color: "text-sky-300" },
};

export default function AutomationsPage() {
  const [flows, setFlows] = useState<Flow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Flow | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true); setError(null);
    try { const { data } = await api.get<{ flows: Flow[] }>("/api/flows"); setFlows(data.flows); }
    catch (e) { setError(apiError(e)); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const startNew = () => setDraft({ id: "", name: "", enabled: false, trigger: "first_message", keyword: "", steps: [newStep("message")] });
  const edit = (f: Flow) => setDraft({ ...f, keyword: f.keyword ?? "", steps: f.steps ?? [] });

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) { setError("Ponele un nombre a la secuencia."); return; }
    if (draft.trigger === "keyword" && !draft.keyword?.trim()) { setError("Indicá la palabra clave que dispara la secuencia."); return; }
    setSaving(true); setError(null);
    const payload = { name: draft.name.trim(), enabled: draft.enabled, trigger: draft.trigger, keyword: draft.trigger === "keyword" ? draft.keyword : undefined, steps: draft.steps };
    try {
      if (draft.id) await api.put(`/api/flows/${draft.id}`, payload);
      else await api.post("/api/flows", payload);
      setDraft(null); await load();
    } catch (e) { setError(apiError(e)); } finally { setSaving(false); }
  };

  const toggle = async (f: Flow) => { try { await api.post(`/api/flows/${f.id}/toggle`); await load(); } catch (e) { setError(apiError(e)); } };
  const remove = async (f: Flow) => { if (!window.confirm(`¿Borrar la secuencia "${f.name}"?`)) return; try { await api.delete(`/api/flows/${f.id}`); await load(); } catch (e) { setError(apiError(e)); } };

  // --- edición de pasos del draft ---
  const setStep = (i: number, patch: Partial<Step>) => setDraft((d) => d ? { ...d, steps: d.steps.map((s, k) => (k === i ? { ...s, ...patch } : s)) } : d);
  const addStep = (type: StepType) => setDraft((d) => d ? { ...d, steps: [...d.steps, newStep(type)] } : d);
  const moveStep = (i: number, dir: -1 | 1) => setDraft((d) => { if (!d) return d; const s = [...d.steps]; const j = i + dir; if (j < 0 || j >= s.length) return d; [s[i], s[j]] = [s[j], s[i]]; return { ...d, steps: s }; });
  const delStep = (i: number) => setDraft((d) => d ? { ...d, steps: d.steps.filter((_, k) => k !== i) } : d);

  return (
    <div className="p-6">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-xl font-bold">Automatizaciones</h1>
        {!draft && <Button onClick={startNew}><Plus className="h-4 w-4" /> Nueva secuencia</Button>}
      </div>
      <p className="mb-4 text-sm text-slate-400">Secuencias automáticas para WhatsApp: saludá, seguí y calificá a tus contactos solo. Se disparan con el primer mensaje o una palabra clave.</p>
      {error && <div className="mb-3"><ErrorMsg>{error}</ErrorMsg></div>}

      {draft ? (
        <Card className="max-w-2xl">
          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Nombre</label>
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Bienvenida + seguimiento" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Se dispara cuando…</label>
              <div className="inline-flex rounded-md bg-slate-900 p-1 text-xs">
                <button onClick={() => setDraft({ ...draft, trigger: "first_message" })} className={`rounded px-3 py-1.5 font-medium ${draft.trigger === "first_message" ? "bg-wa-green text-slate-900" : "text-slate-300"}`}>Primer mensaje</button>
                <button onClick={() => setDraft({ ...draft, trigger: "keyword" })} className={`rounded px-3 py-1.5 font-medium ${draft.trigger === "keyword" ? "bg-wa-green text-slate-900" : "text-slate-300"}`}>Palabra clave</button>
              </div>
            </div>
          </div>
          {draft.trigger === "keyword" && (
            <div className="mb-4">
              <label className="mb-1 block text-xs text-slate-400">Palabra clave (si el mensaje la contiene, arranca)</label>
              <Input value={draft.keyword ?? ""} onChange={(e) => setDraft({ ...draft, keyword: e.target.value })} placeholder="ej: promo" className="max-w-xs" />
            </div>
          )}

          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Pasos</div>
          <div className="space-y-2">
            {draft.steps.map((s, i) => {
              const M = STEP_META[s.type];
              return (
                <div key={s.id} className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className={`flex items-center gap-2 text-sm font-medium ${M.color}`}><M.icon className="h-4 w-4" /> {i + 1}. {M.label}</span>
                    <div className="flex items-center gap-1 text-slate-500">
                      <button onClick={() => moveStep(i, -1)} className="rounded p-1 hover:bg-slate-800 hover:text-white"><ArrowUp className="h-4 w-4" /></button>
                      <button onClick={() => moveStep(i, 1)} className="rounded p-1 hover:bg-slate-800 hover:text-white"><ArrowDown className="h-4 w-4" /></button>
                      <button onClick={() => delStep(i)} className="rounded p-1 hover:bg-slate-800 hover:text-rose-400"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </div>
                  {s.type === "message" && (
                    <textarea value={s.text ?? ""} onChange={(e) => setStep(i, { text: e.target.value })} placeholder="Texto que se envía…"
                      className="h-20 w-full resize-none rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-wa-green" />
                  )}
                  {s.type === "delay" && (
                    <div className="flex items-center gap-2 text-sm text-slate-300">
                      Esperar
                      <Input type="number" min={1} value={String(s.minutes ?? 60)} onChange={(e) => setStep(i, { minutes: Number(e.target.value) })} className="w-24" />
                      minutos antes del próximo paso.
                    </div>
                  )}
                  {s.type === "wait_reply" && (
                    <p className="text-xs text-slate-500">La secuencia se pausa hasta que el cliente responda; ahí sigue con el próximo paso.</p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => addStep("message")}><MessageSquare className="h-4 w-4" /> Mensaje</Button>
            <Button variant="secondary" onClick={() => addStep("delay")}><Clock className="h-4 w-4" /> Espera</Button>
            <Button variant="secondary" onClick={() => addStep("wait_reply")}><Reply className="h-4 w-4" /> Esperar respuesta</Button>
          </div>

          <div className="mt-5 flex items-center gap-2 border-t border-slate-800 pt-4">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} className="h-4 w-4 accent-wa-green" /> Activa
            </label>
            <div className="ml-auto flex gap-2">
              <Button variant="ghost" onClick={() => setDraft(null)}>Cancelar</Button>
              <Button onClick={() => void save()} disabled={saving}>{saving ? "Guardando…" : "Guardar"}</Button>
            </div>
          </div>
        </Card>
      ) : loading ? (
        <p className="text-slate-400">Cargando…</p>
      ) : flows.length === 0 ? (
        <Card><p className="text-slate-300">Todavía no tenés automatizaciones. Creá tu primera secuencia de bienvenida.</p></Card>
      ) : (
        <div className="space-y-3">
          {flows.map((f) => (
            <Card key={f.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-100">{f.name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${f.enabled ? "bg-wa-green/15 text-wa-green" : "bg-slate-600/40 text-slate-300"}`}>{f.enabled ? "activa" : "pausada"}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    Dispara: {f.trigger === "keyword" ? `palabra "${f.keyword}"` : "primer mensaje"} · {(f.steps ?? []).length} paso{(f.steps ?? []).length === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => void toggle(f)}>{f.enabled ? "Pausar" : "Activar"}</Button>
                  <Button variant="secondary" onClick={() => edit(f)}>Editar</Button>
                  <Button variant="danger" onClick={() => void remove(f)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
