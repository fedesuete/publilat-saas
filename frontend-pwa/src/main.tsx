import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";
import { loadBranding, applyBranding, saveBranding, getToken, setToken, API_BASE, recoverSession } from "./lib/api";
import { pointManifestToSession } from "./lib/install";

// App instalada en iPhone: la sesión viene horneada en la URL de lanzamiento (?t=token&s=slug),
// porque iOS aísla el storage de la app respecto de Safari. La leemos ANTES de pintar para entrar
// directo al chat con la sesión, refrescamos la marca (storage aislado) y limpiamos la URL.
try {
  const url = new URL(window.location.href);
  const urlToken = url.searchParams.get("t");
  const urlSlug = url.searchParams.get("s");
  if (urlToken && !getToken()) setToken(urlToken);
  if (urlSlug) {
    fetch(`${API_BASE}/api/chat/public/${urlSlug}`)
      .then((r) => r.json())
      .then((d) => { if (d?.branding) { applyBranding(d.branding); saveBranding(urlSlug, d.branding); } })
      .catch(() => undefined);
  }
  if (urlToken || urlSlug) {
    url.searchParams.delete("t"); url.searchParams.delete("s");
    history.replaceState(null, "", (url.pathname || "/chat") + url.hash);
  }
} catch { /* noop */ }

// Aplicar la marca guardada apenas arranca (antes de pintar), para no ver el flash genérico.
const saved = loadBranding();
if (saved) applyBranding(saved);

// Si ya hay sesión, apuntamos el manifest a la sesión (para que la instalación en iPhone abra logueada).
pointManifestToSession();

// Registrar el service worker (para push + shell). injectRegister:false en vite.config.
// Auto-actualización: cuando el SW nuevo toma control (skipWaiting + claim en sw.ts), recargamos
// UNA vez para cargar la versión nueva al instante — así la app instalada no queda pegada a una
// versión vieja cacheada. Solo recarga si ya había un SW previo (no en la primera visita).
if ("serviceWorker" in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading || !hadController) return;
    reloading = true;
    window.location.reload();
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js")
      .then((reg) => {
        void reg.update().catch(() => undefined); // chequeo al abrir
        // Chequeo periódico + al volver a la pestaña: si hay un deploy nuevo mientras la app está
        // ABIERTA, lo toma en ~1min y recarga sola (no hace falta cerrar/abrir ni F5).
        setInterval(() => { void reg.update().catch(() => undefined); }, 60_000);
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") void reg.update().catch(() => undefined);
        });
      })
      .catch(() => undefined);
  });
}

async function boot() {
  // Si no hay token en localStorage (borrado por Safari ITP / incógnito / limpiar datos, o primera vez),
  // intentamos recuperar la sesión desde la cookie httpOnly ANTES de pintar. Así los guards de ruta ya
  // ven la sesión y NO mandan a crear otra cuenta (evita duplicar la cuenta de ganamos). Es rápido; si
  // no hay cookie válida, /session responde 401 al toque y seguimos como visitante sin sesión.
  // Si YA hay token, igual pegamos a /session en segundo plano: renueva/backfillea la cookie httpOnly
  // (los jugadores que ya estaban logueados aún no la tienen) y hace rodar la sesión otros 90 días.
  // Sin token: recuperar sesión ANTES de pintar (evita duplicar cuenta). Con token pero SIN branding
  // guardado (app instalada, storage aislado): también esperamos, así recoverSession resuelve el slug
  // de sesión y aplica la marca del cliente antes de pintar (si no, arranca con el estilo default).
  if (!getToken() || !loadBranding()) await recoverSession();
  else void recoverSession();
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>,
  );
}
void boot();
