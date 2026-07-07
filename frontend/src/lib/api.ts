import axios from "axios";
import { API_BASE, USER_KEY } from "./config";

// El JWT viaja en una cookie httpOnly (no en localStorage). withCredentials la envía.
export const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
});

api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error?.response?.status === 401) {
      localStorage.removeItem(USER_KEY);
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);

export function apiError(err: unknown, fallback = "Ocurrió un error"): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { error?: string; message?: string; detail?: string } | undefined;
    const base = data?.error ?? data?.message ?? err.message ?? fallback;
    // El backend manda el motivo fino en `detail` (ej. respuesta de la pasarela): mostrarlo.
    return data?.detail ? `${base} — ${data.detail}` : base;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}
