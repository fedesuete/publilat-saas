import { useEffect, useState } from "react";

// Evento no estándar de Chrome/Android para instalar la PWA.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Botón "Instalar app" para el panel (PWA). En Android/desktop usa el prompt nativo del
// navegador; en iOS (Safari no ofrece prompt) muestra el paso a mano. Si ya está instalada
// (abierta como app / display-mode standalone) no muestra nada.
export default function InstallPWA() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [iosHelp, setIosHelp] = useState(false);

  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);

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

  // Ni prompt disponible ni iOS -> el navegador no permite instalar (ej. Firefox desktop): no mostramos.
  if (!deferred && !isIos) return null;

  const cls =
    "flex w-full items-center justify-center gap-2 rounded-lg border border-wa-green/40 bg-wa-green/10 px-3 py-2 text-sm font-semibold text-wa-green transition hover:bg-wa-green/20";

  return (
    <div className="px-3 pb-3">
      <button
        onClick={() => (deferred ? void install() : setIosHelp((v) => !v))}
        className={cls}
      >
        📲 Instalar app
      </button>
      {iosHelp && (
        <p className="mt-2 rounded-md bg-slate-800 px-3 py-2 text-xs text-slate-300">
          En iPhone: tocá <b>Compartir</b> (el ícono ⎙ abajo) → <b>“Agregar a inicio”</b>. Queda como una app.
        </p>
      )}
    </div>
  );
}
