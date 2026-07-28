// Utilidades de instalación de la PWA (beforeinstallprompt + detección de iOS/standalone).
import { getToken, loadBranding } from "./api";

export type InstallPrompt = { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

function sessionParams(): string | null {
  const t = getToken();
  if (!t) return null;
  const params = new URLSearchParams();
  params.set("t", t);
  const slug = loadBranding()?.accountSlug;
  if (slug) params.set("s", slug);
  return params.toString();
}

// Apunta el <link rel="manifest"> a un manifest DINÁMICO por sesión (/session-manifest?t=..&s=..).
// Su start_url incluye la sesión, así la app instalada en iPhone (storage aislado de Safari) abre YA
// logueada — iOS usa el start_url del manifest para lanzar la app. Se setea desde el load (main.tsx)
// y al montar el chat, para que al "Agregar a inicio" iOS lea el manifest con la sesión actual.
export function pointManifestToSession(): void {
  const qs = sessionParams();
  if (!qs) return;
  try {
    let link = document.querySelector('link[rel="manifest"]') as HTMLLinkElement | null;
    if (!link) { link = document.createElement("link"); link.rel = "manifest"; document.head.appendChild(link); }
    link.href = `/session-manifest?${qs}`;
  } catch { /* noop */ }
}

// Al tocar instalar: además de apuntar el manifest, horneamos la sesión en la URL actual (iOS viejo
// captura la URL actual al "Agregar a inicio"). En Android no hace falta (comparte storage).
export function bakeSessionIntoUrl(): void {
  const qs = sessionParams();
  if (!qs) return;
  try { history.replaceState(null, "", `/chat?${qs}`); } catch { /* noop */ }
  pointManifestToSession();
}

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
