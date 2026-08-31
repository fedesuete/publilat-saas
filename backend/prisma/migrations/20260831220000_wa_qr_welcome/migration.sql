-- Bienvenida automática para líneas QR: variantes rotativas (texto/audio) al primer mensaje de un
-- contacto nuevo. Aditivo: dos columnas nuevas en User.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "waQrWelcomeEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "waQrWelcomeReplies" JSONB;
