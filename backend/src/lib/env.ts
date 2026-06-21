// Validación de variables de entorno al arrancar. En producción, faltar una crítica
// (o dejar el JWT_SECRET de ejemplo) corta el arranque para no exponer el servicio.
const PLACEHOLDER_SECRET = "cambia-esto-por-un-secreto-largo";

export function validateEnv(): void {
  const isProd = process.env.NODE_ENV === "production";
  const problems: string[] = [];
  const warn: string[] = [];

  if (!process.env.DATABASE_URL) problems.push("DATABASE_URL");
  if (!process.env.JWT_SECRET) problems.push("JWT_SECRET");
  else if (isProd && (process.env.JWT_SECRET === PLACEHOLDER_SECRET || process.env.JWT_SECRET.length < 24)) {
    problems.push("JWT_SECRET (usá un secreto propio de >=24 caracteres en producción)");
  }

  if (isProd) {
    if (!process.env.PANEL_BASE_URL) problems.push("PANEL_BASE_URL (origen del panel para CORS)");
    if (!process.env.APP_BASE_URL) problems.push("APP_BASE_URL (URL pública del backend)");
    if (!process.env.APP_ENCRYPTION_KEY) problems.push("APP_ENCRYPTION_KEY (cifra los tokens de CAPI por usuario)");
    if (!process.env.META_PIXEL_ID || !process.env.META_CAPI_TOKEN)
      warn.push("META_PIXEL_ID/META_CAPI_TOKEN (sin esto el loop de atribución no matchea)");
    if (!process.env.EVOLUTION_WEBHOOK_TOKEN)
      warn.push("EVOLUTION_WEBHOOK_TOKEN (recomendado para asegurar el webhook de WhatsApp)");
  }

  for (const w of warn) console.warn(`[env] aviso: falta ${w}`);

  if (problems.length) {
    console.error("[env] faltan variables obligatorias:\n  - " + problems.join("\n  - "));
    if (isProd) {
      console.error("[env] abortando el arranque en producción.");
      process.exit(1);
    } else {
      console.warn("[env] (dev) continúo igual, pero revisalo.");
    }
  }
}
