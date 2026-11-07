import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { api, apiError } from "../lib/api";
import { Button, Card, ErrorMsg } from "../components/ui";

// SEGUIMIENTO AUTOMÁTICO: el sistema recontacta solo a los leads que se enfriaron y le escribe de a
// poco a las listas que importás. El envío lo hace el servidor (cada 5 min, con tope diario y horario);
// esta página solo configura y muestra qué pasó. Gateada por email como Envíos masivos.
type Variant = { kind: "text"; body: string } | { kind: "audio"; clipId: string };
interface Paso { afterDays: number; variants: Variant[] }
interface ClipOpt { id: string; title: string }
interface LineOpt { id: string; label: string | null; phone: string }
interface Config {
  enabled: boolean; steps: Paso[]; listVariants: Variant[]; dailyCap: number; hourFrom: number; hourTo: number;
  tz: string; minGapMin: number; maxAgeDays: number; lineId: string | null; lastError: string | null;
}
interface Stats { enviadosHoy: number; friosEsperando: number; friosListos: number; listaPendiente: number }
interface Envio { id: string; kind: string; step: number; ok: boolean; createdAt: string; name: string | null; phone: string | null; stage: string | null; respondio: boolean }

// Sugerencia para arrancar (se puede editar todo). Tono neutro, sin presión.
const PASOS_SUGERIDOS: Paso[] = [
  { afterDays: 1, variants: [{ kind: "text", body: "Hola {{nombre}}! ¿Pudiste ver lo que te pasé? Cualquier duda te ayudo 🙌" }] },
  { afterDays: 2, variants: [{ kind: "text", body: "{{nombre}}, ¿seguís interesado? Si querés te explico en 2 minutos cómo funciona." }] },
  { afterDays: 4, variants: [{ kind: "text", body: "Hola! Te escribo por última vez para no molestarte. Si en algún momento lo necesitás, acá estoy 👋" }] },
];
const LISTA_SUGERIDA: Variant[] = [{ kind: "text", body: "Hola {{nombre}}! Te escribo de parte de Publi.lat, ¿te puedo contar algo rápido?" }];

const inputCls = "w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-wa-green";

