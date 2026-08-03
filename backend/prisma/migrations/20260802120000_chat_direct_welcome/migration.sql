-- Chat directo (sin registro): primer mensaje configurable que pide el nombre al jugador.
ALTER TABLE "User" ADD COLUMN "chatDirectWelcome" TEXT;
