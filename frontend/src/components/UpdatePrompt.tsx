import { useEffect } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

// Registro del service worker del panel (modo autoUpdate). No muestra banner: cuando se deploya
// una versión nueva, el SW nuevo se activa solo (skipWaiting + clientsClaim) y acá recargamos la
// página UNA vez al detectar el cambio de controlador → un F5 normal ya trae la versión nueva,
// sin borrar cache. Guard `hadController`: no recarga en la PRIMERA visita (cuando aún no había
// SW), sólo cuando es realmente una actualización. `refreshing`: evita bucles de recarga.
export default function UpdatePrompt() {
  useRegisterSW({ immediate: true });

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const hadController = Boolean(navigator.serviceWorker.controller);
    let refreshing = false;
    const onChange = () => {
      if (refreshing || !hadController) return;
      refreshing = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onChange);
    return () => navigator.serviceWorker.removeEventListener("controllerchange", onChange);
  }, []);

  return null;
}
