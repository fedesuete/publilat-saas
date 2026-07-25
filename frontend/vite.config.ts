import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// El panel de Publi.lat es instalable como app (PWA). SW autogenerado (generateSW) en modo
// "autoUpdate": al deployar una versión nueva, el SW nuevo se activa solo (skipWaiting +
// clientsClaim) y UpdatePrompt recarga la página UNA vez en el próximo refresh natural → un F5
// normal ya trae lo nuevo, sin banner ni borrar cache. NO chequea en background (sin recargas
// sorpresa mientras alguien escribe). No usa push (eso es del Chat App), solo cachea la shell.
// Las llamadas a /api NUNCA se cachean (van siempre a la red).
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,ico,woff2}"],
        navigateFallbackDenylist: [/^\/api/], // /api = backend, jamás cachear
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
      },
      manifest: {
        name: "Publi.lat",
        short_name: "Publi.lat",
        description: "Panel de Publi.lat — atribución WhatsApp → Meta, CRM y campañas.",
        display: "standalone",
        start_url: "/",
        scope: "/",
        theme_color: "#0b141a",
        background_color: "#0b141a",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
  },
});
