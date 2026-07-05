import { useEffect, useState } from "react";
import { MessageSquare, Clock, Reply, ListTree, ArrowUp, ArrowDown, Trash2, Plus, X } from "lucide-react";
import { api, apiError } from "../lib/api";
import { Button, Input, Card, ErrorMsg } from "../components/ui";

type StepType = "message" | "delay" | "wait_reply" | "menu";
interface Option { id: string; label: string; keywords?: string[]; steps: Step[] }
interface Step { id: string; type: StepType; text?: string; minutes?: number; options?: Option[] }
interface FlowStats { total: number; done: number; active: number }
interface Flow { id: string; name: string; enabled: boolean; trigger: "first_message" | "keyword"; keyword: string | null; steps: Step[]; stats?: FlowStats }

const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "s" + Math.random().toString(36).slice(2));
const newStep = (type: StepType): Step =>
  type === "message" ? { id: uid(), type, text: "" }
  : type === "delay" ? { id: uid(), type, minutes: 60 }
  : type === "menu" ? { id: uid(), type, text: "¿Qué te interesa?", options: [{ id: uid(), label: "Opción 1", steps: [] }, { id: uid(), label: "Opción 2", steps: [] }] }
  : { id: uid(), type };

const STEP_META: Record<StepType, { icon: typeof MessageSquare; label: string; color: string }> = {
  message: { icon: MessageSquare, label: "Enviar mensaje", color: "text-wa-green" },
  delay: { icon: Clock, label: "Esperar", color: "text-amber-300" },
  wait_reply: { icon: Reply, label: "Esperar respuesta", color: "text-sky-300" },
  menu: { icon: ListTree, label: "Menú con opciones (ramifica)", color: "text-violet-300" },
};

