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
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
