-- Ruleta de premios del Chat App (aditiva: dos tablas nuevas).
-- CreateTable
CREATE TABLE "ChatWheel" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "segments" JSONB NOT NULL DEFAULT '[]',
    "durationMin" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "round" INTEGER NOT NULL DEFAULT 0,
    "activatedAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatWheel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatWheelSpin" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "segment" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "prizeType" TEXT NOT NULL,
    "amount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ChatWheelSpin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChatWheel_userId_key" ON "ChatWheel"("userId");

-- CreateIndex
CREATE INDEX "ChatWheelSpin_userId_status_idx" ON "ChatWheelSpin"("userId", "status");

-- CreateIndex
CREATE INDEX "ChatWheelSpin_playerId_createdAt_idx" ON "ChatWheelSpin"("playerId", "createdAt");
