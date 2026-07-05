import { useEffect, useState } from "react";
import { MessageSquare, Clock, Reply, ListTree, Link2, KanbanSquare, ArrowUp, ArrowDown, Trash2, Plus, X, Workflow, List } from "lucide-react";
import { api, apiError } from "../lib/api";
import { Button, Input, Card, ErrorMsg } from "../components/ui";
import FlowCanvas from "../components/FlowCanvas";

type StepType = "message" | "delay" | "wait_reply" | "menu" | "link" | "set_stage";
interface Option { id: string; label: string; keywords?: string[]; steps: Step[] }
interface Step { id: string; type: StepType; text?: string; minutes?: number; options?: Option[]; url?: string; urlLabel?: string; stage?: string }
interface FlowStats { total: number; done: number; active: number }
interface LinkStat { stepId: string; sent: number; clicked: number }
interface Flow { id: string; name: string; enabled: boolean; trigger: "first_message" | "keyword"; keyword: string | null; steps: Step[]; stats?: FlowStats; linkStats?: LinkStat[] }

const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "s" + Math.random().toString(36).slice(2));
const newStep = (type: StepType): Step =>
  type === "message" ? { id: uid(), type, text: "" }
  : type === "delay" ? { id: uid(), type, minutes: 60 }
  : type === "menu" ? { id: uid(), type, text: "¿Qué te interesa?", options: [{ id: uid(), label: "Opción 1", steps: [] }, { id: uid(), label: "Opción 2", steps: [] }] }
  : type === "link" ? { id: uid(), type, text: "", urlLabel: "Abrir link", url: "" }
  : type === "set_stage" ? { id: uid(), type, stage: "INTERESADO" }
  : { id: uid(), type };

const STEP_META: Record<StepType, { icon: typeof MessageSquare; label: string; color: string }> = {
  message: { icon: MessageSquare, label: "Enviar mensaje", color: "text-wa-green" },
  delay: { icon: Clock, label: "Esperar", color: "text-amber-300" },
  wait_reply: { icon: Reply, label: "Esperar respuesta", color: "text-sky-300" },
  menu: { icon: ListTree, label: "Menú con opciones (ramifica)", color: "text-violet-300" },
  link: { icon: Link2, label: "Botón con link (medible)", color: "text-emerald-300" },
  set_stage: { icon: KanbanSquare, label: "Mover de etapa (CRM)", color: "text-rose-300" },
};

const STAGES = ["NUEVO", "CONTACTADO", "INTERESADO", "PERDIDO"];

// ---------- Helpers de árbol para el canvas (path tipo "2" | "2:1:0") ----------
function resolveList(steps: Step[], path: string): { list: Step[]; index: number } | null {
  const parts = path.split(":").map((n) => parseInt(n, 10));
  if (parts.some((n) => Number.isNaN(n) || n < 0)) return null;
  let list = steps;
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const opt = list[parts[i]]?.options?.[parts[i + 1]];
    if (!opt) return null;
    list = opt.steps ?? [];
  }
  return { list, index: parts[parts.length - 1] };
}
function getStepAt(steps: Step[], path: string): Step | null {
  const pos = resolveList(steps, path);
  return pos && pos.index < pos.list.length ? pos.list[pos.index] : null;
}
// Clona el árbol y aplica una mutación sobre la lista resuelta del path.
function mutateAt(steps: Step[], path: string, fn: (list: Step[], index: number) => void): Step[] {
  const clone: Step[] = JSON.parse(JSON.stringify(steps));
  const pos = resolveList(clone, path);
  if (pos) fn(pos.list, pos.index);
  return clone;
}
// Para ramas vacías: path de opción "2:1" -> devuelve option.steps del clon.
function mutateBranch(steps: Step[], optPath: string, fn: (branch: Step[]) => void): Step[] {
  const clone: Step[] = JSON.parse(JSON.stringify(steps));
  const parts = optPath.split(":").map((n) => parseInt(n, 10));
  let list = clone;
  for (let i = 0; i + 1 < parts.length - 1; i += 2) {
    const opt = list[parts[i]]?.options?.[parts[i + 1]];
    if (!opt) return clone;
    list = opt.steps ?? [];
  }
  const opt = list[parts[parts.length - 2]]?.options?.[parts[parts.length - 1]];
  if (opt) { opt.steps = opt.steps ?? []; fn(opt.steps); }
  return clone;
}
// ¿Hay pasos después de un menú? (no se ejecutan: cada rama termina el flujo)
function hasUnreachable(steps: Step[]): boolean {
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.type === "menu" && i < steps.length - 1) return true;
    if (s.type === "menu") for (const o of s.options ?? []) if (hasUnreachable(o.steps ?? [])) return true;
  }
  return false;
}

