import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Star, Plus, LayoutTemplate, Upload, ExternalLink, Trash2, Copy, Check, X } from "lucide-react";
import { api, apiError } from "../lib/api";
import { API_BASE } from "../lib/config";
import { useAuth } from "../lib/auth";
import { Button, Input, Card, ErrorMsg } from "../components/ui";

// ---- Plantillas (diseños ORIGINALES y NEUTROS, listos para editar). El CTA apunta al
// redirector /go con el slug del usuario para mantener la atribución. Sin número ni pixel reales.
type TplCat = "simple" | "full";
interface Tpl { name: string; desc: string; category: TplCat; html: string }

function templates(slug: string): Tpl[] {
  const go = (msg: string) => `${API_BASE}/go?u=${slug}&msg=${encodeURIComponent(msg)}`;
  const page = (title: string, css: string, body: string) =>
    `<!doctype html><html lang="es"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${title}</title><style>*{box-sizing:border-box}body{margin:0;font-family:system-ui,'Segoe UI',Roboto,Arial,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}a.btn:active{transform:scale(.99)}${css}</style></head><body>${body}</body></html>`;
  const base = (title: string, body: string) =>
    page(title, `body{background:#0b141a;color:#e9edef}.c{max-width:440px;width:100%;text-align:center;padding:44px 28px;background:#111b21;border:1px solid #222d34;border-radius:16px}h1{font-size:26px;margin:0 0 10px}p{color:#8696a0;margin:0 0 28px;line-height:1.55}a.btn{display:block;text-decoration:none;border-radius:999px;padding:16px;font-size:17px;font-weight:700;background:#25d366;color:#03301a}`, `<div class="c">${body}</div>`);

  return [
    { name: "Simple", category: "simple", desc: "Tarjeta limpia sobre fondo oscuro, botón verde de WhatsApp.",
      html: base("Contactanos", `<h1>Hablá con nosotros</h1><p>Te respondemos al toque por WhatsApp.</p><a class="btn" href="${go("Hola, quiero info")}">Escribir por WhatsApp</a>`) },
    { name: "Promo", category: "simple", desc: "Para una promo o descuento por tiempo limitado.",
      html: base("Promo", `<h1>🔥 Promo por tiempo limitado</h1><p>Escribinos y reservá tu descuento ahora.</p><a class="btn" href="${go("Hola, quiero la promo")}">Quiero la promo</a>`) },
    { name: "Servicios", category: "simple", desc: "Captación de consultas / asesoramiento.",
      html: base("Servicios", `<h1>¿Necesitás ayuda?</h1><p>Contanos qué buscás y te asesoramos sin cargo.</p><a class="btn" href="${go("Hola, necesito asesoramiento")}">Pedir asesoramiento</a>`) },

    { name: "Redirección WhatsApp", category: "full", desc: "Pantalla de carga animada que redirige directo a WhatsApp.",
      html: page("Conectando…", `body{background:#0b141a;color:#e9edef;text-align:center}.c{max-width:420px}.s{width:54px;height:54px;border:5px solid #1f2c33;border-top-color:#25d366;border-radius:50%;margin:0 auto 22px;animation:r 1s linear infinite}@keyframes r{to{transform:rotate(360deg)}}h1{font-size:22px;margin:0 0 6px}p{color:#8696a0;margin:0 0 22px}a.btn{display:inline-block;text-decoration:none;border-radius:999px;padding:13px 26px;font-weight:700;background:#25d366;color:#03301a}`,
        `<div class="c"><div class="s"></div><h1>Te estamos conectando</h1><p>Si no se abre solo, tocá el botón.</p><a class="btn" href="${go("Hola, vengo de la web")}">Abrir WhatsApp</a></div><script>setTimeout(function(){location.href=${JSON.stringify(go("Hola, vengo de la web"))}},1500)</script>`) },
    { name: "Bienvenida", category: "full", desc: "Alto impacto, dorado elegante. Beneficio de bienvenida.",
      html: page("Beneficio de bienvenida", `body{background:radial-gradient(circle at 50% 0%,#1a1407,#0a0a0a);color:#fff}.c{max-width:460px;width:100%;text-align:center;background:linear-gradient(180deg,#171206,#0d0b04);border:1px solid #b8860b55;border-radius:20px;padding:44px 26px;box-shadow:0 24px 60px -24px #000}.k{display:inline-block;padding:6px 14px;border:1px solid #d4af3766;border-radius:999px;color:#e9c766;font-size:12px;letter-spacing:1px;text-transform:uppercase}h1{font-size:30px;margin:16px 0 8px;line-height:1.2}.g{background:linear-gradient(90deg,#f5d271,#d4af37,#b8860b);-webkit-background-clip:text;background-clip:text;color:transparent}p{color:#c9bfa3;margin:0 0 26px;line-height:1.55}a.btn{display:block;text-decoration:none;border-radius:999px;padding:17px;font-size:18px;font-weight:800;color:#1a1407;background:linear-gradient(90deg,#f5d271,#d4af37);box-shadow:0 12px 34px -10px #d4af37aa}`,
        `<div class="c"><span class="k">Beneficio de bienvenida</span><h1>Llevate tu <span class="g">beneficio</span> de bienvenida</h1><p>Sumate hoy y accedé a tu beneficio. Te atendemos al instante por WhatsApp.</p><a class="btn" href="${go("Hola! Quiero mi beneficio de bienvenida 🎁")}">Quiero mi beneficio</a></div>`) },
    { name: "Sorteo", category: "full", desc: "Neón violeta/cyan para sorteos y participaciones.",
      html: page("Participá y ganá", `body{background:#0a0613;background-image:radial-gradient(circle at 80% 15%,#3b0d6b55,transparent),radial-gradient(circle at 10% 90%,#0d6b6155,transparent);color:#fff}.c{max-width:460px;width:100%;text-align:center;background:#120a22;border:1px solid #6d28d955;border-radius:20px;padding:40px 26px}.e{font-size:56px;line-height:1}h1{font-size:30px;margin:8px 0 8px}.n{color:#22d3ee;text-shadow:0 0 18px #22d3ee88}p{color:#b9a7d6;margin:0 0 26px;line-height:1.55}a.btn{display:block;text-decoration:none;border-radius:14px;padding:17px;font-size:18px;font-weight:800;color:#0a0613;background:linear-gradient(90deg,#22d3ee,#a855f7);box-shadow:0 0 32px -6px #a855f7aa}`,
        `<div class="c"><div class="e">🎁</div><h1>Participá y <span class="n">ganá</span></h1><p>Sumate al sorteo de este mes. Escribinos y participá en segundos.</p><a class="btn" href="${go("Hola! Quiero participar del sorteo 🎁")}">Participar</a></div>`) },
    { name: "Club VIP", category: "full", desc: "Verde premium con chips de beneficios.",
      html: page("Club VIP", `body{background:#07100c;background-image:radial-gradient(circle at 50% -10%,#0f3d2a,transparent);color:#fff}.c{max-width:460px;width:100%;text-align:center;background:#0b1712;border:1px solid #10b98155;border-radius:20px;padding:40px 26px}.k{color:#34d399;font-size:12px;letter-spacing:2px;text-transform:uppercase}h1{font-size:28px;margin:14px 0 14px}p{color:#9fb8ad;margin:0 0 26px;line-height:1.55}a.btn{display:block;text-decoration:none;border-radius:999px;padding:17px;font-size:18px;font-weight:800;color:#06281b;background:linear-gradient(90deg,#34d399,#10b981)}.row{display:flex;gap:8px;justify-content:center;margin-bottom:20px;flex-wrap:wrap}.chip{background:#0f211a;border:1px solid #10b98133;border-radius:10px;padding:8px 12px;color:#cdeee0;font-size:13px}`,
        `<div class="c"><div class="k">★ Clientes VIP</div><h1>Sumate al Club VIP</h1><div class="row"><span class="chip">Atención 24/7</span><span class="chip">Beneficios exclusivos</span><span class="chip">Respuesta rápida</span></div><p>Accedé a beneficios exclusivos y atención prioritaria. Te escribimos por WhatsApp.</p><a class="btn" href="${go("Hola! Quiero sumarme al Club VIP")}">Unirme al VIP</a></div>`) },
    { name: "Oferta Relámpago", category: "full", desc: "Rojo/naranja urgente para ofertas flash.",
      html: page("Oferta relámpago", `body{background:#120606;background-image:radial-gradient(circle at 50% 0%,#3a0a0a,transparent);color:#fff}.c{max-width:460px;width:100%;text-align:center;background:#1a0a0a;border:1px solid #ef444455;border-radius:20px;padding:44px 26px}.k{display:inline-block;background:#ef4444;color:#fff;font-weight:700;font-size:12px;padding:5px 12px;border-radius:999px;text-transform:uppercase;letter-spacing:1px}h1{font-size:30px;margin:16px 0 8px}p{color:#e7b3b3;margin:0 0 26px;line-height:1.55}a.btn{display:block;text-decoration:none;border-radius:12px;padding:17px;font-size:18px;font-weight:800;color:#fff;background:linear-gradient(90deg,#ef4444,#f97316);box-shadow:0 12px 34px -10px #ef4444aa}`,
        `<div class="c"><span class="k">⚡ Por tiempo limitado</span><h1>2x1 en tu primer pedido</h1><p>Aprovechá la oferta de hoy. Escribinos antes de que termine.</p><a class="btn" href="${go("Hola! Quiero la oferta 2x1 ⚡")}">Aprovechar ahora</a></div>`) },
    { name: "Novedades", category: "full", desc: "Azul moderno para catálogo y novedades.",
      html: page("Novedades", `body{background:#06101c;background-image:radial-gradient(circle at 50% 0%,#0c2a4d,transparent);color:#fff}.c{max-width:460px;width:100%;text-align:center;background:#0a1726;border:1px solid #3b82f655;border-radius:20px;padding:40px 26px}.e{font-size:52px}h1{font-size:28px;margin:8px 0 8px}.g{color:#60a5fa}p{color:#a9c0d6;margin:0 0 26px;line-height:1.55}a.btn{display:block;text-decoration:none;border-radius:12px;padding:17px;font-size:18px;font-weight:800;color:#06101c;background:linear-gradient(90deg,#60a5fa,#3b82f6)}`,
        `<div class="c"><div class="e">🛍️</div><h1>Enterate de las <span class="g">novedades</span></h1><p>Escribinos y te pasamos catálogo, precios y promos. Sin compromiso.</p><a class="btn" href="${go("Hola! Quiero recibir las novedades")}">Pedir info</a></div>`) },
  ];
}

