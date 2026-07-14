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
  const [showGuide, setShowGuide] = useState(false); // guía visual de "Agregar a inicio" en iOS
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
            <div className="text-left">
              <button onClick={() => setShowGuide(true)} className="flex w-full items-center justify-center gap-2 rounded-full py-3 font-semibold text-slate-900" style={{ background: "var(--brand-primary)" }}>
                <ShareIcon /> Cómo instalar en iPhone
              </button>
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

      {showGuide && <InstallGuide onClose={() => setShowGuide(false)} />}
    </div>
  );
}

// Ícono de "Compartir" de iOS (cuadrado con flecha hacia arriba).
function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 15V3" />
      <path d="M8 7l4-4 4 4" />
      <path d="M6 12H5a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-2-2h-1" />
    </svg>
  );
}

// Guía visual paso a paso para "Agregar a inicio" en iPhone (no se puede instalar por botón en iOS).
function InstallGuide({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-5 text-left" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 text-center text-lg font-bold text-slate-100">Instalá la app en iPhone</div>
        <ol className="space-y-3 text-sm text-slate-300">
          <li className="flex items-start gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-slate-900" style={{ background: "var(--brand-primary)" }}>1</span>
            <span>Tocá el botón <b className="inline-flex items-center gap-1 text-slate-100"><ShareIcon /> Compartir</b> de Safari (está en la barra de <b>abajo</b>, el cuadrado con la flecha hacia arriba).</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-slate-900" style={{ background: "var(--brand-primary)" }}>2</span>
            <span>Deslizá hacia abajo y tocá <b className="text-slate-100">Agregar a inicio</b> ➕.</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-slate-900" style={{ background: "var(--brand-primary)" }}>3</span>
            <span>Tocá <b className="text-slate-100">Agregar</b> arriba a la derecha. Listo: queda el ícono en tu pantalla de inicio.</span>
          </li>
        </ol>
        <p className="mt-3 text-xs text-slate-500">Instalada, la app abre en pantalla completa y puede enviarte notificaciones.</p>
        <button onClick={onClose} className="mt-4 w-full rounded-full py-2.5 font-semibold text-slate-900" style={{ background: "var(--brand-primary)" }}>Entendido</button>
      </div>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-full items-center justify-center p-6 text-slate-400">{children}</div>;
}
