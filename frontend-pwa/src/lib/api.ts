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

// El token del jugador viaja como Bearer (NO cookie).
export const api = axios.create({ baseURL: API_BASE });
api.interceptors.request.use((cfg) => {
  const t = getToken();
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

export function apiError(e: unknown): string {
  if (axios.isAxiosError(e)) return e.response?.data?.error ?? e.message;
  return e instanceof Error ? e.message : "Error";
}

export interface Branding {
  brandName: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  welcomeText: string | null;
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
