/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        wa: {
          green: "#25d366",
          dark: "#128c7e",
        },
        // La escala `slate` se define como variables CSS: el tema OSCURO (default) usa los valores
        // normales; el tema CLARO (html[data-theme="light"]) los invierte -> toda la UI que ya usa
        // bg-slate-*/text-slate-*/border-slate-* cambia sola, sin tocar cada componente. Los valores
        // viven en src/index.css. `<alpha-value>` preserva las opacidades (ej. bg-slate-900/40).
        slate: {
          50: "rgb(var(--c-slate-50) / <alpha-value>)",
          100: "rgb(var(--c-slate-100) / <alpha-value>)",
          200: "rgb(var(--c-slate-200) / <alpha-value>)",
          300: "rgb(var(--c-slate-300) / <alpha-value>)",
          400: "rgb(var(--c-slate-400) / <alpha-value>)",
          500: "rgb(var(--c-slate-500) / <alpha-value>)",
          600: "rgb(var(--c-slate-600) / <alpha-value>)",
          700: "rgb(var(--c-slate-700) / <alpha-value>)",
          800: "rgb(var(--c-slate-800) / <alpha-value>)",
          900: "rgb(var(--c-slate-900) / <alpha-value>)",
          950: "rgb(var(--c-slate-950) / <alpha-value>)",
        },
      },
    },
  },
  plugins: [],
};
