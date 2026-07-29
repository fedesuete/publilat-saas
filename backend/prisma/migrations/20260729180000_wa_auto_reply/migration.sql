-- Auto-responder con botón CTA (link) en la Cloud API: bienvenida + follow-up. Aditivo.
ALTER TABLE "User" ADD COLUMN "waAutoEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "waAutoWelcome" TEXT;
ALTER TABLE "User" ADD COLUMN "waAutoFollowup" TEXT;
ALTER TABLE "User" ADD COLUMN "waAutoBtnLabel" TEXT;
ALTER TABLE "User" ADD COLUMN "waAutoBtnUrl" TEXT;