// ---------- Editor recursivo de pasos ----------
function StepsEditor({ steps, onChange, depth = 0, linkStats }: { steps: Step[]; onChange: (s: Step[]) => void; depth?: number; linkStats?: LinkStat[] }) {
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
        const ls = s.type === "link" ? linkStats?.find((l) => l.stepId === s.id) : undefined;
        return (
          <div key={s.id} className={`rounded-lg border p-3 ${depth > 0 ? "border-slate-700/70 bg-slate-900/40" : "border-slate-800 bg-slate-900/50"}`}>
            <div className="mb-2 flex items-center justify-between">
              <span className={`flex items-center gap-2 text-sm font-medium ${M.color}`}>
                <M.icon className="h-4 w-4" /> {i + 1}. {M.label}
                {ls && ls.sent > 0 && (
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                    {ls.clicked}/{ls.sent} clics · CTR {Math.round((ls.clicked / ls.sent) * 100)}%
                  </span>
                )}
              </span>
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
            {s.type === "link" && (
              <div className="space-y-2">
                <textarea value={s.text ?? ""} onChange={(e) => set(i, { text: e.target.value })} placeholder="Mensaje que acompaña al link (ej: Registrate acá 👇)"
                  className="h-16 w-full resize-none rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-wa-green" />
                <div className="flex flex-wrap gap-2">
                  <Input value={s.urlLabel ?? ""} onChange={(e) => set(i, { urlLabel: e.target.value })} placeholder='Texto del "botón" (ej: Crear cuenta)' className="!w-56" />
                  <Input value={s.url ?? ""} onChange={(e) => set(i, { url: e.target.value })} placeholder="https://tu-destino.com/..." className="flex-1 min-w-[220px]" />
                </div>
                <p className="text-[11px] text-slate-500">Se envía como link rastreado único por contacto: medís quién lo tocó y el CTR (como ManyChat).</p>
              </div>
            )}
            {s.type === "set_stage" && (
              <div className="flex items-center gap-2 text-sm text-slate-300">
                Mover el contacto a la etapa
                <select value={s.stage ?? "INTERESADO"} onChange={(e) => set(i, { stage: e.target.value })}
                  className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-wa-green">
                  {STAGES.map((st) => <option key={st} value={st}>{st}</option>)}
                </select>
                <span className="text-xs text-slate-500">(se refleja en Leads/Kanban)</span>
              </div>
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
                      <StepsEditor steps={o.steps} onChange={(sub) => setOption(i, oi, { steps: sub })} depth={depth + 1} linkStats={linkStats} />
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
        <Button variant="secondary" onClick={() => add("link")}><Link2 className="h-4 w-4" /> Botón con link</Button>
        <Button variant="secondary" onClick={() => add("delay")}><Clock className="h-4 w-4" /> Espera</Button>
        <Button variant="secondary" onClick={() => add("wait_reply")}><Reply className="h-4 w-4" /> Esperar respuesta</Button>
        <Button variant="secondary" onClick={() => add("set_stage")}><KanbanSquare className="h-4 w-4" /> Mover etapa</Button>
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
  const [view, setView] = useState<"canvas" | "list">("canvas");
  const [selected, setSelected] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try { const { data } = await api.get<{ flows: Flow[] }>("/api/flows"); setFlows(data.flows); }
    catch (e) { setError(apiError(e)); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const startNew = () => { setSelected(null); setDraft({ id: "", name: "", enabled: false, trigger: "first_message", keyword: "", steps: [newStep("message")] }); };
  const edit = (f: Flow) => { setSelected(null); setDraft({ ...f, keyword: f.keyword ?? "", steps: f.steps ?? [] }); };

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

          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pasos</span>
            <div className="inline-flex rounded-md bg-slate-900 p-1 text-xs">
              <button onClick={() => setView("canvas")} className={`flex items-center gap-1 rounded px-3 py-1 font-medium ${view === "canvas" ? "bg-wa-green text-slate-900" : "text-slate-300"}`}><Workflow className="h-3.5 w-3.5" /> Canvas</button>
              <button onClick={() => setView("list")} className={`flex items-center gap-1 rounded px-3 py-1 font-medium ${view === "list" ? "bg-wa-green text-slate-900" : "text-slate-300"}`}><List className="h-3.5 w-3.5" /> Lista</button>
            </div>
          </div>

          {hasUnreachable(draft.steps) && (
            <p className="mb-2 rounded-md border border-amber-800 bg-amber-900/30 px-3 py-2 text-xs text-amber-200">
              ⚠️ Tenés pasos DESPUÉS de un menú: no se ejecutan (cada rama del menú termina el flujo). Mové esos pasos adentro de las ramas.
            </p>
          )}

          {view === "list" ? (
            <StepsEditor steps={draft.steps} onChange={(s) => setDraft({ ...draft, steps: s })} linkStats={draft.linkStats} />
          ) : (
            <div className="grid gap-3 lg:grid-cols-[1fr_300px]">
              <FlowCanvas steps={draft.steps} linkStats={draft.linkStats} selected={selected} onSelect={setSelected} />
              <div className="max-h-[540px] overflow-y-auto rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                {!selected ? (
                  <div className="text-xs text-slate-400">
                    <p className="mb-2 font-semibold text-slate-300">Tocá un nodo para editarlo.</p>
                    <p className="mb-3">O agregá un paso al final del flujo:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {(["message", "link", "delay", "wait_reply", "set_stage", "menu"] as StepType[]).map((t) => (
                        <Button key={t} variant="secondary" onClick={() => { const s = [...draft.steps, newStep(t)]; setDraft({ ...draft, steps: s }); setSelected(String(s.length - 1)); }}>
                          + {STEP_META[t].label.split(" (")[0]}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : selected.startsWith("opt|") ? (
                  <div className="text-xs text-slate-400">
                    <p className="mb-2 font-semibold text-violet-300">Rama vacía — agregá el primer paso:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {(["message", "link", "delay", "wait_reply", "set_stage", "menu"] as StepType[]).map((t) => (
                        <Button key={t} variant="secondary" onClick={() => {
                          const optPath = selected.slice(4);
                          setDraft({ ...draft, steps: mutateBranch(draft.steps, optPath, (b) => b.push(newStep(t))) });
                          setSelected(`${optPath}:0`);
                        }}>
                          + {STEP_META[t].label.split(" (")[0]}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : (() => {
                  const step = getStepAt(draft.steps, selected);
                  if (!step) return <p className="text-xs text-slate-500">Nodo no encontrado (¿lo borraste?). Tocá otro.</p>;
                  const M = STEP_META[step.type];
                  const upd = (patch: Partial<Step>) => setDraft({ ...draft, steps: mutateAt(draft.steps, selected, (l, i) => { l[i] = { ...l[i], ...patch }; }) });
                  const updOpt = (oi: number, patch: Partial<Option>) => upd({ options: (step.options ?? []).map((o, k) => (k === oi ? { ...o, ...patch } : o)) });
                  return (
                    <div className="space-y-3 text-sm">
                      <div className={`flex items-center gap-2 font-semibold ${M.color}`}><M.icon className="h-4 w-4" /> {M.label}</div>

                      {step.type === "message" && (
                        <textarea value={step.text ?? ""} onChange={(e) => upd({ text: e.target.value })} placeholder="Texto que se envía…"
                          className="h-28 w-full resize-none rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-wa-green" />
                      )}
                      {step.type === "link" && (
                        <>
                          <textarea value={step.text ?? ""} onChange={(e) => upd({ text: e.target.value })} placeholder="Mensaje que acompaña al link…"
                            className="h-20 w-full resize-none rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-wa-green" />
                          <Input value={step.urlLabel ?? ""} onChange={(e) => upd({ urlLabel: e.target.value })} placeholder='Texto del "botón"' />
                          <Input value={step.url ?? ""} onChange={(e) => upd({ url: e.target.value })} placeholder="https://destino.com/..." />
                        </>
                      )}
                      {step.type === "delay" && (
                        <div className="flex items-center gap-2 text-slate-300">
                          Esperar <Input type="number" min={1} value={String(step.minutes ?? 60)} onChange={(e) => upd({ minutes: Number(e.target.value) })} className="w-24" /> min
                        </div>
                      )}
                      {step.type === "wait_reply" && <p className="text-xs text-slate-500">Se pausa hasta que el cliente responda.</p>}
                      {step.type === "set_stage" && (
                        <select value={step.stage ?? "INTERESADO"} onChange={(e) => upd({ stage: e.target.value })}
                          className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-wa-green">
                          {STAGES.map((st) => <option key={st} value={st}>{st}</option>)}
                        </select>
                      )}
                      {step.type === "menu" && (
                        <>
                          <Input value={step.text ?? ""} onChange={(e) => upd({ text: e.target.value })} placeholder="Pregunta del menú" />
                          {(step.options ?? []).map((o, oi) => (
                            <div key={o.id} className="rounded-md border border-violet-500/25 bg-violet-500/5 p-2">
                              <div className="mb-1 flex items-center gap-1.5">
                                <span className="text-xs font-bold text-violet-300">{oi + 1}️⃣</span>
                                <Input value={o.label} onChange={(e) => updOpt(oi, { label: e.target.value })} className="flex-1" />
                                <button onClick={() => upd({ options: (step.options ?? []).filter((_, k) => k !== oi) })} className="rounded p-1 text-slate-500 hover:text-rose-400"><X className="h-3.5 w-3.5" /></button>
                              </div>
                              <Input value={(o.keywords ?? []).join(", ")} onChange={(e) => updOpt(oi, { keywords: e.target.value.split(",").map((k) => k.trim()).filter(Boolean) })} placeholder="palabras clave (coma)" />
                            </div>
                          ))}
                          {(step.options ?? []).length < 9 && (
                            <Button variant="ghost" onClick={() => upd({ options: [...(step.options ?? []), { id: uid(), label: `Opción ${(step.options?.length ?? 0) + 1}`, steps: [] }] })}><Plus className="h-4 w-4" /> Opción</Button>
                          )}
                          <p className="text-[11px] text-slate-500">Las ramas se editan en el canvas (tocá la rama u opción vacía).</p>
                        </>
                      )}

                      <div className="border-t border-slate-800 pt-2">
                        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Agregar después</div>
                        <div className="flex flex-wrap gap-1.5">
                          {(["message", "link", "delay", "wait_reply", "set_stage", "menu"] as StepType[]).map((t) => (
                            <button key={t} onClick={() => {
                              setDraft({ ...draft, steps: mutateAt(draft.steps, selected, (l, i) => l.splice(i + 1, 0, newStep(t))) });
                              const parts = selected.split(":"); parts[parts.length - 1] = String(parseInt(parts[parts.length - 1], 10) + 1);
                              setSelected(parts.join(":"));
                            }} className="rounded bg-slate-800 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-700">
                              + {STEP_META[t].label.split(" (")[0]}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="flex gap-2 border-t border-slate-800 pt-2">
                        <Button variant="ghost" onClick={() => { setDraft({ ...draft, steps: mutateAt(draft.steps, selected, (l, i) => { if (i > 0) [l[i - 1], l[i]] = [l[i], l[i - 1]]; }) }); }}><ArrowUp className="h-4 w-4" /></Button>
                        <Button variant="ghost" onClick={() => { setDraft({ ...draft, steps: mutateAt(draft.steps, selected, (l, i) => { if (i < l.length - 1) [l[i], l[i + 1]] = [l[i + 1], l[i]]; }) }); }}><ArrowDown className="h-4 w-4" /></Button>
                        <Button variant="danger" onClick={() => { setDraft({ ...draft, steps: mutateAt(draft.steps, selected, (l, i) => l.splice(i, 1)) }); setSelected(null); }}><Trash2 className="h-4 w-4" /> Borrar</Button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

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
                    {(() => { const sent = (f.linkStats ?? []).reduce((a, l) => a + l.sent, 0); const clicked = (f.linkStats ?? []).reduce((a, l) => a + l.clicked, 0); return sent > 0 ? <> · 🔗 <span className="text-emerald-300">{clicked}/{sent} clics ({Math.round((clicked / sent) * 100)}%)</span></> : null; })()}
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
