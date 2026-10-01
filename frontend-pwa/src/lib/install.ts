// Utilidades de instalación de la PWA (beforeinstallprompt + detección de iOS/standalone).
import { api, getToken, loadBranding } from "./api";

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
  // SOLO iOS: en Android cambiar el <link rel="manifest"> hace que Chrome re-evalúe la instalabilidad
  // y NO dispare el beforeinstallprompt (el prompt nativo) → el usuario no puede instalar de un toque.
  // En Android no hace falta (storage compartido: la app instalada ya tiene la sesión).
  if (!isIos()) return;
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
  reportAppInstalled(); // hito "📲 instaló la app" visible para el operador
});

// Reporta al server que la app quedó INSTALADA (mensaje de sistema en el hilo del operador).
// Una vez por dispositivo (localStorage); el server igual dedupea por jugador, así que un
// reinstalado o un segundo dispositivo no duplican el hito. Best-effort: sin token o sin red,
// se limpia el flag y se reintenta en el próximo disparador.
export function reportAppInstalled(): void {
  try {
    if (!getToken()) return; // sin sesión no hay a quién atribuirlo; se reintenta al abrir logueado
    if (localStorage.getItem("pl_install_reported")) return;
    localStorage.setItem("pl_install_reported", "1");
    void api.post("/api/chat/app-installed").catch(() => {
      try { localStorage.removeItem("pl_install_reported"); } catch { /* noop */ }
    });
  } catch { /* noop */ }
}

export function onInstallAvailable(cb: (available: boolean) => void): () => void {
  listeners.add(cb);
  cb(!!deferred);
  return () => listeners.delete(cb);
}

// ---- Android en un navegador que NO es Chrome (2026-10-01) ----
// Instalar desde Chrome = Google arma la app (WebAPK) en sus servidores, firmada y al día. Otros
// navegadores (Samsung Internet sobre todo, que viene de fábrica en los Samsung) arman su propia app con
// una base de Android vieja, y Google Play Protect la BLOQUEA: "Se bloqueó la app no segura. Esta app se
// diseñó para una versión anterior de Android" (Black Win: "a muchos usuarios les aparece así"). Además
// se instalaba como "Chat" genérico. Solución: al tocar Instalar, abrimos ESTA misma página en Chrome,
// con la sesión en el link (main.tsx la lee) para que entre logueado: Chrome no comparte storage.
export function isAndroidNoChrome(): boolean {
  const ua = navigator.userAgent || "";
  if (!/Android/i.test(ua)) return false;
  if (isInAppBrowser()) return false; // WhatsApp/Instagram/etc. tienen su propio aviso
  return /SamsungBrowser|OPR\/|Opera|MiuiBrowser|XiaoMi|UCBrowser|Firefox|FxiOS|EdgA|YaBrowser|HuaweiBrowser|HeyTapBrowser|vivoBrowser|DuckDuckGo|Silk|Kiwi/i.test(ua);
}

/** Abre la página actual (con la sesión) en Chrome. Si Chrome no está, lleva a instalarlo. */
export function abrirEnChrome(): void {
  bakeSessionIntoUrl();
  const sinEsquema = window.location.href.replace(/^https?:\/\//, "");
  const fallback = encodeURIComponent("https://play.google.com/store/apps/details?id=com.android.chrome");
  window.location.href = `intent://${sinEsquema}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${fallback};end`;
}

/** Si hace falta pasar a Chrome para instalar, lo hace y devuelve true (el llamador no sigue). */
export function instalarDesdeChromeSiHaceFalta(): boolean {
  if (!isAndroidNoChrome()) return false;
  abrirEnChrome();
  return true;
}

export async function promptInstall(): Promise<boolean> {
  if (instalarDesdeChromeSiHaceFalta()) return false;
  if (!deferred) return false;
  await deferred.prompt();
  const choice = await deferred.userChoice;
  deferred = null;
  return choice.outcome === "accepted";
}

// ¿Hay (o llega en `timeoutMs`) un prompt de instalación nativo? Chrome dispara el beforeinstallprompt
// un instante después de cargar; si el usuario toca "Instalar" antes, esperamos un toque para poder
// instalar de UN TAP en vez de caer a la guía manual. Resuelve true si el prompt está disponible.
export function waitForInstallPrompt(timeoutMs = 1500): Promise<boolean> {
  if (deferred) return Promise.resolve(true);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: boolean) => { if (done) return; done = true; off(); clearTimeout(timer); resolve(v); };
    const off = onInstallAvailable((available) => { if (available) finish(true); });
    const timer = setTimeout(() => finish(false), timeoutMs);
  });
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
