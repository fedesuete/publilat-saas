-- Bot de carga/descarga del Chat App (aislado, aditivo: columnas nullable / con default).
ALTER TABLE "User" ADD COLUMN "botEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "botPaymentInfo" TEXT;
ALTER TABLE "User" ADD COLUMN "botWelcome" TEXT;
ALTER TABLE "User" ADD COLUMN "botLoadWebhook" TEXT;

ALTER TABLE "ChatConversation" ADD COLUMN "botStep" TEXT;
ALTER TABLE "ChatConversation" ADD COLUMN "botAmount" INTEGER;
