import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, apiError, setToken, saveBranding, applyBranding, type Branding } from "../lib/api";

// Recuerda a qué cuenta (slug) pertenece la sesión (mismo criterio que Onboarding).
const SESSION_SLUG_KEY = "publilat_session_slug";

// CHAT DIRECTO (3ª opción, /c/:slug): el jugador entra SIN registro. Pintamos la marca, creamos un
// jugador anónimo por atrás (POST /api/chat/direct) y lo mandamos derecho al chat, donde ya lo espera
// el primer mensaje nuestro (configurable) pidiéndole el nombre.
export default function DirectChatPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [brand, setBrand] = useState<Branding | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false); // evita crear dos jugadores si el efecto corre dos veces

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
        if (!pub.data.active) {
          setError("El chat no está disponible en este momento. Probá más tarde.");
          return;
        }
        // 2) Entra directo: crea el jugador anónimo + la conversación con el 1er mensaje nuestro.
        const { data } = await api.post("/api/chat/direct", { accountSlug: pub.data.accountSlug });
        setToken(data.token);
        localStorage.setItem(SESSION_SLUG_KEY, pub.data.accountSlug);
        navigate("/chat", { replace: true });
      } catch (e) {
        const code = (e as { response?: { data?: { code?: string } } })?.response?.data?.code;
        setError(code === "line_required" ? "El chat no está disponible en este momento. Probá más tarde." : apiError(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const name = brand?.brandName || "Chat";
  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center p-6 text-center">
      {brand?.logoUrl && <img src={brand.logoUrl} alt="" className="mb-4 h-20 w-20 rounded-2xl object-cover" />}
      <h1 className="text-2xl font-bold">{name}</h1>
      {error ? (
        <div className="mt-5 w-full rounded-xl border border-amber-700/50 bg-amber-500/10 p-3 text-sm text-amber-200">{error}</div>
      ) : (
        <div className="mt-4 flex items-center gap-2 text-sm text-slate-400">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-transparent" />
          Abriendo el chat…
        </div>
      )}
    </div>
  );
}
