/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Se sobreescriben en runtime con las CSS vars del branding (primaryColor/accentColor).
        brand: "var(--brand-primary, #25d366)",
        accent: "var(--brand-accent, #128c7e)",
      },
    },
  },
  plugins: [],
};
