import { useEffect, useState, type FormEvent } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, apiError, setToken, saveBranding, applyBranding, type Branding } from "../lib/api";
import { onInstallAvailable, promptInstall, isIos, isStandalone, isInAppBrowser } from "../lib/install";

function cookie(name: string): string {
  const m = document.cookie.match("(^|;)\\s*" + name + "\\s*=\\s*([^;]+)");
  return m ? decodeURIComponent(m.pop()!) : "";
}

export default function OnboardingPage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const [branding, setBranding] = useState<(Branding & { accountSlug: string; codeActive: boolean }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [canInstall, setCanInstall] = useState(false);
  const installed = isStandalone();

  useEffect(() => {
    if (!code) return;
    api.get(`/api/chat/branding/${code}`)
      .then(({ data }) => {
        const b: Branding = data.branding;
        applyBranding(b);
        saveBranding(data.accountSlug, b);
        setBranding({ ...b, accountSlug: data.accountSlug, codeActive: data.codeActive });
      })
      .catch((e) => setError(apiError(e)))
      .finally(() => setLoading(false));
  }, [code]);

  useEffect(() => onInstallAvailable(setCanInstall), []);

  const register = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !code) return;
    setSubmitting(true); setError(null);
    try {
      const params = new URLSearchParams(location.search);
      const { data } = await api.post("/api/chat/register", {
        code,
        username: username.trim(),
        fbclid: params.get("fbclid") || undefined,
        fbp: cookie("_fbp") || undefined,
        fbc: cookie("_fbc") || undefined,
      });
      setToken(data.token);
      navigate("/chat", { replace: true });
    } catch (e) {
      setError(apiError(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Center>Cargando…</Center>;
  if (error && !branding) return <Center><span className="text-rose-400">{error}</span></Center>;

  const name = branding?.brandName || "Chat";

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center p-6 text-center">
      {branding?.logoUrl && <img src={branding.logoUrl} alt={name} className="mb-4 h-20 w-20 rounded-2xl object-cover" />}
      <h1 className="text-2xl font-bold">{name}</h1>
      {branding?.welcomeText && <p className="mt-2 text-sm text-slate-400">{branding.welcomeText}</p>}

      {/* Paso 1: instalar (opcional). La instalación da ícono, pantalla completa y notificaciones.
          En iPhone SOLO se puede desde Safari (Agregar a inicio); los navegadores embebidos
          (WhatsApp/Instagram) no lo permiten -> hay que abrir en Safari/Chrome primero. */}
      {!installed && (
        <div className="mt-6 w-full rounded-xl border border-slate-700 bg-slate-900/60 p-4 text-sm">
          <div className="mb-2 font-semibold text-slate-100">📲 Instalá la app (recomendado)</div>
          {canInstall ? (
            <button onClick={() => void promptInstall()} className="w-full rounded-full py-3 font-semibold text-slate-900" style={{ background: "var(--brand-primary)" }}>
              Instalar app
            </button>
          ) : isInAppBrowser() ? (
            <div className="rounded-lg border border-amber-600 bg-amber-900/30 p-3 text-left text-amber-100">
              Estás en un navegador dentro de otra app. Para instalar y recibir notificaciones,
              abrí este link en <b>Safari</b> (iPhone) o <b>Chrome</b> (Android): tocá el menú <b>•••</b> arriba
              → <b>Abrir en Safari</b>.
            </div>
          ) : isIos() ? (
            <div className="text-left text-slate-400">
              <p>En iPhone, en <b>Safari</b>: tocá <b>Compartir</b> (el cuadrado con la flecha ↑) → <b>Agregar a inicio</b>.</p>
              <p className="mt-2 text-xs text-amber-200/80">Si abriste el link desde WhatsApp, primero tocá <b>•••</b> → <b>Abrir en Safari</b> (adentro de WhatsApp no aparece la opción).</p>
            </div>
          ) : (
            <p className="text-slate-400">Usá el menú del navegador → <b>Instalar app</b> / <b>Agregar a pantalla de inicio</b>.</p>
          )}
          <p className="mt-2 text-xs text-slate-600">No es obligatorio: también podés chatear así, sin instalar.</p>
        </div>
      )}

      {/* Paso 2: registro */}
      {branding?.codeActive === false ? (
        <div className="mt-6 w-full rounded-xl border border-amber-700 bg-amber-900/30 p-4 text-sm text-amber-100">
          Este link ya fue usado. Si ya te habías registrado, <a href="/login" className="underline">iniciá sesión</a>.
        </div>
      ) : (
        <form onSubmit={register} className="mt-6 w-full space-y-3">
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Elegí tu usuario"
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-center outline-none" />
          {error && <div className="text-sm text-rose-400">{error}</div>}
          <button type="submit" disabled={submitting || !username.trim()}
            className="w-full rounded-full py-3 font-semibold text-slate-900 disabled:opacity-50" style={{ background: "var(--brand-primary)" }}>
            {submitting ? "Entrando…" : "Empezar a chatear"}
          </button>
        </form>
      )}
      <a href="/login" className="mt-4 text-xs text-slate-500 underline">Ya tengo cuenta</a>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-full items-center justify-center p-6 text-slate-400">{children}</div>;
}
