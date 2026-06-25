import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, apiError } from "../lib/api";
import { API_BASE } from "../lib/config";
import { fmtDate } from "../lib/format";
import { useAuth } from "../lib/auth";
import { Button, Input, Card, ErrorMsg } from "../components/ui";

// Plantillas de HTML libre (diseños originales, listos para editar). El CTA apunta al
// redirector /go (con el slug del usuario) para que la atribución siga funcionando.
// NO traen número ni pixel reales: el número lo asigna la rotación de líneas y el Lead
// server-side lo dispara /go. El cliente edita textos/colores a gusto.
function templates(slug: string): Array<{ name: string; html: string }> {
  const go = (msg: string) => `${API_BASE}/go?u=${slug}&msg=${encodeURIComponent(msg)}`;
  const page = (title: string, css: string, body: string) =>
    `<!doctype html><html lang="es"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${title}</title><style>*{box-sizing:border-box}body{margin:0;font-family:system-ui,'Segoe UI',Roboto,Arial,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}a.btn:active{transform:scale(.99)}${css}</style></head><body>${body}</body></html>`;
  const plus18 = `<small style="display:block;margin-top:16px;color:#7a7a7a;font-size:12px">+18 · Jugá con responsabilidad</small>`;

  // Genéricas (negocio en general)
  const base = (title: string, body: string) =>
    page(
      title,
      `body{background:#0b141a;color:#e9edef}.c{max-width:440px;width:100%;text-align:center;padding:44px 28px;background:#111b21;border:1px solid #222d34;border-radius:16px}h1{font-size:26px;margin:0 0 10px}p{color:#8696a0;margin:0 0 28px;line-height:1.55}a.btn{display:block;text-decoration:none;border-radius:999px;padding:16px;font-size:17px;font-weight:700;background:#25d366;color:#03301a}`,
      `<div class="c">${body}</div>`,
    );

  return [
    {
      name: "Simple",
      html: base("Contactanos", `<h1>Hablá con nosotros</h1><p>Te respondemos al toque por WhatsApp.</p><a class="btn" href="${go("Hola, quiero info")}">Escribir por WhatsApp</a>`),
    },
    {
      name: "Promo",
      html: base("Promo", `<h1>🔥 Promo por tiempo limitado</h1><p>Escribinos y reservá tu descuento ahora.</p><a class="btn" href="${go("Hola, quiero la promo")}">Quiero la promo</a>`),
    },
    {
      name: "Servicios",
      html: base("Servicios", `<h1>¿Necesitás ayuda?</h1><p>Contanos qué buscás y te asesoramos sin cargo.</p><a class="btn" href="${go("Hola, necesito asesoramiento")}">Pedir asesoramiento</a>`),
    },

    // Rubro casino / apuestas (diseños originales)
    {
      name: "Casino Oro",
      html: page(
        "Bono de bienvenida",
        `body{background:radial-gradient(circle at 50% 0%,#1a1407,#0a0a0a);color:#fff}.c{max-width:460px;width:100%;text-align:center;background:linear-gradient(180deg,#171206,#0d0b04);border:1px solid #b8860b55;border-radius:20px;padding:44px 26px;box-shadow:0 24px 60px -24px #000}.k{display:inline-block;padding:6px 14px;border:1px solid #d4af3766;border-radius:999px;color:#e9c766;font-size:12px;letter-spacing:1px;text-transform:uppercase}h1{font-size:30px;margin:16px 0 8px;line-height:1.2}.g{background:linear-gradient(90deg,#f5d271,#d4af37,#b8860b);-webkit-background-clip:text;background-clip:text;color:transparent}p{color:#c9bfa3;margin:0 0 26px;line-height:1.55}a.btn{display:block;text-decoration:none;border-radius:999px;padding:17px;font-size:18px;font-weight:800;color:#1a1407;background:linear-gradient(90deg,#f5d271,#d4af37);box-shadow:0 12px 34px -10px #d4af37aa}`,
        `<div class="c"><span class="k">Bono de bienvenida</span><h1>Hasta <span class="g">200% extra</span> en tu primera carga</h1><p>Registrate gratis y empezá a jugar hoy. Atención al instante por WhatsApp.</p><a class="btn" href="${go("Hola! Quiero mi bono de bienvenida 🎁")}">Quiero mi bono</a>${plus18}</div>`,
      ),
    },
    {
      name: "Ruleta Neón",
      html: page(
        "Girá y ganá",
        `body{background:#0a0613;background-image:radial-gradient(circle at 80% 15%,#3b0d6b55,transparent),radial-gradient(circle at 10% 90%,#0d6b6155,transparent);color:#fff}.c{max-width:460px;width:100%;text-align:center;background:#120a22;border:1px solid #6d28d955;border-radius:20px;padding:40px 26px}.e{font-size:56px;line-height:1}h1{font-size:30px;margin:8px 0 8px}.n{color:#22d3ee;text-shadow:0 0 18px #22d3ee88}p{color:#b9a7d6;margin:0 0 26px;line-height:1.55}a.btn{display:block;text-decoration:none;border-radius:14px;padding:17px;font-size:18px;font-weight:800;color:#0a0613;background:linear-gradient(90deg,#22d3ee,#a855f7);box-shadow:0 0 32px -6px #a855f7aa}`,
        `<div class="c"><div class="e">🎰</div><h1>Girá y <span class="n">ganá</span></h1><p>Tu primera jugada viene con regalo. Sumate y probá tu suerte ahora mismo.</p><a class="btn" href="${go("Hola! Quiero jugar 🎰")}">Jugar ahora</a>${plus18}</div>`,
      ),
    },
    {
      name: "Club VIP",
      html: page(
        "Club VIP",
        `body{background:#07100c;background-image:radial-gradient(circle at 50% -10%,#0f3d2a,transparent);color:#fff}.c{max-width:460px;width:100%;text-align:center;background:#0b1712;border:1px solid #10b98155;border-radius:20px;padding:40px 26px}.k{color:#34d399;font-size:12px;letter-spacing:2px;text-transform:uppercase}h1{font-size:28px;margin:14px 0 14px}p{color:#9fb8ad;margin:0 0 26px;line-height:1.55}a.btn{display:block;text-decoration:none;border-radius:999px;padding:17px;font-size:18px;font-weight:800;color:#06281b;background:linear-gradient(90deg,#34d399,#10b981)}.row{display:flex;gap:8px;justify-content:center;margin-bottom:20px;flex-wrap:wrap}.chip{background:#0f211a;border:1px solid #10b98133;border-radius:10px;padding:8px 12px;color:#cdeee0;font-size:13px}`,
        `<div class="c"><div class="k">★ Club VIP</div><h1>Cargá tus fichas en segundos</h1><div class="row"><span class="chip">Atención 24/7</span><span class="chip">Carga al instante</span><span class="chip">Retiros rápidos</span></div><p>Sumate al grupo VIP y jugá sin esperas. Te atendemos por WhatsApp.</p><a class="btn" href="${go("Hola! Quiero unirme al VIP y cargar fichas")}">Unirme al VIP</a>${plus18}</div>`,
      ),
    },
    {
      name: "Promo Relámpago",
      html: page(
        "Promo relámpago",
        `body{background:#120606;background-image:radial-gradient(circle at 50% 0%,#3a0a0a,transparent);color:#fff}.c{max-width:460px;width:100%;text-align:center;background:#1a0a0a;border:1px solid #ef444455;border-radius:20px;padding:44px 26px}.k{display:inline-block;background:#ef4444;color:#fff;font-weight:700;font-size:12px;padding:5px 12px;border-radius:999px;text-transform:uppercase;letter-spacing:1px}h1{font-size:30px;margin:16px 0 8px}p{color:#e7b3b3;margin:0 0 26px;line-height:1.55}a.btn{display:block;text-decoration:none;border-radius:12px;padding:17px;font-size:18px;font-weight:800;color:#fff;background:linear-gradient(90deg,#ef4444,#f97316);box-shadow:0 12px 34px -10px #ef4444aa}`,
        `<div class="c"><span class="k">⚡ Por tiempo limitado</span><h1>Duplicamos tu primera carga</h1><p>Hoy x2 en tu primer depósito. Escribinos antes de que termine.</p><a class="btn" href="${go("Hola! Quiero la promo x2 ⚡")}">Aprovechar ahora</a>${plus18}</div>`,
      ),
    },
    {
      name: "Deportes",
      html: page(
        "Apuestas deportivas",
        `body{background:#04140a;background-image:radial-gradient(circle at 50% 0%,#0a3d1f,transparent);color:#fff}.c{max-width:460px;width:100%;text-align:center;background:#08160e;border:1px solid #16a34a55;border-radius:20px;padding:40px 26px}.e{font-size:52px}h1{font-size:28px;margin:8px 0 8px}.g{color:#4ade80}p{color:#a7c6b3;margin:0 0 26px;line-height:1.55}a.btn{display:block;text-decoration:none;border-radius:12px;padding:17px;font-size:18px;font-weight:800;color:#04140a;background:linear-gradient(90deg,#4ade80,#16a34a)}`,
        `<div class="c"><div class="e">⚽</div><h1>Apostá a <span class="g">tu equipo</span></h1><p>Cuotas altas y cobrás al toque. Empezá a apostar por WhatsApp.</p><a class="btn" href="${go("Hola! Quiero empezar a apostar ⚽")}">Empezar a apostar</a>${plus18}</div>`,
      ),
    },
  ];
}

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
  const { user } = useAuth();
  const [landings, setLandings] = useState<Landing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [mode, setMode] = useState<"fields" | "html">("fields");
  const [html, setHtml] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<Landing | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
    setMode("fields");
    setHtml("");
    setLastSaved(null);
  };

  const startEdit = async (l: Landing) => {
    setEditingId(l.id);
    setLastSaved(null);
    const c = (l.config ?? {}) as LandingConfig & { raw?: boolean };
    if (c.raw) {
      // Landing de HTML libre: traemos el HTML guardado desde /p/:slug.
      setMode("html");
      setForm({ ...EMPTY_FORM, name: l.name });
      try {
        const r = await fetch(landingUrl(l.slug));
        setHtml(await r.text());
      } catch {
        setHtml("");
      }
    } else {
      setMode("fields");
      setHtml("");
      setForm({
        name: l.name,
        title: c.title ?? "",
        headline: c.headline ?? "",
        subtitle: c.subtitle ?? "",
        buttonText: c.buttonText ?? "",
        msg: c.msg ?? "",
      });
    }
  };

  const onUploadHtml = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => setHtml(String(reader.result ?? ""));
    reader.readAsText(file);
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
    if (mode === "html" && !html.trim()) {
      setError("El HTML no puede estar vacío.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload =
        mode === "html"
          ? { name: form.name.trim(), html }
          : { name: form.name.trim(), config: buildConfig() };
      if (editingId) {
        const { data } = await api.put<{ landing: Landing }>(`/api/landings/${editingId}`, payload);
        setLastSaved(data.landing);
      } else {
        const { data } = await api.post<{ landing: Landing }>("/api/landings", payload);
        setLastSaved(data.landing);
      }
      setForm(EMPTY_FORM);
      setHtml("");
      setMode("fields");
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
                    <Button variant="secondary" onClick={() => void startEdit(l)}>
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
            <div className="inline-flex rounded-md bg-slate-900 p-1 text-xs">
              <button type="button" onClick={() => setMode("fields")} className={`rounded px-3 py-1 font-medium ${mode === "fields" ? "bg-wa-green text-slate-900" : "text-slate-300"}`}>Campos</button>
              <button type="button" onClick={() => setMode("html")} className={`rounded px-3 py-1 font-medium ${mode === "html" ? "bg-wa-green text-slate-900" : "text-slate-300"}`}>HTML libre</button>
            </div>

            {mode === "fields" ? (
              <>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Título (title)</label>
                  <Input value={form.title} onChange={(e) => setField("title", e.target.value)} placeholder="Título de la pestaña" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Encabezado (headline)</label>
                  <Input value={form.headline} onChange={(e) => setField("headline", e.target.value)} placeholder="¡Aprovechá la promo!" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Subtítulo (subtitle)</label>
                  <Input value={form.subtitle} onChange={(e) => setField("subtitle", e.target.value)} placeholder="Escribinos y te asesoramos" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Texto del botón (buttonText)</label>
                  <Input value={form.buttonText} onChange={(e) => setField("buttonText", e.target.value)} placeholder="Escribir por WhatsApp" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Mensaje de WhatsApp (msg)</label>
                  <Input value={form.msg} onChange={(e) => setField("msg", e.target.value)} placeholder="Hola, quiero info" />
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-slate-400">Plantillas:</span>
                  {templates(user?.slug ?? "").map((t) => (
                    <Button key={t.name} type="button" variant="ghost" onClick={() => setHtml(t.html)}>{t.name}</Button>
                  ))}
                  <Button type="button" variant="ghost" onClick={() => fileRef.current?.click()}>Subir .html</Button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".html,text/html"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadHtml(f); e.target.value = ""; }}
                  />
                </div>
                <textarea
                  value={html}
                  onChange={(e) => setHtml(e.target.value)}
                  placeholder="<!doctype html> ..."
                  className="h-64 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-100 outline-none focus:border-wa-green"
                />
                <p className="text-xs text-slate-500">
                  HTML propio. Para atribuir, el botón debe enlazar al redirector{" "}
                  <code className="text-slate-400">{`${API_BASE}/go?u=${user?.slug ?? ""}`}</code> (las plantillas ya lo traen).
                </p>
              </div>
            )}
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
