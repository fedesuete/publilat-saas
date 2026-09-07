-- Fondo "plataforma" detras del chat flotante (estilo widget): por cuenta y por skin.
ALTER TABLE "User" ADD COLUMN "chatBgUrl" TEXT;
ALTER TABLE "ChatSkin" ADD COLUMN "chatBgUrl" TEXT;
