/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0b141a",
        ink2: "#0e1a21",
        wa: { green: "#25D366", dark: "#128C7E", teal: "#14b8a6" },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      keyframes: {
        float: { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-10px)" } },
        pulseGlow: { "0%,100%": { opacity: "0.5" }, "50%": { opacity: "1" } },
        breathe: {
          "0%,100%": { opacity: "0.35", transform: "scale(1)" },
          "50%": { opacity: "0.7", transform: "scale(1.08)" },
        },
        marquee: { "0%": { transform: "translateX(0)" }, "100%": { transform: "translateX(-50%)" } },
        ctaGlow: {
          "0%,100%": { boxShadow: "0 0 0 0 rgba(37,211,102,0.35)" },
          "50%": { boxShadow: "0 0 28px 4px rgba(37,211,102,0.45)" },
        },
      },
      animation: {
        float: "float 6s ease-in-out infinite",
        pulseGlow: "pulseGlow 4s ease-in-out infinite",
        breathe: "breathe 7s ease-in-out infinite",
        marquee: "marquee 28s linear infinite",
        ctaGlow: "ctaGlow 3s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
