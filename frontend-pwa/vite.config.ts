import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// PWA del jugador del Chat App. Service worker propio (injectManifest) para el push handler.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectRegister: false, // registramos el SW a mano en main.tsx
      manifest: {
        name: "Chat",
        short_name: "Chat",
        display: "standalone",
        start_url: "/",
        theme_color: "#0b141a",
        background_color: "#0b141a",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { port: 5174 },
});
