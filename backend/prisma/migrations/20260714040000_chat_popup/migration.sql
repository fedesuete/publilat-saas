-- Chat App: popup/promo que ve el jugador al entrar a la PWA. ADITIVO (columns nullable en User).
ALTER TABLE "User" ADD COLUMN "popupActive" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "popupImageUrl" TEXT;
ALTER TABLE "User" ADD COLUMN "popupTitle" TEXT;
ALTER TABLE "User" ADD COLUMN "popupText" TEXT;
ALTER TABLE "User" ADD COLUMN "popupLink" TEXT;
ALTER TABLE "User" ADD COLUMN "popupUpdatedAt" TIMESTAMP(3);
