import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { api, apiError } from "../lib/api";
import { Button, Card, ErrorMsg } from "../components/ui";

// ENVÍOS MASIVOS: le escribe a una base ya cargada (leads de formularios de Meta, contactos del CRM)
// rotando textos/audios y espaciando cada mensaje. Incluye el tablero tipo "clientes potenciales" de
// Meta. La sección está gateada por email en el backend (durante la prueba, solo el dueño).
type Variant = { kind: "text"; body: string } | { kind: "audio"; clipId: string };
interface ClipOpt { id: string; title: string }
interface LineOpt { id: string; label: string | null; phone: string }
interface Campaign {
  variants: Variant[]; pauseMinS: number; pauseMaxS: number; lineId: string | null;
  audSource: string | null; audStage: string; audMaxDays: number | null; audLimit: number;
  status: string; sent: number; failed: number; lastRunAt: string | null; lastError: string | null;
}
interface Audience { total: number; sample: Array<{ id: string; name: string | null; phone: string | null }> }
interface Lead { id: string; name: string | null; phone: string | null; stage: string; createdAt: string; answers: Array<{ q: string; a: string }> }

// Mismo tablero que el "Centro de clientes potenciales" de Meta, sobre los stages que ya usa el CRM.
const COLUMNS: Array<{ stage: string; title: string; color: string }> = [
  { stage: "NUEVO", title: "Registrado", color: "text-slate-300" },
  { stage: "CONTACTADO", title: "Contactado", color: "text-sky-300" },
  { stage: "INTERESADO", title: "Cumple requisitos", color: "text-amber-300" },
  { stage: "COMPRO", title: "Convertido", color: "text-wa-green" },
];

