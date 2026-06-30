-- Registro del número en la Cloud API: PIN (cifrado) + flag de registrado.
ALTER TABLE "WaLine" ADD COLUMN "registerPin" TEXT;
ALTER TABLE "WaLine" ADD COLUMN "registered" BOOLEAN NOT NULL DEFAULT false;
