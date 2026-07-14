import { useEffect, useState, type FormEvent } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, apiError, setToken, saveBranding, applyBranding, type Branding } from "../lib/api";

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

  useEffect(() => {
    if (!code) return;
    api.get(`/api/chat/branding/${code}`)
      .then(({ data }) => {
        const b: Branding = data.branding;
        applyBranding(b);
        saveBranding(data.accountSlug, b); // recuerda la cuenta -> el login no vuelve a pedirla
        setBranding({ ...b, accountSlug: data.accountSlug, codeActive: data.codeActive });
      })
      .catch((e) => setError(apiError(e)))
      .finally(() => setLoading(false));
  }, [code]);

  // Registrarse es la PRIMERA acción: al entrar queda la sesión y, ya en el chat, se ofrece
  // instalar la app. Así, cuando abran la app instalada, entran directo al chat (no al login).
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
          <p className="text-xs text-slate-600">Después de entrar vas a poder instalar la app para recibir avisos.</p>
        </form>
      )}
      <a href="/login" className="mt-4 text-xs text-slate-500 underline">Ya tengo cuenta</a>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-full items-center justify-center p-6 text-slate-400">{children}</div>;
}