export default function SeguimientoPage() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [envios, setEnvios] = useState<Envio[]>([]);
  const [clips, setClips] = useState<ClipOpt[]>([]);
  const [lines, setLines] = useState<LineOpt[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [lista, setLista] = useState("");
  const [importando, setImportando] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = async () => {
    try {
      const { data } = await api.get<{ config: Config; stats: Stats; ultimos: Envio[] }>("/api/seguimiento");
      const c = data.config;
      setCfg({ ...c, steps: c.steps?.length ? c.steps : PASOS_SUGERIDOS, listVariants: c.listVariants?.length ? c.listVariants : LISTA_SUGERIDA });
      setStats(data.stats);
      setEnvios(data.ultimos);
    } catch (e) { setError(apiError(e)); }
  };
  useEffect(() => {
    void load();
    api.get<{ items: ClipOpt[] }>("/api/inbox/audio-clips").then(({ data }) => setClips(data.items ?? [])).catch(() => undefined);
    api.get<{ lines: LineOpt[] }>("/api/wa/lines").then(({ data }) => setLines(data.lines ?? [])).catch(() => undefined);
    const t = setInterval(() => void load(), 60_000); // el servidor manda solo: refrescamos lo que pasó
    return () => clearInterval(t);
  }, []);

  const patch = (p: Partial<Config>) => setCfg((c) => (c ? { ...c, ...p } : c));
  const limpias = (vs: Variant[]) => vs.filter((v) => (v.kind === "text" ? v.body.trim() : v.clipId));

  const guardar = async (extra: Partial<Config> = {}) => {
    if (!cfg) return;
    const c = { ...cfg, ...extra };
    setSaving(true); setError(null); setOk(null);
    try {
      await api.put("/api/seguimiento", {
        enabled: c.enabled,
        steps: c.steps.map((p) => ({ afterDays: Number(p.afterDays) || 1, variants: limpias(p.variants) })).filter((p) => p.variants.length),
        listVariants: limpias(c.listVariants),
        dailyCap: c.dailyCap, hourFrom: c.hourFrom, hourTo: c.hourTo, minGapMin: c.minGapMin, maxAgeDays: c.maxAgeDays,
        lineId: c.lineId || null,
      });
      setOk(extra.enabled === true ? "Seguimiento prendido ✔ — el primer envío sale en los próximos minutos (si estás en horario)." : extra.enabled === false ? "Seguimiento apagado." : "Guardado ✔");
      await load();
    } catch (e) { setError(apiError(e)); }
    finally { setSaving(false); }
  };

  const importar = async () => {
    if (!lista.trim()) return;
    setImportando(true); setError(null); setOk(null);
    try {
      const { data } = await api.post<{ creados: number; repetidos: number; invalidas: number }>("/api/seguimiento/importar", { texto: lista });
      setOk(`Lista cargada: ${data.creados} nuevos${data.repetidos ? ` · ${data.repetidos} ya estaban en tu CRM (no se les escribe)` : ""}${data.invalidas ? ` · ${data.invalidas} líneas sin número válido` : ""}.`);
      setLista("");
      await load();
    } catch (e) { setError(apiError(e)); }
    finally { setImportando(false); }
  };
  const onArchivo = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) setLista(await f.text());
  };

  if (!cfg || !stats) return <div className="p-6">{error ? <ErrorMsg>{error}</ErrorMsg> : <span className="text-slate-400">Cargando…</span>}</div>;

  const editorVariantes = (vs: Variant[], set: (v: Variant[]) => void) => (
    <div className="space-y-2">
      {vs.map((v, i) => (
        <div key={i} className="flex gap-2">
          {v.kind === "text" ? (
            <textarea rows={2} value={v.body} onChange={(e) => set(vs.map((x, j) => (j === i ? { kind: "text", body: e.target.value } : x)))} className={inputCls} />
          ) : (
            <select value={v.clipId} onChange={(e) => set(vs.map((x, j) => (j === i ? { kind: "audio", clipId: e.target.value } : x)))} className={inputCls}>
              <option value="">— elegí un audio —</option>
              {clips.map((c) => <option key={c.id} value={c.id}>🎤 {c.title}</option>)}
            </select>
          )}
          <button type="button" onClick={() => set(vs.filter((_, j) => j !== i))} className="shrink-0 text-xs text-rose-400 hover:text-rose-300">Quitar</button>
        </div>
      ))}
      <div className="flex gap-3 text-xs">
        <button type="button" onClick={() => set([...vs, { kind: "text", body: "" }])} className="text-wa-green hover:underline">+ otra versión del texto</button>
        {clips.length > 0 && <button type="button" onClick={() => set([...vs, { kind: "audio", clipId: clips[0].id }])} className="text-wa-green hover:underline">+ audio</button>}
      </div>
    </div>
  );

  let acumulado = 0;
  return (
    <div className="max-w-5xl p-6">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Seguimiento automático</h1>
        {cfg.enabled ? (
          <Button variant="secondary" disabled={saving} onClick={() => { patch({ enabled: false }); void guardar({ enabled: false }); }}>⏸ Apagar</Button>
        ) : (
          <Button disabled={saving} onClick={() => { patch({ enabled: true }); void guardar({ enabled: true }); }}>▶ Prender seguimiento</Button>
        )}
      </div>
      <p className="mb-4 text-sm text-slate-400">
        Le vuelve a escribir solo a los que te escribieron y no contestaron más, y le escribe de a poco a las listas que cargues.
        Si responden, los ves en el Inbox como siempre y el sistema deja de escribirles.
      </p>

      <div className={`mb-4 rounded-lg border px-4 py-3 text-sm ${cfg.enabled ? "border-emerald-700 bg-emerald-900/30 text-emerald-100" : "border-slate-700 bg-slate-900/60 text-slate-300"}`}>
        {cfg.enabled ? <><span className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-wa-green align-middle" /> <b>Prendido.</b></> : <b>Apagado.</b>}{" "}
        Hoy: <b>{stats.enviadosHoy}</b>/{cfg.dailyCap} enviados · <b>{stats.friosListos}</b> leads fríos listos para recontactar ({stats.friosEsperando} en seguimiento) · <b>{stats.listaPendiente}</b> de la lista sin contactar.
        {cfg.lastError && <div className="mt-1 text-xs text-rose-300">⚠️ {cfg.lastError}</div>}
      </div>

      {error && <div className="mb-4"><ErrorMsg>{error}</ErrorMsg></div>}
      {ok && <div className="mb-4 rounded-md border border-emerald-800 bg-emerald-900/40 px-3 py-2 text-sm text-emerald-200">{ok}</div>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-1 text-sm font-semibold text-slate-100">1 · Leads que se enfriaron</div>
          <p className="mb-3 text-xs text-slate-500">Te escribieron, vos (o el bot) mandaste el último mensaje y no contestaron. Los días se cuentan desde el mensaje anterior. Si hay varias versiones se elige una al azar.</p>
          <div className="space-y-3">
            {cfg.steps.map((p, i) => {
              acumulado += Number(p.afterDays) || 0;
              return (
                <div key={i} className="rounded-md border border-slate-700 bg-slate-800/40 p-2.5">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-300">
                    <b>Mensaje {i + 1}</b> · a los
                    <input type="number" min={0.5} step={0.5} value={p.afterDays} onChange={(e) => patch({ steps: cfg.steps.map((x, j) => (j === i ? { ...x, afterDays: Number(e.target.value) } : x)) })}
                      className="w-16 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-slate-100" />
                    días <span className="text-slate-500">(día {acumulado} sin respuesta)</span>
                    <button type="button" onClick={() => patch({ steps: cfg.steps.filter((_, j) => j !== i) })} className="ml-auto text-rose-400 hover:text-rose-300">Quitar paso</button>
                  </div>
                  {editorVariantes(p.variants, (vs) => patch({ steps: cfg.steps.map((x, j) => (j === i ? { ...x, variants: vs } : x)) }))}
                </div>
              );
            })}
            {cfg.steps.length < 6 && (
              <Button type="button" variant="secondary" onClick={() => patch({ steps: [...cfg.steps, { afterDays: 3, variants: [{ kind: "text", body: "" }] }] })}>+ Agregar paso</Button>
            )}
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <div className="mb-1 text-sm font-semibold text-slate-100">2 · Cargar una lista</div>
            <p className="mb-2 text-xs text-slate-500">Un contacto por línea: <span className="font-mono">Nombre, 595981234567</span> o solo el número con código de país. También podés subir un CSV. Los que ya están en tu CRM se saltean.</p>
            <textarea rows={5} value={lista} onChange={(e) => setLista(e.target.value)} placeholder={"Ana Pérez, 595981234567\nJuan, 5491122334455"} className={inputCls} />
            <div className="mt-2 flex flex-wrap gap-2">
              <input ref={fileRef} type="file" accept=".csv,.txt,text/csv,text/plain" className="hidden" onChange={(e) => void onArchivo(e)} />
              <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()}>📄 Subir CSV</Button>
              <Button type="button" disabled={importando || !lista.trim()} onClick={() => void importar()}>{importando ? "Cargando…" : "Cargar al CRM"}</Button>
            </div>
            <div className="mt-3 text-xs font-semibold text-slate-300">Primer mensaje a la lista</div>
            <div className="mt-1">{editorVariantes(cfg.listVariants, (vs) => patch({ listVariants: vs }))}</div>
            <p className="mt-2 text-[11px] text-slate-500">Si no contestan, después siguen con los pasos del punto 1.</p>
          </Card>

          <Card>
            <div className="mb-2 text-sm font-semibold text-slate-100">3 · Cuidar la línea</div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <label className="text-slate-400">Máximo por día
                <input type="number" min={1} max={300} value={cfg.dailyCap} onChange={(e) => patch({ dailyCap: Number(e.target.value) })} className={inputCls} />
              </label>
              <label className="text-slate-400">Minutos entre envíos (mín.)
                <input type="number" min={2} value={cfg.minGapMin} onChange={(e) => patch({ minGapMin: Number(e.target.value) })} className={inputCls} />
              </label>
              <label className="text-slate-400">Desde las (hora)
                <input type="number" min={0} max={23} value={cfg.hourFrom} onChange={(e) => patch({ hourFrom: Number(e.target.value) })} className={inputCls} />
              </label>
              <label className="text-slate-400">Hasta las (hora)
                <input type="number" min={1} max={24} value={cfg.hourTo} onChange={(e) => patch({ hourTo: Number(e.target.value) })} className={inputCls} />
              </label>
              <label className="col-span-2 text-slate-400">No despertar charlas de hace más de (días)
                <input type="number" min={1} max={365} value={cfg.maxAgeDays} onChange={(e) => patch({ maxAgeDays: Number(e.target.value) })} className={inputCls} />
              </label>
              <label className="col-span-2 text-slate-400">Enviar desde
                <select value={cfg.lineId ?? ""} onChange={(e) => patch({ lineId: e.target.value || null })} className={inputCls}>
                  <option value="">La línea de cada contacto (o la activa)</option>
                  {lines.map((l) => <option key={l.id} value={l.id}>{l.label || l.phone}</option>)}
                </select>
              </label>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">Hora de Paraguay/Argentina. Escribirle a quien no te escribió primero es lo que más rápido corta una línea: subí el máximo de a poco.</p>
          </Card>
        </div>
      </div>

      <div className="mt-4"><Button disabled={saving} onClick={() => void guardar()}>{saving ? "Guardando…" : "Guardar cambios"}</Button></div>

      <Card className="mt-6">
        <div className="mb-2 text-sm font-semibold text-slate-100">Últimos envíos</div>
        {envios.length === 0 ? (
          <p className="text-sm text-slate-500">Todavía no salió ninguno.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs text-slate-400">
                <tr><th className="py-1 pr-3">Cuándo</th><th className="py-1 pr-3">Contacto</th><th className="py-1 pr-3">Qué</th><th className="py-1 pr-3">Estado</th></tr>
              </thead>
              <tbody>
                {envios.map((e) => (
                  <tr key={e.id} className="border-t border-slate-800">
                    <td className="py-1.5 pr-3 text-slate-400">{new Date(e.createdAt).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="py-1.5 pr-3 text-slate-200">{e.name || e.phone || "—"}</td>
                    <td className="py-1.5 pr-3 text-slate-300">{e.kind === "lista" ? "Primer mensaje (lista)" : `Seguimiento ${e.step + 1}`}</td>
                    <td className="py-1.5 pr-3">
                      {!e.ok ? <span className="text-rose-300">No salió</span> : e.respondio ? <span className="font-semibold text-wa-green">Respondió 🎉</span> : <span className="text-slate-400">Enviado</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
