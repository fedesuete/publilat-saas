-- 2026-10-31: clientes sin respuesta en su grupo/chat de soporte (aviso a las 2 h + resumen de la noche en SOPORTE).
-- Solo columnas nullable en SupportThread. Ver lib/soporte-resumen.ts.
ALTER TABLE "SupportThread" ADD COLUMN "pendingSinceAt" TIMESTAMP(3);
ALTER TABLE "SupportThread" ADD COLUMN "lastClientAt" TIMESTAMP(3);
ALTER TABLE "SupportThread" ADD COLUMN "lastClientWho" TEXT;
ALTER TABLE "SupportThread" ADD COLUMN "lastClientText" TEXT;
ALTER TABLE "SupportThread" ADD COLUMN "lastTeamAt" TIMESTAMP(3);
ALTER TABLE "SupportThread" ADD COLUMN "alertedAt" TIMESTAMP(3);
