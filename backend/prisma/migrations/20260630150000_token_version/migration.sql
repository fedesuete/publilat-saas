-- Revocación de sesiones: al incrementar tokenVersion, los JWT emitidos antes quedan inválidos.
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
