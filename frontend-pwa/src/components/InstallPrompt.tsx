import { useEffect, useState } from "react";
import { onInstallAvailable, promptInstall, isIos, isStandalone, isInAppBrowser } from "../lib/install";

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
function InstallGuide({ onClose }: { onClose: () => void }) {
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

// Tarjeta para instalar la PWA. Se muestra donde el usuario YA tiene sesión (el chat) para que
// el orden natural sea registrarse -> instalar -> abrir la app y entrar directo al chat.
// Se oculta si ya está instalada o si el usuario la descartó.
export default function InstallPrompt() {
  const [canInstall, setCanInstall] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [hidden, setHidden] = useState(() => localStorage.getItem(HIDE_KEY) === "1");
  useEffect(() => onInstallAvailable(setCanInstall), []);

  if (isStandalone() || hidden) return null;
  const dismiss = () => { localStorage.setItem(HIDE_KEY, "1"); setHidden(true); };

  return (
    <div className="mx-3 mt-3 rounded-xl border border-slate-700 bg-slate-900/70 p-3 text-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold text-slate-100">📲 Instalá la app</span>
        <button onClick={dismiss} className="text-xs text-slate-500 hover:text-slate-300" aria-label="Cerrar">✕</button>
      </div>
      {canInstall ? (
        <button onClick={() => void promptInstall()} className="w-full rounded-full py-2.5 font-semibold text-slate-900" style={{ background: "var(--brand-primary)" }}>
          Instalar app
        </button>
      ) : isInAppBrowser() ? (
        <div className="rounded-lg border border-amber-600 bg-amber-900/30 p-2.5 text-left text-xs text-amber-100">
          Estás en un navegador dentro de otra app. Para instalar y recibir notificaciones, abrí este
          link en <b>Chrome</b> (Android) o <b>Safari</b> (iPhone): tocá el menú <b>⋮ / •••</b> → <b>Abrir en Chrome/Safari</b>.
        </div>
      ) : isIos() ? (
        <button onClick={() => setShowGuide(true)} className="flex w-full items-center justify-center gap-2 rounded-full py-2.5 font-semibold text-slate-900" style={{ background: "var(--brand-primary)" }}>
          <ShareIcon /> Cómo instalar en iPhone
        </button>
      ) : (
        <p className="text-xs text-slate-400">Abrí el menú del navegador → <b>Instalar app</b> / <b>Agregar a pantalla de inicio</b>.</p>
      )}
      <p className="mt-2 text-[11px] text-slate-600">Sirve para el ícono y las notificaciones. No es obligatorio.</p>
      {showGuide && <InstallGuide onClose={() => setShowGuide(false)} />}
    </div>
  );
}
