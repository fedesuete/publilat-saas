-- Meta Lead Ads (formularios) → captura del lead + respuesta automática. Aditivo: columnas nullable/default
-- en Integration + tabla nueva LeadForm. No toca Contact/Message ni la atribución.
ALTER TABLE "Integration" ADD COLUMN "metaPageId" TEXT;
ALTER TABLE "Integration" ADD COLUMN "metaPageToken" TEXT;
ALTER TABLE "Integration" ADD COLUMN "leadgenEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Integration" ADD COLUMN "leadgenLineId" TEXT;
ALTER TABLE "Integration" ADD COLUMN "leadgenReply" TEXT;

CREATE TABLE "LeadForm" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "leadgenId" TEXT NOT NULL,
  "formId" TEXT,
  "adId" TEXT,
  "answers" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadForm_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LeadForm_leadgenId_key" ON "LeadForm"("leadgenId");
CREATE INDEX "LeadForm_userId_createdAt_idx" ON "LeadForm"("userId", "createdAt");
