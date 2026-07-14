import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";
import { loadBranding, applyBranding } from "./lib/api";

// Aplicar la marca guardada apenas arranca (antes de pintar), para no ver el flash genérico.
const saved = loadBranding();
if (saved) applyBranding(saved);

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
      .then((reg) => { void reg.update(); }) // fuerza chequeo de update al abrir
      .catch(() => undefined);
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