interface LandingConfig { title?: string; headline?: string; subtitle?: string; buttonText?: string; msg?: string; autoRedirect?: boolean }
interface Landing { id: string; name: string; slug: string; config: LandingConfig | null; isPrimary: boolean; published: boolean; publishedUrl: string | null; createdAt: string }

const landingUrl = (slug: string) => `${API_BASE}/p/${slug}`;

// Vista previa aproximada para el modo "Campos" (la página real la arma el server).
function previewFromFields(slug: string, f: FormState): string {
  const go = `${API_BASE}/go?u=${slug}&msg=${encodeURIComponent(f.msg || "Hola, quiero info")}`;
  return `<!doctype html><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${f.title || "Landing"}</title><div style="font-family:system-ui;min-height:100vh;margin:0;display:flex;align-items:center;justify-content:center;background:#0b141a;color:#e9edef;padding:24px"><div style="max-width:440px;width:100%;text-align:center;padding:44px 28px;background:#111b21;border:1px solid #222d34;border-radius:16px"><h1 style="font-size:26px;margin:0 0 10px">${f.headline || "Tu encabezado acá"}</h1><p style="color:#8696a0;margin:0 0 28px;line-height:1.55">${f.subtitle || "Tu subtítulo descriptivo"}</p><a href="${go}" style="display:block;text-decoration:none;border-radius:999px;padding:16px;font-size:17px;font-weight:700;background:#25d366;color:#03301a">${f.buttonText || "Escribir por WhatsApp"}</a></div></div>`;
}