// ---------- Editor recursivo de pasos ----------
function StepsEditor({ steps, onChange, depth = 0 }: { steps: Step[]; onChange: (s: Step[]) => void; depth?: number }) {
  const set = (i: number, patch: Partial<Step>) => onChange(steps.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const move = (i: number, dir: -1 | 1) => { const j = i + dir; if (j < 0 || j >= steps.length) return; const arr = [...steps]; [arr[i], arr[j]] = [arr[j], arr[i]]; onChange(arr); };
  const del = (i: number) => onChange(steps.filter((_, k) => k !== i));
  const add = (type: StepType) => onChange([...steps, newStep(type)]);

  const setOption = (i: number, oi: number, patch: Partial<Option>) => {
    const step = steps[i];
    const options = (step.options ?? []).map((o, k) => (k === oi ? { ...o, ...patch } : o));
    set(i, { options });
  };
  const addOption = (i: number) => {
    const step = steps[i];
    const options = [...(step.options ?? []), { id: uid(), label: `Opción ${(step.options?.length ?? 0) + 1}`, steps: [] as Step[] }];
    set(i, { options });
  };
  const delOption = (i: number, oi: number) => set(i, { options: (steps[i].options ?? []).filter((_, k) => k !== oi) });

  return (
    <div className="space-y-2">
      {steps.map((s, i) => {
        const M = STEP_META[s.type];
        return (
          <div key={s.id} className={`rounded-lg border p-3 ${depth > 0 ? "border-slate-700/70 bg-slate-900/40" : "border-slate-800 bg-slate-900/50"}`}>
            <div className="mb-2 flex items-center justify-between">
              <span className={`flex items-center gap-2 text-sm font-medium ${M.color}`}><M.icon className="h-4 w-4" /> {i + 1}. {M.label}</span>
              <div className="flex items-center gap-1 text-slate-500">
                <button onClick={() => move(i, -1)} className="rounded p-1 hover:bg-slate-800 hover:text-white"><ArrowUp className="h-4 w-4" /></button>
                <button onClick={() => move(i, 1)} className="rounded p-1 hover:bg-slate-800 hover:text-white"><ArrowDown className="h-4 w-4" /></button>
                <button onClick={() => del(i)} className="rounded p-1 hover:bg-slate-800 hover:text-rose-400"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>

            {s.type === "message" && (
              <textarea value={s.text ?? ""} onChange={(e) => set(i, { text: e.target.value })} placeholder="Texto que se envía…"
                className="h-20 w-full resize-none rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-wa-green" />
            )}
            {s.type === "delay" && (
              <div className="flex items-center gap-2 text-sm text-slate-300">
                Esperar
                <Input type="number" min={1} value={String(s.minutes ?? 60)} onChange={(e) => set(i, { minutes: Number(e.target.value) })} className="w-24" />
                minutos antes del próximo paso.
              </div>
            )}
            {s.type === "wait_reply" && (
              <p className="text-xs text-slate-500">Se pausa hasta que el cliente responda; después sigue.</p>
            )}
            {s.type === "menu" && (
              <div className="space-y-2">
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Pregunta / encabezado del menú</label>
                  <Input value={s.text ?? ""} onChange={(e) => set(i, { text: e.target.value })} placeholder="¿Qué te interesa?" />
                </div>
                <p className="text-[11px] text-slate-500">Se envía como opciones numeradas (1️⃣ 2️⃣ 3️⃣). El cliente contesta con el número o una palabra y sigue esa rama.</p>
                {(s.options ?? []).map((o, oi) => (
                  <div key={o.id} className="rounded-md border border-violet-500/25 bg-violet-500/5 p-2.5">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-violet-300">{oi + 1}️⃣</span>
                      <Input value={o.label} onChange={(e) => setOption(i, oi, { label: e.target.value })} placeholder="Texto de la opción" className="!w-52" />
                      <Input value={(o.keywords ?? []).join(", ")} onChange={(e) => setOption(i, oi, { keywords: e.target.value.split(",").map((k) => k.trim()).filter(Boolean) })}
                        placeholder="palabras clave (opcional, coma)" className="flex-1 min-w-[160px]" />
                      <button onClick={() => delOption(i, oi)} className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-rose-400"><X className="h-4 w-4" /></button>
                    </div>
                    <div className="ml-2 border-l-2 border-violet-500/30 pl-3">
                      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-violet-300/80">Si elige esta opción →</div>
                      <StepsEditor steps={o.steps} onChange={(sub) => setOption(i, oi, { steps: sub })} depth={depth + 1} />
                    </div>
                  </div>
                ))}
                {(s.options ?? []).length < 9 && (
                  <Button variant="ghost" onClick={() => addOption(i)}><Plus className="h-4 w-4" /> Agregar opción</Button>
                )}
              </div>
            )}
          </div>
        );
      })}

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => add("message")}><MessageSquare className="h-4 w-4" /> Mensaje</Button>
        <Button variant="secondary" onClick={() => add("delay")}><Clock className="h-4 w-4" /> Espera</Button>
        <Button variant="secondary" onClick={() => add("wait_reply")}><Reply className="h-4 w-4" /> Esperar respuesta</Button>
        {depth < 3 && <Button variant="secondary" onClick={() => add("menu")}><ListTree className="h-4 w-4" /> Menú</Button>}
      </div>
    </div>
  );
}

// ---------- Página ----------
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

  return (
    <div className="p-6">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-xl font-bold">Automatizaciones</h1>
        {!draft && <Button onClick={startNew}><Plus className="h-4 w-4" /> Nueva secuencia</Button>}
      </div>
      <p className="mb-4 text-sm text-slate-400">Secuencias automáticas para WhatsApp con menús que ramifican (estilo ManyChat): saludá, calificá y derivá solo.</p>
      {error && <div className="mb-3"><ErrorMsg>{error}</ErrorMsg></div>}

      {draft ? (
        <Card className="max-w-3xl">
          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Nombre</label>
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Bienvenida + menú" />
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
          <StepsEditor steps={draft.steps} onChange={(s) => setDraft({ ...draft, steps: s })} />

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
        <Card><p className="text-slate-300">Todavía no tenés automatizaciones. Creá tu primera secuencia con menú de bienvenida.</p></Card>
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
                    {f.stats && <> · <span className="text-slate-300">{f.stats.total}</span> contactos entraron · <span className="text-amber-300">{f.stats.active}</span> en curso · <span className="text-wa-green">{f.stats.done}</span> completaron</>}
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
