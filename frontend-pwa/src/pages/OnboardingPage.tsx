import { useEffect, useState, type FormEvent } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, apiError, setToken, saveBranding, applyBranding, type Branding } from "../lib/api";
import { isInAppBrowser, tryOpenInBrowser } from "../lib/inapp";

function cookie(name: string): string {
  const m = document.cookie.match("(^|;)\\s*" + name + "\\s*=\\s*([^;]+)");
  return m ? decodeURIComponent(m.pop()!) : "";
}

// Normaliza el CTA de WhatsApp: acepta un link completo (https://wa.me/...) o un número suelto.
function waHref(v?: string | null): string | null {
  if (!v) return null;
  const t = v.trim();
  if (/^https?:\/\//i.test(t)) return t;
  const digits = t.replace(/[^0-9]/g, "");
  return digits ? `https://wa.me/${digits}` : null;
}

type Step = "form" | "creating" | "done";
type BrandingFull = Branding & { accountSlug: string; codeActive: boolean };

export default function OnboardingPage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const [branding, setBranding] = useState<BrandingFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [step, setStep] = useState<Step>("form");
  const [nickname, setNickname] = useState("");
  const [prog, setProg] = useState(8);
  const [creds, setCreds] = useState<{ username: string; password: string | null } | null>(null);
  const [forceForm, setForceForm] = useState(false); // "continuar igual" desde el aviso in-app
  const [copied, setCopied] = useState(false);
  const inApp = isInAppBrowser();

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(location.href); setCopied(true); setTimeout(() => setCopied(false), 1600); }
    catch { /* algunos webviews bloquean el portapapeles */ }
  };

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

  // Barra de progreso de "Preparando tu acceso…": crece al entrar al paso.
  useEffect(() => {
    if (step !== "creating") return;
    setProg(8);
    const t = setTimeout(() => setProg(92), 60);
    return () => clearTimeout(t);
  }, [step]);

  // UN TAP: el server genera usuario + clave y los devuelve. Dejamos ver ~1s el "preparando".
  const register = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!code) return;
    setStep("creating"); setError(null);
    const params = new URLSearchParams(location.search);
    try {
      const [{ data }] = await Promise.all([
        api.post("/api/chat/register", {
          code,
          nickname: nickname.trim() || undefined,
          autogenerate: true,
          fbclid: params.get("fbclid") || undefined,
          fbp: cookie("_fbp") || undefined,
          fbc: cookie("_fbc") || undefined,
        }),
        new Promise((r) => setTimeout(r, 1000)),
      ]);
      setToken(data.token);
      setCreds({ username: data.username, password: data.password ?? null });
      setStep("done");
    } catch (err) {
      setError(apiError(err));
      setStep("form");
    }
  };

  if (loading) return <Center>Cargando…</Center>;
  if (error && !branding) return <Center><span className="text-rose-400">{error}</span></Center>;

  const name = branding?.brandName || "Chat";
  const wa = waHref(branding?.chatWaLink);
  const primary = "var(--brand-primary, #7c3aed)";
  const accent = "var(--brand-accent, #c084fc)";

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center p-5">
      <div
        className="w-full rounded-3xl border border-white/10 bg-black/40 p-6 text-center shadow-2xl backdrop-blur"
        style={{ boxShadow: "0 0 70px -24px var(--brand-primary, #7c3aed)" }}
      >
        {branding?.logoUrl && (
          <img src={branding.logoUrl} alt={name} className="mx-auto mb-4 h-20 w-20 rounded-2xl object-cover"
            style={{ boxShadow: "0 0 26px -6px var(--brand-primary, #7c3aed)" }} />
        )}

        {/* --------- PASO: abrí en tu navegador (webview de FB/IG/TikTok) --------- */}
        {inApp && !forceForm && step === "form" ? (
          <>
            <div className="text-4xl">🌐</div>
            <h1 className="mt-2 text-xl font-extrabold tracking-tight">Abrí esto en tu navegador</h1>
            <p className="mt-2 text-sm text-slate-400">
              Estás dentro de una app (Instagram/Facebook/TikTok). Para crear tu cuenta y que funcione bien,
              abrilo en Chrome o Safari.
            </p>
            <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-3 text-left text-sm text-slate-300">
              Tocá el menú <b>•••</b> (arriba a la derecha) y elegí <b>“Abrir en el navegador”</b>.
            </div>
            <button onClick={() => tryOpenInBrowser()}
              className="mt-4 w-full rounded-xl py-3.5 text-base font-extrabold text-white transition active:scale-[.98]"
              style={{ background: primary, boxShadow: "0 12px 30px -10px var(--brand-primary, #7c3aed)" }}>
              Abrir en el navegador
            </button>
            <button onClick={copyLink} className="mt-2 w-full rounded-xl border border-white/15 py-3 text-sm text-slate-200 hover:bg-white/5">
              {copied ? "✓ ¡Link copiado!" : "Copiar link"}
            </button>
            <button onClick={() => setForceForm(true)} className="mt-3 text-xs text-slate-500 underline">Continuar igual acá</button>
          </>
        ) : branding?.codeActive === false && step === "form" ? (
          <>
            <h1 className="text-xl font-bold">{name}</h1>
            <div className="mt-4 rounded-xl border border-amber-600/40 bg-amber-900/20 p-4 text-sm text-amber-100">
              Este link ya fue usado. Si ya te habías registrado, <a href="/login" className="underline">iniciá sesión</a>.
            </div>
          </>
        ) : step === "done" && creds ? (
          /* --------- PASO: cuenta creada --------- */
          <>
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 text-3xl font-bold text-white"
              style={{ boxShadow: "0 0 30px -4px #22c55e" }}>✓</div>
            <h1 className="text-2xl font-extrabold tracking-tight">¡CUENTA CREADA!</h1>
            <div className="mt-5 space-y-2">
              <Field label="USUARIO" value={creds.username} />
              {creds.password && <Field label="CLAVE" value={creds.password} />}
            </div>
            <button onClick={() => navigate("/chat", { replace: true })}
              className="mt-5 w-full rounded-xl py-3.5 text-base font-extrabold text-white transition active:scale-[.98]"
              style={{ background: "#22c55e", boxShadow: "0 12px 30px -10px #22c55e" }}>
              JUGAR YA!
            </button>
            <p className="mt-3 text-xs text-slate-500">Guardá tus datos para volver a entrar cuando quieras.</p>
            {wa && (
              <a href={wa} target="_blank" rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1 text-sm text-slate-400 underline">
                💬 Escribinos por WhatsApp
              </a>
            )}
          </>
        ) : step === "creating" ? (
          /* --------- PASO: preparando --------- */
          <>
            <h1 className="text-2xl font-extrabold tracking-tight">
              Creá tu <span style={{ color: accent }}>cuenta gratis</span>
            </h1>
            {nickname.trim() && (
              <div className="mt-5 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left text-base">{nickname.trim()}</div>
            )}
            <div className="mt-5 h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full transition-[width] duration-[900ms] ease-out"
                style={{ width: `${prog}%`, background: primary }} />
            </div>
            <p className="mt-3 text-sm text-slate-400">Preparando tu acceso…</p>
          </>
        ) : (
          /* --------- PASO: formulario (un tap) --------- */
          <form onSubmit={register}>
            <h1 className="text-2xl font-extrabold tracking-tight">
              Creá tu <span style={{ color: accent }}>cuenta gratis</span>
            </h1>
            <p className="mt-1 text-sm text-slate-400">{branding?.welcomeText || "Estamos Online 24hs!"}</p>

            <input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Ej: Martín"
              autoFocus
              className="mt-5 w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3.5 text-center text-base outline-none focus:border-white/40" />
            {error && <div className="mt-2 text-sm text-rose-400">{error}</div>}

            <button type="submit"
              className="mt-3 w-full rounded-xl py-3.5 text-base font-extrabold text-white transition active:scale-[.98]"
              style={{ background: primary, boxShadow: "0 12px 30px -10px var(--brand-primary, #7c3aed)" }}>
              CREAR MI CUENTA
            </button>

            <p className="mt-4 text-xs text-slate-500">🔒 registro seguro · sin tarjeta · gratis</p>
          </form>
        )}
      </div>

      {step !== "done" && (
        <a href="/login" className="mt-4 text-xs text-slate-500 underline">Ya tengo cuenta</a>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <span className="ml-auto text-lg font-bold">{value}</span>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-full items-center justify-center p-6 text-slate-400">{children}</div>;
}
