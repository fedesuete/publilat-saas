import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, apiError, getToken, setToken, saveBranding, applyBranding, type Branding } from "../lib/api";

// Recuerda a qué cuenta (slug) pertenece la sesión (mismo criterio que Onboarding).
const SESSION_SLUG_KEY = "publilat_session_slug";

// CHAT DIRECTO (/c/:slug): el jugador entra sin registro previo. Para NO duplicar la cuenta de ganamos
// cuando alguien vuelve por el link del anuncio, primero retomamos su sesión (cookie/localStorage, ya
// recuperada en el boot). Si NO tiene sesión de esta cuenta, PREGUNTAMOS antes de crear ("¿Ya tenés
// cuenta?"): solo si dice que es nuevo creamos el jugador anónimo (POST /api/chat/direct).
export default function DirectChatPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [brand, setBrand] = useState<Branding | null>(null);
  const [accountSlug, setAccountSlug] = useState<string>("");
  const [phase, setPhase] = useState<"loading" | "gate" | "creating">("loading");
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false); // evita correr dos veces (StrictMode)

  useEffect(() => {
    if (!slug || started.current) return;
    started.current = true;
    (async () => {
      try {
        // 1) Branding + estado de la cuenta (valida que exista y tenga día activo).
        const pub = await api.get(`/api/chat/public/${encodeURIComponent(slug)}`);
        applyBranding(pub.data.branding);
        saveBranding(pub.data.accountSlug, pub.data.branding);
        setBrand(pub.data.branding);
        setAccountSlug(pub.data.accountSlug);
        if (!pub.data.active) {
          setError("El chat no está disponible en este momento. Probá más tarde.");
          return;
        }
        // 2) ¿Ya tengo sesión de ESTA cuenta? -> entro derecho, sin crear otra.
        if (getToken() && localStorage.getItem(SESSION_SLUG_KEY) === pub.data.accountSlug) {
          navigate("/chat", { replace: true });
          return;
        }
        // 3) redblack = chat estilo WhatsApp (sin casino self-service): el link del cliente entra DERECHO
        //    a la conversación, sin gate ni registro. La cookie de sesión evita duplicar en el regreso.
        if (pub.data.branding?.chatTheme === "redblack") { await enterAsNew(pub.data.accountSlug); return; }
        // 3b) Resto (cuentas casino): preguntamos antes de crear (no auto-creamos = no duplicamos ganamos).
        setPhase("gate");
      } catch (e) {
        const code = (e as { response?: { data?: { code?: string } } })?.response?.data?.code;
        setError(code === "line_required" ? "El chat no está disponible en este momento. Probá más tarde." : apiError(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  // "Soy nuevo" (o entrada directa de redblack): crea el jugador anónimo + la conversación con el 1er
  // mensaje del bot. Recibe el slug por parámetro (en la entrada automática el state todavía no se asentó).
  const enterAsNew = async (accSlug: string) => {
    setPhase("creating");
    setError(null);
    try {
      const { data } = await api.post("/api/chat/direct", { accountSlug: accSlug });
      setToken(data.token);
      localStorage.setItem(SESSION_SLUG_KEY, accSlug);
      navigate("/chat", { replace: true });
    } catch (e) {
      const code = (e as { response?: { data?: { code?: string } } })?.response?.data?.code;
      setError(code === "line_required" ? "El chat no está disponible en este momento. Probá más tarde." : apiError(e));
      setPhase("gate");
    }
  };

  const name = brand?.brandName || "Chat";
  const primary = "var(--brand-primary, #7c3aed)";
  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center p-6 text-center">
      {brand?.logoUrl && <img src={brand.logoUrl} alt="" className="mb-4 h-20 w-20 rounded-2xl object-cover" />}
      <h1 className="text-2xl font-bold">{name}</h1>

      {error ? (
        <div className="mt-5 w-full rounded-xl border border-amber-700/50 bg-amber-500/10 p-3 text-sm text-amber-200">{error}</div>
      ) : phase === "gate" ? (
        <>
          <p className="mt-2 text-sm text-slate-400">¿Ya tenés cuenta?</p>
          <button
            onClick={() => navigate(`/login?a=${encodeURIComponent(accountSlug)}`)}
            className="mt-5 w-full rounded-xl py-3.5 text-base font-extrabold text-white transition active:scale-[.98]"
            style={{ background: primary }}
          >
            Sí, entrar con mi usuario y clave
          </button>
          <button
            onClick={() => void enterAsNew(accountSlug)}
            className="mt-2 w-full rounded-xl border border-white/15 py-3 text-sm font-semibold text-slate-200 hover:bg-white/5"
          >
            Soy nuevo, entrar al chat
          </button>
        </>
      ) : (
        <div className="mt-4 flex items-center gap-2 text-sm text-slate-400">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-transparent" />
          {phase === "creating" ? "Abriendo el chat…" : "Cargando…"}
        </div>
      )}
    </div>
  );
}
