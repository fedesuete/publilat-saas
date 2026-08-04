// Tema del panel: "dark" (negro+verde, default histórico) o "light" (blanco+verde). Se guarda en
// localStorage y se aplica con data-theme en <html>. La inversión de la escala slate vive en
// index.css / tailwind.config.js — acá solo elegimos y persistimos.
export type Theme = "dark" | "light";
const KEY = "publilat.theme";

export function getTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(t: Theme): void {
  document.documentElement.setAttribute("data-theme", t);
}

export function setTheme(t: Theme): void {
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* almacenamiento bloqueado: igual aplicamos en esta sesión */
  }
  applyTheme(t);
}

export function toggleTheme(): Theme {
  const next: Theme = getTheme() === "light" ? "dark" : "light";
  setTheme(next);
  return next;
}
