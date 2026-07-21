-- Clave (hash bcrypt) para el acceso del jugador al Chat App. Nullable: los jugadores
-- viejos siguen entrando passwordless; los nuevos accesos generados por el operador tienen clave.
ALTER TABLE "ChatPlayer" ADD COLUMN "password" TEXT;
