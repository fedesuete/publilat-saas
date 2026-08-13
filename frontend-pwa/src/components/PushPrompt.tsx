import { useEffect, useState } from "react";
import { isStandalone } from "../lib/install";
import type { Branding } from "../lib/api";

// Modal GRANDE para activar las notificaciones (reemplaza al banner chico inline). Branded por cuenta:
// usa el logo, la marca y los colores del cliente (--brand-primary / --brand-accent). El texto es
// NEUTRO por defecto (el shell de la PWA es producto nuestro; §9.3). Solo lo renderiza el padre cuando
// el navegador soporta push Y el permiso sigue en "default" (no decidido). Al tocar "Ahora no" se
// posterga unos días para no aparecer en cada apertura.
const SNOOZE_KEY = "publilat_push_snooze_until";
const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000; // 3 días

function BellIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

export default function PushPrompt({
  branding,
  onEnable,
  busy,
}: {
  branding: (Branding & { accountSlug?: string }) | null;
  onEnable: () => Promise<void>;
  busy: boolean;
}) {
  // Snooze persistente + un pequeño delay para que no salte de golpe en el primer paint.
  const [snoozed, setSnoozed] = useState(() => Date.now() < Number(localStorage.getItem(SNOOZE_KEY) || 0));
  const [ready, setReady] = useState(false);
  const [logoBroken, setLogoBroken] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 900);
    return () => clearTimeout(t);
  }, []);

  if (snoozed || !ready) return null;

  const dismiss = () => {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
    setSnoozed(true);
  };

  const brand = branding?.brandName?.trim();
  const logo = branding?.logoUrl?.trim();
  const badge = isStandalone() ? "⚡ App instalada" : brand || "Notificaciones";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-5 backdrop-blur-sm" onClick={dismiss}>
      <div
        className="modal-pop relative w-full max-w-sm rounded-3xl px-6 pb-6 pt-5 text-center text-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "linear-gradient(160deg, rgba(255,255,255,0.10), rgba(0,0,0,0.30)), var(--brand-primary, #7c2fd6)",
          boxShadow: "0 24px 60px -12px rgba(0,0,0,0.7)",
        }}
      >
        {/* Badge superior */}
        <div className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-bold tracking-wide backdrop-blur-sm">
          {badge}
        </div>

        {/* Ícono de la app (logo del cliente) o fallback con campana */}
        <div className="mb-4 flex justify-center">
          {logo && !logoBroken ? (
            <img
              src={logo}
              alt={brand || ""}
              onError={() => setLogoBroken(true)}
              className="h-20 w-20 rounded-2xl object-cover shadow-lg ring-4 ring-white/20"
            />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-white/15 shadow-lg ring-4 ring-white/20">
              <BellIcon className="h-9 w-9" />
            </div>
          )}
        </div>

        <h2 className="text-2xl font-extrabold leading-tight" style={{ textShadow: "0 1px 2px rgba(0,0,0,0.25)" }}>
          Activá las notificaciones
        </h2>
        <p className="mx-auto mt-2 max-w-xs text-sm text-white/85">
          Enterate al instante cuando te respondan. Sin notificaciones podés perderte mensajes importantes.
        </p>

        <button
          onClick={() => void onEnable()}
          disabled={busy}
          className="btn-glow-accent mt-5 flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-base font-extrabold text-white disabled:opacity-60"
          style={{ background: "var(--brand-accent, #128c7e)" }}
        >
          {busy ? "Activando…" : (<><BellIcon /> Activar ahora</>)}
        </button>

        <button onClick={dismiss} disabled={busy} className="mx-auto mt-3 block text-sm font-medium text-white/70 hover:text-white disabled:opacity-60">
          Ahora no
        </button>
      </div>
    </div>
  );
}
