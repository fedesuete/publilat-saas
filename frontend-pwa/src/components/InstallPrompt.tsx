import { useEffect, useState } from "react";
import { onInstallAvailable, promptInstall, isIos, isStandalone, isInAppBrowser, bakeSessionIntoUrl } from "../lib/install";

const HIDE_KEY = "publilat_install_hidden";

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

// Guía visual paso a paso para "Agregar a inicio" en iPhone (en iOS no se puede instalar por botón).
export function InstallGuide({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-5 text-left" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 text-center text-lg font-bold text-slate-100">Instalá la app en iPhone</div>
        <ol className="space-y-3 text-sm text-slate-300">
          <li className="flex items-start gap-3">
            <Num>1</Num>
            <span>Tocá el botón <b className="inline-flex items-center gap-1 text-slate-100"><ShareIcon /> Compartir</b> de Safari (está en la barra de <b>abajo</b>, el cuadrado con la flecha hacia arriba).</span>
          </li>
          <li className="flex items-start gap-3">
            <Num>2</Num>
            <span>Deslizá hacia abajo y tocá <b className="text-slate-100">Agregar a inicio</b> ➕.</span>
          </li>
          <li className="flex items-start gap-3">
            <Num>3</Num>
            <span>Tocá <b className="text-slate-100">Agregar</b> arriba a la derecha. Listo: queda el ícono en tu pantalla de inicio.</span>
          </li>
        </ol>
        <p className="mt-3 text-xs text-slate-500">Instalada, la app abre en pantalla completa y puede enviarte notificaciones.</p>
        <button onClick={onClose} className="mt-4 w-full rounded-full py-2.5 font-semibold text-slate-900" style={{ background: "var(--brand-primary)" }}>Entendido</button>
      </div>
    </div>
  );
}

function Num({ children }: { children: React.ReactNode }) {
  return <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-slate-900" style={{ background: "var(--brand-primary)" }}>{children}</span>;
}

// Guía para instalar en Android cuando el prompt nativo no llegó: texto corto + infografía de los pasos.
export function AndroidInstallGuide({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-4 text-center" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 text-lg font-bold text-slate-900">Instalá la app en Android</div>
        <p className="mb-3 text-sm text-slate-700">
          En <b>Chrome</b>: tocá el menú <b>⋮</b> (arriba a la derecha) → <b>Agregar a pantalla principal</b> → <b>Agregar</b>.
        </p>
        <img
          src="/android-install.jpg"
          alt="Pasos para instalar en Android: abrí Chrome, tocá los tres puntos (⋮), elegí «Agregar a pantalla principal» y confirmá «Agregar»."
          className="w-full rounded-lg border border-slate-200"
          loading="lazy"
        />
        <button onClick={onClose} className="mt-4 w-full rounded-full py-2.5 font-semibold text-white" style={{ background: "var(--brand-primary)" }}>Entendido</button>
      </div>
    </div>
  );
}

// Modal "PASO 1 DE 2" para instalar la PWA (estilo widget de casino: tarjeta con degradé de la
// marca, ícono de la app, instrucción de Compartir → Agregar a inicio y "Entendido"). El paso 2 es
// el modal de notificaciones (PushPrompt): el padre los encadena — este primero, aquel después.
// Texto del shell NEUTRO (§9.3); la marca la pone el branding del cliente.
export default function InstallPrompt({ branding, onClose }: { branding?: { brandName?: string | null; logoUrl?: string | null } | null; onClose?: () => void }) {
  const [canInstall, setCanInstall] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [logoBroken, setLogoBroken] = useState(false);
  const [ready, setReady] = useState(false); // pequeño delay para no saltar en el primer paint
  useEffect(() => onInstallAvailable(setCanInstall), []);
  useEffect(() => { const t = setTimeout(() => setReady(true), 700); return () => clearTimeout(t); }, []);

  if (isStandalone() || !ready) return null;
  const dismiss = () => { localStorage.setItem(HIDE_KEY, "1"); onClose?.(); };
  const brand = branding?.brandName?.trim();
  const logo = branding?.logoUrl?.trim();

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-5 backdrop-blur-sm" onClick={dismiss}>
      <div
        className="modal-pop relative w-full max-w-sm rounded-3xl px-6 pb-5 pt-5 text-center text-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "linear-gradient(160deg, rgba(255,255,255,0.10), rgba(0,0,0,0.30)), var(--brand-primary, #7c2fd6)",
          boxShadow: "0 24px 60px -12px rgba(0,0,0,0.7)",
        }}
      >
        <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.25em] text-white/75">Paso 1 de 2</div>

        <div className="mb-4 flex justify-center">
          {logo && !logoBroken ? (
            <img src={logo} alt={brand || ""} onError={() => setLogoBroken(true)}
              className="h-20 w-20 rounded-2xl object-cover shadow-lg ring-4 ring-white/20" />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-white/15 text-3xl shadow-lg ring-4 ring-white/20">📲</div>
          )}
        </div>

        <h2 className="text-2xl font-extrabold leading-tight" style={{ textShadow: "0 1px 2px rgba(0,0,0,0.25)" }}>
          {brand ? `Instalá la app de ${brand}` : "Instalá la app"}
        </h2>
        <p className="mx-auto mt-2 max-w-xs text-sm text-white/85">
          Accedé más rápido desde tu pantalla de inicio.
        </p>

        {canInstall ? (
          <button onClick={() => { void promptInstall().finally(dismiss); }}
            className="mt-4 w-full rounded-2xl bg-white py-3.5 text-base font-extrabold text-slate-900 shadow-lg transition active:scale-[.98]">
            Instalar app
          </button>
        ) : isInAppBrowser() ? (
          <div className="mt-4 rounded-2xl border border-amber-300/40 bg-amber-500/20 p-3.5 text-left text-sm text-amber-50">
            Estás en un navegador dentro de otra app. Abrí este link en <b>Chrome</b> (Android) o <b>Safari</b> (iPhone): menú <b>⋮ / •••</b> → <b>Abrir en el navegador</b>.
          </div>
        ) : isIos() ? (
          <button onClick={() => { bakeSessionIntoUrl(); setShowGuide(true); }}
            className="mt-4 w-full rounded-2xl bg-white/15 p-4 text-left text-[15px] leading-relaxed ring-1 ring-white/25 transition active:scale-[.99]">
            Tocá <b className="inline-flex items-center gap-1">Compartir <ShareIcon /></b> y después{" "}
            <b>Agregar a inicio <span className="text-emerald-300">＋</span></b> .
          </button>
        ) : (
          <div className="mt-4 rounded-2xl bg-white/15 p-4 text-left text-[15px] leading-relaxed ring-1 ring-white/25">
            Abrí el menú del navegador → <b>Instalar app</b> / <b>Agregar a pantalla de inicio</b>.
          </div>
        )}

        <button onClick={dismiss} className="mx-auto mt-4 block text-sm font-medium text-white/70 hover:text-white">
          Entendido
        </button>
      </div>
      {showGuide && <InstallGuide onClose={() => setShowGuide(false)} />}
    </div>
  );
}
