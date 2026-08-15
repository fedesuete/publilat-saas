import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, apiError, setToken, saveBranding, applyBranding, type Branding } from "../lib/api";

// Recuerda a qué cuenta (slug) pertenece la sesión (mismo criterio que Onboarding/DirectChat).
const SESSION_SLUG_KEY = "publilat_session_slug";

function cookie(name: string): string {
  const m = document.cookie.match("(^|; )" + name + "=([^;]+)");
  return m ? decodeURIComponent(m[2]) : "";
}

// ENTRADA IDENTIFICADA (/c/:slug/:usuario): link POR JUGADOR que el cajero (o su bot) le pasa a cada
// uno, con el username en el path. Entra DERECHO a su chat, passwordless — es el modo clásico de
// POST /api/chat/start: si el usuario no existe en la cuenta lo CREA, si ya existe RETOMA su
// conversación. A diferencia del /c/:slug anónimo (web######), acá el operador ve la conversación
// identificada con ese username. Ojo: NO miramos la sesión guardada a propósito — el link manda; si
// el teléfono tenía sesión de OTRO usuario de esta cuenta, igual entra como el del link (si no, el
// operador vería identidades cruzadas).
export default function IdentifiedChatPage() {
  const { slug, usuario } = useParams<{ slug: string; usuario: string }>();
  const navigate = useNavigate();
  const [brand, setBrand] = useState<Branding | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false); // evita correr dos veces (StrictMode)

  useEffect(() => {
    if (!slug || !usuario || started.current) return;
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
        // 2) Retoma (o crea) al usuario del link. useParams ya viene URL-decodeado.
        //    fbclid/fbp/fbc: de la URL si alguien armó el link desde un anuncio, si no de las cookies.
        const params = new URLSearchParams(location.search);
        const { data } = await api.post("/api/chat/start", {
          accountSlug: pub.data.accountSlug,
          username: usuario.trim(),
          fbclid: params.get("fbclid") || undefined,
          fbp: params.get("fbp") || cookie("_fbp") || undefined,
          fbc: params.get("fbc") || cookie("_fbc") || undefined,
        });
        setToken(data.token);
        localStorage.setItem(SESSION_SLUG_KEY, pub.data.accountSlug);
        navigate("/chat", { replace: true });
      } catch (e) {
        const code = (e as { response?: { data?: { code?: string } } })?.response?.data?.code;
        setError(code === "line_required" ? "El chat no está disponible en este momento. Probá más tarde." : apiError(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, usuario]);

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center p-6 text-center">
      {brand?.logoUrl && <img src={brand.logoUrl} alt="" className="mb-4 h-20 w-20 rounded-2xl object-cover" />}
      <h1 className="text-2xl font-bold">{brand?.brandName || "Chat"}</h1>
      {error ? (
        <div className="mt-5 w-full rounded-xl border border-amber-700/50 bg-amber-500/10 p-3 text-sm text-amber-200">{error}</div>
      ) : (
        <div className="mt-4 flex items-center gap-2 text-sm text-slate-400">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-transparent" />
          Abriendo tu chat…
        </div>
      )}
    </div>
  );
}
