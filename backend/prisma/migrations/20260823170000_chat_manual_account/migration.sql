-- Registro sin usuario automático (por cuenta): el modo un-tap igual dispara el pixel, pero no muestra
-- usuario/clave; el cajero crea la cuenta a mano. Aditiva (columna con default), no rompe nada.
ALTER TABLE "User" ADD COLUMN "chatManualAccount" BOOLEAN NOT NULL DEFAULT false;
