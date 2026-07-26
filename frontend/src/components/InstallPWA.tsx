import { useEffect, useState } from "react";
import { Share, X } from "lucide-react";

// Evento no estándar de Chrome/Android para instalar la PWA.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Botón "Instalar app" para el panel (PWA).
//  - Android/desktop (Chrome/Edge): usa el prompt NATIVO del navegador (instala de una).
//  - iPhone/iPad: Apple NO permite instalar por botón → abrimos un modal con el paso a paso
//    (Compartir → Agregar a inicio). Si no está en Safari, se avisa.
//  - Ya instalada (display-mode standalone) → no muestra nada.
export default function InstallPWA() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [showIos, setShowIos] = useState(false);

  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  const ua = navigator.userAgent;
  const isIos = /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && "ontouchend" in document);
  // navegador que NO es Safari en iOS (ahí "Agregar a inicio" no está o falla)
  const notSafari = /crios|fxios|edgios|opios|fban|fbav|instagram|line\/|; wv/i.test(ua);

  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setDeferred(e as BeforeInstallPromptEvent); };
    const onInstalled = () => { setInstalled(true); setDeferred(null); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (standalone || installed) return null; // ya instalada / abierta como app

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => undefined);
    setDeferred(null);
  };

  // Ni prompt nativo ni iOS → el navegador no permite instalar (ej. Firefox desktop): no mostramos.
  if (!deferred && !isIos) return null;

  const cls =
    "flex w-full items-center justify-center gap-2 rounded-lg border border-wa-green/40 bg-wa-green/10 px-3 py-2 text-sm font-semibold text-wa-green transition hover:bg-wa-green/20";

  return (
    <div className="px-3 pb-3">
      <button onClick={() => (deferred ? void install() : setShowIos(true))} className={cls}>
        📲 Instalar app
      </button>

      {showIos && (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 p-4 sm:items-center"
          onClick={() => setShowIos(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-100">📲 Instalar Publi.lat</h3>
              <button onClick={() => setShowIos(false)} className="rounded p-1 text-slate-400 hover:bg-slate-800" aria-label="Cerrar">
                <X className="h-5 w-5" />
              </button>
            </div>

            {notSafari && (
              <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                ⚠️ Abrí esta página en <b>Safari</b> para poder instalarla. (En Chrome, o si entraste desde
                WhatsApp/Instagram, iOS no lo permite.)
              </p>
            )}

            <ol className="space-y-3.5 text-sm text-slate-200">
              <li className="flex items-start gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-wa-green text-xs font-bold text-slate-900">1</span>
                <span>Tocá el botón <b>Compartir</b> <Share className="mb-0.5 inline h-4 w-4" /> (abajo, en el centro de Safari).</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-wa-green text-xs font-bold text-slate-900">2</span>
                <span>Deslizá hacia abajo y elegí <b>"Agregar a inicio"</b>.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-wa-green text-xs font-bold text-slate-900">3</span>
                <span>Tocá <b>"Agregar"</b> arriba a la derecha. ¡Listo, queda como app! 🎉</span>
              </li>
            </ol>

            <p className="mt-4 text-[11px] text-slate-500">Tiene que ser en una pestaña <b>normal</b> (no privada).</p>
          </div>
        </div>
      )}
    </div>
  );
}
