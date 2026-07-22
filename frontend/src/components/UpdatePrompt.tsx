import { useRegisterSW } from "virtual:pwa-register/react";

// Aviso de "nueva versión disponible" del panel. Con registerType:"prompt", cuando se deploya una
// versión nueva el service worker queda ESPERANDO y acá mostramos un banner: al tocar "Actualizar"
// se activa la nueva y recarga. Chequea updates cada 60s (así aunque dejes la pestaña abierta todo
// el día te avisa al toque de un deploy) — sin tener que borrar cache ni hacer Ctrl+Shift+R.
export default function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, r) {
      if (r) setInterval(() => { void r.update(); }, 60_000);
    },
  });

  if (!needRefresh) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-[100] flex w-[92%] max-w-md -translate-x-1/2 items-center gap-3 rounded-xl border border-wa-green/40 bg-slate-800 px-4 py-3 shadow-2xl">
      <span className="flex-1 text-sm text-slate-200">✨ Hay una versión nueva del panel.</span>
      <button
        onClick={() => void updateServiceWorker(true)}
        className="shrink-0 rounded-lg bg-wa-green px-3 py-1.5 text-sm font-semibold text-slate-900 hover:brightness-95"
      >
        Actualizar
      </button>
      <button
        onClick={() => setNeedRefresh(false)}
        className="shrink-0 text-xs text-slate-400 hover:text-white"
        aria-label="Cerrar"
      >
        ✕
      </button>
    </div>
  );
}
