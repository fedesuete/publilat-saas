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
      },
    },
  },
  plugins: [],
};
