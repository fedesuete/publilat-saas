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
  const urlUser = (params.get("u") ?? "").trim();
  const saved = loadBranding();

  const [username, setUsername] = useState(urlUser);
  const [password, setPassword] = useState("");
  const [accountSlug, setAccountSlug] = useState(urlSlug || saved?.accountSlug || "");
  const [brand, setBrand] = useState<Branding | null>(saved ?? null);
  const [inactive, setInactive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Instalar la app: capturamos el prompt nativo (Android/Chrome). Si ya está instalada (abierta
  // como app / standalone) no mostramos el botón. En iOS no hay prompt -> se muestra el paso a mano.
  const [deferred, setDeferred] = useState<(Event & { prompt: () => Promise<void>; userChoice: Promise<unknown> }) | null>(null);
  const [installHelp, setInstallHelp] = useState(false);
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);

  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setDeferred(e as never); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const installApp = async () => {
    if (deferred) {
      await deferred.prompt();
      await Promise.resolve(deferred.userChoice).catch(() => undefined);
      setDeferred(null);
    } else {
      setInstallHelp((v) => !v);
    }
  };

  // Ocultamos el campo "cuenta" SIEMPRE por defecto: el jugador entra sólo con usuario + clave.
  // La cuenta sale del link (?a=), de una visita guardada, o la resuelve el server por el usuario.
  // Sólo se muestra si el server pide desambiguar (code account_required) -> ahí se abre.
  const [accountLocked, setAccountLocked] = useState(true);

  // Traemos branding + estado (activo/no) de la cuenta: la del link (?a=) o la guardada de antes.
  // Así la app instalada (que abre sin ?a=) igual muestra la marca y respeta el candado de días.
  useEffect(() => {
    const slug = urlSlug || saved?.accountSlug || "";
    if (!slug) return;
    api
      .get(`/api/chat/public/${encodeURIComponent(slug)}`)
      .then(({ data }) => {
        applyBranding(data.branding);
        saveBranding(data.accountSlug, data.branding);
        setBrand(data.branding);
        setAccountSlug(data.accountSlug);
        setInactive(!data.active);
      })
      .catch(() => {
        if (urlSlug) setError("No encontramos esa cuenta.");
        else setAccountLocked(false); // la cuenta guardada ya no existe -> abrí el campo
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlSlug]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post("/api/chat/login", {
        ...(accountSlug.trim() ? { accountSlug: accountSlug.trim() } : {}), // sin cuenta: la resuelve el server por el usuario
        username: username.trim(),
        ...(password ? { password } : {}),
      });
      setToken(data.token);
      // Recordamos la cuenta para que la próxima vez muestre el branding y no pida nada.
      const slug = accountSlug.trim() || data.accountSlug;
      if (slug && !saved?.accountSlug) {
        try {
          const pub = await api.get(`/api/chat/public/${encodeURIComponent(slug)}`);
          saveBranding(pub.data.accountSlug, pub.data.branding);
        } catch { /* noop */ }
      }
      navigate("/chat", { replace: true });
    } catch (e) {
      const code = (e as { response?: { data?: { code?: string } } })?.response?.data?.code;
      setError(apiError(e));
      // El server pide el nombre de la cuenta (mismo usuario en varias cuentas, o cuenta inválida).
      if (code === "account_required") setAccountLocked(false);
    } finally {
      setBusy(false);
    }
  };

  const name = brand?.brandName || "Chat";

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center p-6 text-center">
      {/* Lo primero: instalar la app (salvo que ya esté abierta como app). */}
      {!standalone && (
        <div className="mb-7 w-full">
          <button
            onClick={() => void installApp()}
            className="w-full rounded-full py-4 text-base font-bold text-slate-900 shadow-lg"
            style={{ background: "var(--brand-primary, #25d366)" }}
          >
            📲 Instalar la app
          </button>
          <p className="mt-2 text-xs text-slate-500">Instalá la app y entrá desde ahí. Después usás tu usuario y clave.</p>
          {installHelp && (
            <p className="mt-2 rounded-lg bg-slate-800 px-3 py-2 text-xs text-slate-300">
              {isIos
                ? "En iPhone: tocá Compartir (⎋) abajo → “Agregar a inicio”."
                : "Tocá el menú (⋮) del navegador arriba → “Instalar app” / “Agregar a pantalla de inicio”."}
            </p>
          )}
        </div>
      )}

      {brand?.logoUrl && <img src={brand.logoUrl} alt="" className="mb-4 h-20 w-20 rounded-2xl object-cover" />}
      <h1 className="text-2xl font-bold">{name}</h1>
      <p className="mt-2 text-sm text-slate-400">Entrá con tu usuario y clave.</p>

      {inactive && (
        <div className="mt-5 w-full rounded-xl border border-amber-700/50 bg-amber-500/10 p-3 text-sm text-amber-200">
          El chat no está disponible en este momento. Probá más tarde.
        </div>
      )}

      <form onSubmit={submit} className="mt-5 w-full space-y-3">
        {!accountLocked && (
          <input
            value={accountSlug}
            onChange={(e) => setAccountSlug(e.target.value)}
            placeholder="Nombre de la cuenta"
            autoCapitalize="none"
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-center outline-none"
          />
        )}
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Tu usuario"
          autoCapitalize="none"
          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-center outline-none"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Tu clave"
          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-center outline-none"
        />
        {error && <div className="text-sm text-rose-400">{error}</div>}
        <button
          type="submit"
          disabled={busy || inactive || !username.trim()}
          className="w-full rounded-full py-3 font-semibold text-slate-900 disabled:opacity-50"
          style={{ background: "var(--brand-primary)" }}
        >
          {busy ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
