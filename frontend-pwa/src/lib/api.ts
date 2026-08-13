import axios from "axios";

export const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
const TOKEN_KEY = "publilat_chat_token";
const BRANDING_KEY = "publilat_chat_branding";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

// El token del jugador viaja como Bearer (localStorage) Y como cookie httpOnly (withCredentials): la
// cookie sobrevive al borrado del localStorage (Safari ITP a los 7 días, incógnito, limpiar datos) y
// permite recuperar la sesión sin volver a registrar → no se duplica la cuenta de ganamos.
export const api = axios.create({ baseURL: API_BASE, withCredentials: true });
api.interceptors.request.use((cfg) => {
  const t = getToken();
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

// Recupera la sesión desde la cookie httpOnly cuando ya no hay token en localStorage. Repuebla el token
// + el slug de la cuenta (para que Onboarding/DirectChat ofrezcan "entrar" en vez de crear otra cuenta).
// Devuelve true si recuperó una sesión válida. Best-effort: si no hay cookie o venció, devuelve false.
export async function recoverSession(): Promise<boolean> {
  try {
    const { data } = await api.get<{ token: string; accountSlug: string | null }>("/api/chat/session");
    if (!data?.token) return false;
    setToken(data.token);
    if (data.accountSlug) {
      localStorage.setItem("publilat_session_slug", data.accountSlug);
      // App instalada (storage AISLADO / vacío): si no hay branding guardado para esta cuenta, lo
      // traemos y aplicamos por el slug de sesión. Sin esto la app instalada arranca con el estilo
      // default (verde) en vez de la marca del cliente (violeta/logo). Best-effort.
      const saved = loadBranding();
      if (!saved || saved.accountSlug !== data.accountSlug) {
        try {
          const { data: pub } = await api.get<{ branding: Branding }>(`/api/chat/public/${data.accountSlug}`);
          if (pub?.branding) { applyBranding(pub.branding); saveBranding(data.accountSlug, pub.branding); }
        } catch { /* noop */ }
      }
    }
    return true;
  } catch {
    return false;
  }
}

export function apiError(e: unknown): string {
  if (axios.isAxiosError(e)) return e.response?.data?.error ?? e.message;
  return e instanceof Error ? e.message : "Error";
}

export interface Branding {
  brandName: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  chatTheme?: string | null; // "whatsapp" (default) | "midnight" — diseño de la PWA del chat
  welcomeText: string | null;
  chatWaLink?: string | null; // CTA "Escribinos por WhatsApp" (registro un-tap)
  chatPlatformUrl?: string | null; // botón "Entrar a la plataforma"
  chatInstallPromptEnabled?: boolean; // muestra el cartel "Instalá la app" dentro del chat
  chatNotifTitle?: string | null; // título del modal de notificaciones (branded; default neutro)
  chatNotifText?: string | null; // bajada del modal de notificaciones (branded; default neutro)
}

export function saveBranding(accountSlug: string, b: Branding) {
  localStorage.setItem(BRANDING_KEY, JSON.stringify({ accountSlug, ...b }));
}
export function loadBranding(): (Branding & { accountSlug: string }) | null {
  try {
    const raw = localStorage.getItem(BRANDING_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Aplica la marca: CSS vars, título y apple-touch-icon.
export function applyBranding(b: Branding) {
  const root = document.documentElement;
  if (b.primaryColor) root.style.setProperty("--brand-primary", b.primaryColor);
  if (b.accentColor) root.style.setProperty("--brand-accent", b.accentColor);
  if (b.brandName) document.title = b.brandName;
  if (b.logoUrl) {
    const icon = document.getElementById("apple-icon") as HTMLLinkElement | null;
    if (icon) icon.href = b.logoUrl;
  }
}
