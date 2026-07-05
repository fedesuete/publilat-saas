-- Links rastreados de automatizaciones (CTR por botón/paso, estilo ManyChat).
CREATE TABLE "TrackedLink" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "flowId" TEXT,
  "stepId" TEXT,
  "contactId" TEXT,
  "url" TEXT NOT NULL,
  "label" TEXT,
  "clicks" INTEGER NOT NULL DEFAULT 0,
  "lastClickAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TrackedLink_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TrackedLink_flowId_stepId_idx" ON "TrackedLink"("flowId", "stepId");
