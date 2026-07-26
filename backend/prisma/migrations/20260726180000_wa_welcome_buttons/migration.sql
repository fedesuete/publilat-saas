-- Saludo automático con botones para chats de anuncio (CTWA / Cloud API). Aditivo (nullable/default).
ALTER TABLE "User" ADD COLUMN "waWelcomeEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "waWelcomeText" TEXT;
ALTER TABLE "User" ADD COLUMN "waWelcomeButtons" TEXT;
