import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, apiError, setToken, loadBranding, saveBranding, applyBranding, type Branding } from "../lib/api";

// Entrada del jugador. Dos formas de llegar:
//  - por link de invitación (/i/:code) -> ya dejó branding + cuenta guardados.
//  - por la LANDING abierta (/login?a=<cuenta>) -> traemos el branding de esa cuenta y el jugador
//    entra directo con su usuario (se registra si es nuevo). Todo pasa por /api/chat/start, que
//    está gateado por días: si la cuenta no tiene día activo, el chat no funciona.
export default function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const urlSlug = (params.get("a") ?? "").trim();
  const saved = loadBranding();

  const [username, setUsername] = useState("");
  const [accountSlug, setAccountSlug] = useState(urlSlug || saved?.accountSlug || "");
  const [brand, setBrand] = useState<Branding | null>(saved ?? null);
  const [inactive, setInactive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const hasAccount = !!accountSlug; // vino por landing (?a=) o ya tenía cuenta recordada

  // Vino por la landing: traemos branding + estado (activo/no) de esa cuenta.
  useEffect(() => {
    if (!urlSlug) return;
    api
      .get(`/api/chat/public/${encodeURIComponent(urlSlug)}`)
      .then(({ data }) => {
        applyBranding(data.branding);
        saveBranding(data.accountSlug, data.branding);
        setBrand(data.branding);
        setAccountSlug(data.accountSlug);
        setInactive(!data.active);
      })
      .catch(() => setError("No encontramos esa cuenta."));
  }, [urlSlug]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !accountSlug.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post("/api/chat/start", { accountSlug: accountSlug.trim(), username: username.trim() });
      setToken(data.token);
      navigate("/chat", { replace: true });
    } catch (e) {
      setError(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  const name = brand?.brandName || "Chat";

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center p-6 text-center">
      {brand?.logoUrl && <img src={brand.logoUrl} alt="" className="mb-4 h-20 w-20 rounded-2xl object-cover" />}
      <h1 className="text-2xl font-bold">{name}</h1>
      <p className="mt-2 text-sm text-slate-400">Poné tu usuario y entrá al chat.</p>

      {inactive && (
        <div className="mt-5 w-full rounded-xl border border-amber-700/50 bg-amber-500/10 p-3 text-sm text-amber-200">
          El chat no está disponible en este momento. Probá más tarde.
        </div>
      )}

      <form onSubmit={submit} className="mt-5 w-full space-y-3">
        {!hasAccount && (
          <input
            value={accountSlug}
            onChange={(e) => setAccountSlug(e.target.value)}
            placeholder="Nombre de la cuenta"
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-center outline-none"
          />
        )}
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Tu usuario"
          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-center outline-none"
        />
        {error && <div className="text-sm text-rose-400">{error}</div>}
        <button
          type="submit"
          disabled={busy || inactive || !username.trim() || !accountSlug.trim()}
          className="w-full rounded-full py-3 font-semibold text-slate-900 disabled:opacity-50"
          style={{ background: "var(--brand-primary)" }}
        >
          {busy ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
