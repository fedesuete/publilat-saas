-- Relay de soporte: telefonos del equipo cargados a mano. Aditivo.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "supportTeamNumbers" JSONB;
