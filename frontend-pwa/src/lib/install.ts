// Utilidades de instalación de la PWA (beforeinstallprompt + detección de iOS/standalone).
export type InstallPrompt = { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

let deferred: InstallPrompt | null = null;
const listeners = new Set<(available: boolean) => void>();

window.addEventListener("beforeinstallprompt", (e: Event) => {
  e.preventDefault();
  deferred = e as unknown as InstallPrompt;
  listeners.forEach((l) => l(true));
});
window.addEventListener("appinstalled", () => {
  deferred = null;
  listeners.forEach((l) => l(false));
});

export function onInstallAvailable(cb: (available: boolean) => void): () => void {
  listeners.add(cb);
  cb(!!deferred);
  return () => listeners.delete(cb);
}

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  await deferred.prompt();
  const choice = await deferred.userChoice;
  deferred = null;
  return choice.outcome === "accepted";
}

export function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}
export function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
}
// Navegadores embebidos dentro de otra app (WhatsApp/Instagram/Facebook/etc.): NO tienen la
// opción "Agregar a inicio", así que la PWA no se puede instalar desde ahí -> hay que abrir en
// Safari/Chrome. En iOS el navegador de WhatsApp es casi indetectable por UA, por eso el aviso
// para iOS se muestra igual aunque esto dé false (ver OnboardingPage).
export function isInAppBrowser(): boolean {
  const ua = navigator.userAgent || "";
  return /FBAN|FBAV|FB_IAB|Instagram|Line\/|Twitter|MicroMessenger|; wv\)/i.test(ua);
}
