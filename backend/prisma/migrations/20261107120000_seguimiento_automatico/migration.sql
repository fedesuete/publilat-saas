-- Seguimiento automático: config por cuenta + registro de envíos (aditivo).
CREATE TABLE "FollowUpConfig" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "listVariants" JSONB NOT NULL DEFAULT '[]',
    "dailyCap" INTEGER NOT NULL DEFAULT 30,
    "hourFrom" INTEGER NOT NULL DEFAULT 9,
    "hourTo" INTEGER NOT NULL DEFAULT 21,
    "tz" TEXT NOT NULL DEFAULT 'America/Asuncion',
    "minGapMin" INTEGER NOT NULL DEFAULT 8,
    "maxAgeDays" INTEGER NOT NULL DEFAULT 30,
    "lineId" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FollowUpConfig_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FollowUpConfig_userId_key" ON "FollowUpConfig"("userId");

CREATE TABLE "FollowUpTouch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "step" INTEGER NOT NULL,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FollowUpTouch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FollowUpTouch_contactId_kind_step_key" ON "FollowUpTouch"("contactId", "kind", "step");
CREATE INDEX "FollowUpTouch_userId_createdAt_idx" ON "FollowUpTouch"("userId", "createdAt");
