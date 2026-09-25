-- Tope de consumo de proxy: una línea que se come el plan queda SIN proxy hasta esta fecha
-- (sigue trabajando por la IP del servidor). Aditivo.
ALTER TABLE "WaLine" ADD COLUMN IF NOT EXISTS "proxyBlockedUntil" TIMESTAMP(3);