export default function BulkPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [camp, setCamp] = useState<Campaign | null>(null);
  const [aud, setAud] = useState<Audience>({ total: 0, sample: [] });
  const [leads, setLeads] = useState<Lead[]>([]);
  const [clips, setClips] = useState<ClipOpt[]>([]);
  const [lines, setLines] = useState<LineOpt[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = async () => {
    try {
      const { data } = await api.get<{ campaign: Campaign; audience: Audience }>("/api/bulk");
      setCamp(data.campaign);
      setAud(data.audience);
    } catch (e) { setError(apiError(e)); }
    finally { setLoading(false); }
  };
  const loadBoard = async () => {
    try { const { data } = await api.get<{ leads: Lead[] }>("/api/bulk/board"); setLeads(data.leads ?? []); }
    catch { /* el tablero es secundario: si falla, la página sigue usable */ }
  };

  useEffect(() => {
    void load(); void loadBoard();
    api.get<{ items: ClipOpt[] }>("/api/inbox/audio-clips").then(({ data }) => setClips(data.items ?? [])).catch(() => undefined);
    api.get<{ lines: LineOpt[] }>("/api/wa/lines").then(({ data }) => setLines(data.lines ?? [])).catch(() => undefined);
  }, []);

  // Mientras hay una corrida, refrescamos progreso y tablero cada 15 s.
  useEffect(() => {
    if (camp?.status !== "running") return;
    const t = setInterval(() => { void load(); void loadBoard(); }, 15000);
    return () => clearInterval(t);
  }, [camp?.status]);

  const patch = (p: Partial<Campaign>) => setCamp((c) => (c ? { ...c, ...p } : c));

  const save = async () => {
    if (!camp) return;
    setSaving(true); setError(null); setOk(null);
    try {
      const { data } = await api.put<{ audience: Audience }>("/api/bulk", {
        variants: camp.variants.filter((v) => (v.kind === "text" ? v.body.trim() : v.clipId)),
        pauseMinS: camp.pauseMinS, pauseMaxS: camp.pauseMaxS, lineId: camp.lineId || null,
        audSource: camp.audSource || null, audStage: camp.audStage,
        audMaxDays: camp.audMaxDays || null, audLimit: camp.audLimit,
      });
      setAud(data.audience);
      setOk("Guardado ✔");
    } catch (e) { setError(apiError(e)); }
    finally { setSaving(false); }
  };

  const start = async () => {
    if (!camp) return;
    const cuantos = Math.min(camp.audLimit, aud.total);
    const mins = Math.round((cuantos * ((camp.pauseMinS + camp.pauseMaxS) / 2)) / 60);
    if (!window.confirm(`Vas a enviar a ${cuantos} contactos, uno cada ~${Math.round((camp.pauseMinS + camp.pauseMaxS) / 2 / 60)} min (≈${mins} min en total).\n\n¿Confirmás?`)) return;
    setError(null); setOk(null);
    try { await api.post("/api/bulk/start"); setOk("Envío iniciado 🚀"); await load(); }
    catch (e) { setError(apiError(e)); }
  };
  const stop = async () => {
    try { await api.post("/api/bulk/stop"); setOk("Envío detenido."); await load(); }
    catch (e) { setError(apiError(e)); }
  };

  // Subir audio sin salir de la página (queda en la biblioteca compartida con el Inbox).
  const onAudioPicked = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !camp) return;
    const title = window.prompt("Nombre del audio:", file.name.replace(/\.[^.]+$/, "").slice(0, 60))?.trim();
    if (!title) return;
    setUploading(true); setError(null);
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onloadend = () => resolve(String(fr.result));
        fr.onerror = () => reject(new Error("No se pudo leer el archivo"));
        fr.readAsDataURL(file);
      });
      const { data } = await api.post<{ item: ClipOpt }>("/api/inbox/audio-clips", { title, audio: dataUrl });
      const { data: list } = await api.get<{ items: ClipOpt[] }>("/api/inbox/audio-clips");
      setClips(list.items ?? []);
      patch({ variants: [...camp.variants, { kind: "audio", clipId: data.item.id }] });
      setOk("Audio subido y agregado. Acordate de Guardar 👇");
    } catch (err) { setError(apiError(err)); }
    finally { setUploading(false); }
  };

  if (loading) return <div className="p-6 text-slate-400">Cargando…</div>;
  if (!camp) return <div className="p-6"><ErrorMsg>{error ?? "No se pudo cargar"}</ErrorMsg></div>;

  const corriendo = camp.status === "running";
  const promedioMin = Math.round((camp.pauseMinS + camp.pauseMaxS) / 2 / 60);

  return (
    <div className="p-6">
      <h1 className="mb-1 text-xl font-bold">Envíos masivos</h1>
      <p className="mb-5 text-sm text-slate-400">
        Escribile a una base que ya tenés cargada, rotando mensajes y audios, con pausas entre cada envío
        para cuidar la línea.
      </p>

      {error && <div className="mb-4"><ErrorMsg>{error}</ErrorMsg></div>}
      {ok && <div className="mb-4 rounded-md border border-emerald-800 bg-emerald-900/40 px-3 py-2 text-sm text-emerald-200">{ok}</div>}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ---------------- Mensajes ---------------- */}
        <Card>
          <div className="mb-2 text-sm font-semibold text-slate-100">Mensajes (se manda uno al azar)</div>
          <div className="space-y-2">
            {camp.variants.map((v, i) => (
              <div key={i} className="rounded-md border border-slate-700 bg-slate-800/60 p-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-slate-400">{v.kind === "text" ? `📝 Texto ${i + 1}` : `🎤 Audio ${i + 1}`}</span>
                  <button type="button" onClick={() => patch({ variants: camp.variants.filter((_, j) => j !== i) })} className="text-xs text-rose-400 hover:text-rose-300">Quitar</button>
                </div>
                {v.kind === "text" ? (
                  <textarea
                    value={v.body} rows={2}
                    onChange={(e) => patch({ variants: camp.variants.map((x, j) => (j === i ? { kind: "text", body: e.target.value } : x)) })}
                    className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-wa-green"
                  />
                ) : (
                  <select
                    value={v.clipId}
                    onChange={(e) => patch({ variants: camp.variants.map((x, j) => (j === i ? { kind: "audio", clipId: e.target.value } : x)) })}
                    className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-wa-green"
                  >
                    <option value="">— elegí un audio —</option>
                    {clips.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                  </select>
                )}
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => patch({ variants: [...camp.variants, { kind: "text", body: "" }] })}>+ Texto</Button>
            <Button type="button" variant="secondary" disabled={!clips.length} onClick={() => patch({ variants: [...camp.variants, { kind: "audio", clipId: clips[0]?.id ?? "" }] })}>+ Audio guardado</Button>
            <input ref={fileRef} type="file" accept="audio/*" className="hidden" onChange={(e) => void onAudioPicked(e)} />
            <Button type="button" disabled={uploading} onClick={() => fileRef.current?.click()}>{uploading ? "Subiendo…" : "🎤 Subir audio"}</Button>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">Variables: <span className="font-mono">{"{{nombre}}"}</span>, <span className="font-mono">{"{{nombre_completo}}"}</span>, <span className="font-mono">{"{{respuesta}}"}</span>.</p>
        </Card>

        {/* ---------------- Ritmo + audiencia ---------------- */}
        <Card>
          <div className="mb-2 text-sm font-semibold text-slate-100">Ritmo y destinatarios</div>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs text-slate-400">Pausa mínima (seg)</label>
                <input type="number" min={5} value={camp.pauseMinS} onChange={(e) => patch({ pauseMinS: Number(e.target.value) })}
                  className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-wa-green" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">Pausa máxima (seg)</label>
                <input type="number" min={5} value={camp.pauseMaxS} onChange={(e) => patch({ pauseMaxS: Number(e.target.value) })}
                  className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-wa-green" />
              </div>
            </div>
            <p className="text-[11px] text-slate-500">Se espera un tiempo al azar entre ambas (≈{promedioMin} min por mensaje). Cuanto más lento, más seguro para la línea.</p>

            <div>
              <label className="mb-1 block text-xs text-slate-400">Enviar desde</label>
              <select value={camp.lineId ?? ""} onChange={(e) => patch({ lineId: e.target.value || null })}
                className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-wa-green">
                <option value="">La línea activa (automático)</option>
                {lines.map((l) => <option key={l.id} value={l.id}>{l.label || l.phone}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs text-slate-400">Base a la que enviar</label>
                <select value={camp.audSource ?? ""} onChange={(e) => patch({ audSource: e.target.value || null })}
                  className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-wa-green">
                  <option value="leadform">Leads de formularios de Meta</option>
                  <option value="">Todos mis contactos</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">Etapa</label>
                <select value={camp.audStage} onChange={(e) => patch({ audStage: e.target.value })}
                  className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-wa-green">
                  {COLUMNS.map((c) => <option key={c.stage} value={c.stage}>{c.title}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">Solo de los últimos (días)</label>
                <input type="number" min={1} placeholder="todos" value={camp.audMaxDays ?? ""} onChange={(e) => patch({ audMaxDays: e.target.value ? Number(e.target.value) : null })}
                  className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-wa-green" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">Máximo por corrida</label>
                <input type="number" min={1} value={camp.audLimit} onChange={(e) => patch({ audLimit: Number(e.target.value) })}
                  className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-wa-green" />
              </div>
            </div>

            <div className="rounded-md border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm">
              <b className="text-wa-green">{aud.total}</b> <span className="text-slate-400">contactos coinciden</span>
              {aud.total > 0 && <span className="text-slate-500"> · se enviará a {Math.min(camp.audLimit, aud.total)}</span>}
              {aud.sample.length > 0 && (
                <div className="mt-1 truncate text-[11px] text-slate-500">Ej: {aud.sample.slice(0, 3).map((s) => s.name || s.phone).join(" · ")}…</div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" disabled={saving} onClick={() => void save()}>{saving ? "Guardando…" : "Guardar"}</Button>
              {corriendo ? (
                <Button type="button" variant="secondary" onClick={() => void stop()}>⏸ Detener envío</Button>
              ) : (
                <Button type="button" disabled={!aud.total || !camp.variants.length} onClick={() => void start()}>🚀 Iniciar envío</Button>
              )}
            </div>
            {(camp.sent > 0 || camp.failed > 0 || corriendo) && (
              <p className="text-xs text-slate-400">
                {corriendo && <span className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-wa-green align-middle" />}
                Enviados: <b className="text-wa-green">{camp.sent}</b> · Fallidos: <b className="text-rose-300">{camp.failed}</b>
                {camp.status === "done" && " · terminado"}
              </p>
            )}
            {camp.lastError && <p className="text-xs text-rose-300">{camp.lastError}</p>}
          </div>
        </Card>
      </div>

      {/* ---------------- Tablero tipo Meta ---------------- */}
      <div className="mt-6">
        <div className="mb-2 text-sm font-semibold text-slate-100">Clientes potenciales</div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((col) => {
            const items = leads.filter((l) => l.stage === col.stage);
            return (
              <div key={col.stage} className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className={`text-sm font-semibold ${col.color}`}>{col.title}</span>
                  <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300">{items.length}</span>
                </div>
                <div className="max-h-[420px] space-y-2 overflow-y-auto">
                  {items.slice(0, 60).map((l) => {
                    const extra = l.answers.find((a) => !/name|nombre|phone|tel|email|correo/i.test(a.q))?.a;
                    return (
                      <div key={l.id} className="rounded-lg border border-slate-800 bg-slate-900/70 px-2.5 py-2">
                        <div className="truncate text-sm text-slate-100">{l.name || l.phone || "Sin nombre"}</div>
                        {extra && <div className="mt-0.5 truncate text-[11px] text-slate-500">{extra.replace(/_/g, " ")}</div>}
                      </div>
                    );
                  })}
                  {!items.length && <p className="py-4 text-center text-xs text-slate-600">Vacío</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
