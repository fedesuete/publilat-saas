-- Revisión automática (IA) de reclamos de soporte: la IA propone, un admin aprueba. Aditiva.
CREATE TABLE "SupportTriage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "diagnosis" TEXT NOT NULL,
    "suggestedReply" TEXT NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'ninguna',
    "actionLineId" TEXT,
    "actionReason" TEXT,
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "model" TEXT,
    "contextSummary" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "result" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportTriage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupportTriage_userId_status_idx" ON "SupportTriage"("userId", "status");
CREATE INDEX "SupportTriage_status_createdAt_idx" ON "SupportTriage"("status", "createdAt");
