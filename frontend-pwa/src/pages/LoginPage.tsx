import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, apiError, setToken, loadBranding } from "../lib/api";

export default function LoginPage() {
  const navigate = useNavigate();
  const saved = loadBranding();
  const hasAccount = !!saved?.accountSlug;
  const [username, setUsername] = useState("");
  const [accountSlug, setAccountSlug] = useState(saved?.accountSlug ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const login = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !accountSlug.trim()) return;
    setBusy(true); setError(null);
    try {
      const { data } = await api.post("/api/chat/login", { accountSlug: accountSlug.trim(), username: username.trim() });
      setToken(data.token);
      navigate("/chat", { replace: true });
    } catch (e) {
      setError(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center p-6 text-center">
      {saved?.logoUrl && <img src={saved.logoUrl} alt="" className="mb-4 h-20 w-20 rounded-2xl object-cover" />}
      <h1 className="text-2xl font-bold">{saved?.brandName || "Iniciar sesión"}</h1>
      <p className="mt-2 text-sm text-slate-400">Ingresá con tu usuario.</p>

      {/* Sin cuenta recordada (entró directo, sin pasar por el link): guiar al link de invitación,
          que es la forma normal de entrar la primera vez. Igual dejamos el ingreso manual. */}
      {!hasAccount && (
        <div className="mt-5 w-full rounded-xl border border-slate-700 bg-slate-900/60 p-3 text-left text-xs text-slate-400">
          ¿Primera vez? Abrí el <b className="text-slate-200">link de invitación</b> que te pasaron para
          registrarte. Si ya tenías cuenta, escribí abajo la cuenta y tu usuario.
        </div>
      )}

      <form onSubmit={login} className="mt-5 w-full space-y-3">
        {!hasAccount && (
          <input value={accountSlug} onChange={(e) => setAccountSlug(e.target.value)} placeholder="Nombre de la cuenta"
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-center outline-none" />
        )}
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Tu usuario"
          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-center outline-none" />
        {error && <div className="text-sm text-rose-400">{error}</div>}
        <button type="submit" disabled={busy || !username.trim() || !accountSlug.trim()}
          className="w-full rounded-full py-3 font-semibold text-slate-900 disabled:opacity-50" style={{ background: "var(--brand-primary)" }}>
          {busy ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
