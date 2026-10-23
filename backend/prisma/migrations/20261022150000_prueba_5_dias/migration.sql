-- Prueba gratis de 5 días desde la landing de publi.lat (aditiva).
ALTER TABLE "User" ADD COLUMN "rubro" TEXT,
ADD COLUMN "signupUtm" TEXT,
ADD COLUMN "trialStartedAt" TIMESTAMP(3),
ADD COLUMN "trialEndsAt" TIMESTAMP(3),
ADD COLUMN "trialPhone" TEXT,
ADD COLUMN "trialStage" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "trialUnpaidAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "User_trialPhone_key" ON "User"("trialPhone");