function CopyBtn({ value, label = "Copiar" }: { value: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <Button variant="secondary" onClick={async () => { try { await navigator.clipboard.writeText(value); setOk(true); setTimeout(() => setOk(false), 1500); } catch { /* noop */ } }}>
      {ok ? <><Check className="h-4 w-4" /> ¡Listo!</> : <><Copy className="h-4 w-4" /> {label}</>}
    </Button>
  );
}

interface FormState { name: string; title: string; headline: string; subtitle: string; buttonText: string; msg: string; autoRedirect: boolean }
const EMPTY_FORM: FormState = { name: "", title: "", headline: "", subtitle: "", buttonText: "", msg: "", autoRedirect: false };

export default function LandingsPage() {
  const { user } = useAuth();
  const slug = user?.slug ?? "";
  const tpls = useMemo(() => templates(slug), [slug]);

  const [landings, setLandings] = useState<Landing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [mode, setMode] = useState<"fields" | "html">("html");
  const [html, setHtml] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showTpl, setShowTpl] = useState(false);
  const [snapshot, setSnapshot] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const current = landings.find((l) => l.id === editingId) ?? null;
  const curSnapshot = mode === "html" ? `h|${form.name}|${html}` : `f|${form.name}|${JSON.stringify(form)}`;
  const dirty = editingId === null ? true : curSnapshot !== snapshot;
  const previewHtml = mode === "html" ? html : previewFromFields(slug, form);

  const load = async () => {
    setLoading(true); setError(null);
    try { const { data } = await api.get<{ landings: Landing[] }>("/api/landings"); setLandings(data.landings); }
    catch (err) { setError(apiError(err)); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const startCreate = () => {
    setEditingId(null); setForm(EMPTY_FORM); setMode("html");
    setHtml(tpls[0].html); setSnapshot("");
  };

  const startEdit = async (l: Landing) => {
    setEditingId(l.id); setError(null);
    const c = (l.config ?? {}) as LandingConfig & { raw?: boolean };
    if (c.raw) {
      setMode("html"); setForm({ ...EMPTY_FORM, name: l.name });
      let body = "";
      try { body = await (await fetch(landingUrl(l.slug))).text(); } catch { /* noop */ }
      setHtml(body); setSnapshot(`h|${l.name}|${body}`);
    } else {
      setMode("fields"); setHtml("");
      const f = { name: l.name, title: c.title ?? "", headline: c.headline ?? "", subtitle: c.subtitle ?? "", buttonText: c.buttonText ?? "", msg: c.msg ?? "", autoRedirect: c.autoRedirect ?? false };
      setForm(f); setSnapshot(`f|${l.name}|${JSON.stringify(f)}`);
    }
  };

  const onUploadHtml = (file: File) => { const r = new FileReader(); r.onload = () => { setHtml(String(r.result ?? "")); setMode("html"); }; r.readAsText(file); };

  const buildConfig = (): LandingConfig => ({ title: form.title || undefined, headline: form.headline || undefined, subtitle: form.subtitle || undefined, buttonText: form.buttonText || undefined, msg: form.msg || undefined, autoRedirect: form.autoRedirect || undefined });

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!form.name.trim()) { setError("Ponele un nombre a la landing."); return; }
    if (mode === "html" && !html.trim()) { setError("El HTML no puede estar vacío."); return; }
    setSaving(true); setError(null);
    try {
      const payload = mode === "html" ? { name: form.name.trim(), html } : { name: form.name.trim(), config: buildConfig() };
      if (editingId) await api.put<{ landing: Landing }>(`/api/landings/${editingId}`, payload);
      else { const { data } = await api.post<{ landing: Landing }>("/api/landings", payload); setEditingId(data.landing.id); }
      setSnapshot(curSnapshot);
      await load();
    } catch (err) { setError(apiError(err)); } finally { setSaving(false); }
  };

  const publish = async () => {
    if (!editingId) return;
    if (dirty) await save();
    setBusyId(editingId); setError(null);
    try { await api.post(`/api/landings/${editingId}/publish`); await load(); }
    catch (err) { setError(apiError(err)); } finally { setBusyId(null); }
  };

  const makePrimary = async () => {
    if (!editingId) return;
    setBusyId(editingId); setError(null);
    try { await api.put(`/api/landings/${editingId}`, { isPrimary: true }); await load(); }
    catch (err) { setError(apiError(err)); } finally { setBusyId(null); }
  };

  const remove = async () => {
    if (!current) return;
    if (!window.confirm(`¿Borrar la landing "${current.name}"?`)) return;
    setBusyId(current.id); setError(null);
    try { await api.delete(`/api/landings/${current.id}`); setEditingId(null); setForm(EMPTY_FORM); setHtml(""); await load(); }
    catch (err) { setError(apiError(err)); } finally { setBusyId(null); }
  };

  const useTemplate = (t: Tpl) => { setMode("html"); setHtml(t.html); if (!form.name) setForm((f) => ({ ...f, name: t.name })); setShowTpl(false); };
  type TextKey = "name" | "title" | "headline" | "subtitle" | "buttonText" | "msg";
  const setField = (k: TextKey, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const campaignUrl = current ? (current.publishedUrl ?? landingUrl(current.slug)) : "";
  const editing = editingId !== null || html !== "" || form.name !== "";

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Landings</h1>
          <p className="text-sm text-slate-400">Páginas rastreadas que disparan el Lead y llevan a WhatsApp.</p>
        </div>
        <Button variant="secondary" onClick={() => void load()}>Actualizar</Button>
      </div>

      {error && <div className="mb-4"><ErrorMsg>{error}</ErrorMsg></div>}

      {/* Pestañas de landings */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Landings:</span>
        {landings.map((l) => (
          <button key={l.id} onClick={() => void startEdit(l)}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition ${editingId === l.id ? "border-wa-green bg-wa-green/15 text-wa-green" : "border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800"}`}>
            {l.isPrimary && <Star className="h-3.5 w-3.5 fill-current" />}
            {l.name}
          </button>
        ))}
        <button onClick={startCreate} className="flex items-center gap-1 rounded-lg border border-dashed border-slate-600 px-3 py-1.5 text-sm font-medium text-slate-300 hover:bg-slate-800">
          <Plus className="h-4 w-4" /> Nueva landing
        </button>
      </div>

      {loading && <p className="text-slate-400">Cargando…</p>}

      {!loading && !editing && (
        <Card><p className="text-slate-300">Elegí una landing arriba o creá una nueva.</p></Card>
      )}

      {!loading && editing && (
        <>
          {/* Barra de acciones */}
          <Card className="mb-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <Input value={form.name} onChange={(e) => setField("name", e.target.value)} placeholder="Nombre de la landing" className="!w-64 font-semibold" />
                {current && <div className="mt-1 font-mono text-xs text-slate-500">/{current.slug}{current.published ? " · publicada" : " · borrador"}</div>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" onClick={() => setShowTpl(true)}><LayoutTemplate className="h-4 w-4" /> Plantillas</Button>
                <Button variant="secondary" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" /> Subir .html</Button>
                <input ref={fileRef} type="file" accept=".html,text/html" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadHtml(f); e.target.value = ""; }} />
                {current && <Button variant="secondary" onClick={() => window.open(campaignUrl, "_blank")}><ExternalLink className="h-4 w-4" /> Ver mi sitio</Button>}
                <Button onClick={() => void save()} disabled={saving || !dirty}>{saving ? "Guardando…" : dirty ? "Guardar cambios" : "Sin cambios"}</Button>
                <Button variant="primary" disabled={busyId === editingId || !editingId} onClick={() => void publish()}>
                  {busyId === editingId ? "…" : current?.published ? "Actualizar sitio" : "Publicar"}
                </Button>
              </div>
            </div>
            {current && (
              <>
                <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">URL para campañas</div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <input readOnly value={campaignUrl} className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-300" />
                  <CopyBtn value={campaignUrl} />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {!current.isPrimary && <Button variant="ghost" onClick={() => void makePrimary()}><Star className="h-4 w-4" /> Marcar principal</Button>}
                  <Button variant="danger" onClick={() => void remove()}><Trash2 className="h-4 w-4" /> Borrar</Button>
                </div>
              </>
            )}
          </Card>

          {/* Editor + vista previa en vivo */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="flex flex-col p-0">
              <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-2">
                <div className="inline-flex rounded-md bg-slate-900 p-1 text-xs">
                  <button onClick={() => setMode("fields")} className={`rounded px-3 py-1 font-medium ${mode === "fields" ? "bg-wa-green text-slate-900" : "text-slate-300"}`}>Campos</button>
                  <button onClick={() => setMode("html")} className={`rounded px-3 py-1 font-medium ${mode === "html" ? "bg-wa-green text-slate-900" : "text-slate-300"}`}>HTML</button>
                </div>
                <span className="text-xs text-slate-500">{mode === "html" ? "Editá el HTML libremente" : "Editor por campos (rápido)"}</span>
              </div>
              {mode === "fields" ? (
                <div className="space-y-3 p-4">
                  {([["title", "Título de la pestaña"], ["headline", "Encabezado"], ["subtitle", "Subtítulo"], ["buttonText", "Texto del botón"], ["msg", "Mensaje de WhatsApp"]] as Array<[TextKey, string]>).map(([k, ph]) => (
                    <div key={k}>
                      <label className="mb-1 block text-xs capitalize text-slate-400">{ph}</label>
                      <Input value={form[k]} onChange={(e) => setField(k, e.target.value)} placeholder={ph} />
                    </div>
                  ))}
                  <label className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900/40 p-2.5 text-xs text-slate-300">
                    <input type="checkbox" checked={form.autoRedirect} onChange={(e) => setForm((p) => ({ ...p, autoRedirect: e.target.checked }))} className="h-4 w-4 accent-wa-green" />
                    Redirigir automáticamente a WhatsApp (pasa ~1 seg por la landing y va al chat)
                  </label>
                </div>
              ) : (
                <textarea value={html} onChange={(e) => setHtml(e.target.value)} placeholder="<!doctype html> …"
                  className="h-[28rem] w-full resize-none rounded-b-lg bg-slate-900 px-3 py-2 font-mono text-xs text-slate-100 outline-none" spellCheck={false} />
              )}
            </Card>

            <Card className="flex flex-col p-0">
              <div className="border-b border-slate-800 px-3 py-2 text-xs text-slate-400">Vista previa en tiempo real</div>
              <iframe title="preview" srcDoc={previewHtml} sandbox="allow-scripts" className="h-[28rem] w-full rounded-b-lg bg-white" />
            </Card>
          </div>
        </>
      )}

      {/* Modal de plantillas */}
      {showTpl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setShowTpl(false)}>
          <div className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">Elegir plantilla</h2>
              <button onClick={() => setShowTpl(false)} className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-5 w-5" /></button>
            </div>
            {(["simple", "full"] as TplCat[]).map((cat) => (
              <div key={cat} className="mb-5">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{cat === "simple" ? "Simples" : "Diseños completos"}</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {tpls.filter((t) => t.category === cat).map((t) => (
                    <div key={t.name} className="overflow-hidden rounded-xl border border-slate-700 bg-slate-950">
                      <div className="relative h-36 overflow-hidden border-b border-slate-800">
                        <iframe title={t.name} srcDoc={t.html} sandbox="" tabIndex={-1}
                          className="pointer-events-none absolute left-0 top-0 origin-top-left"
                          style={{ width: "333%", height: "333%", transform: "scale(0.3)" }} />
                      </div>
                      <div className="p-3">
                        <div className="text-sm font-semibold text-slate-100">{t.name}</div>
                        <p className="mt-0.5 mb-3 text-xs text-slate-400">{t.desc}</p>
                        <Button className="w-full" onClick={() => useTemplate(t)}>Usar esta</Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
