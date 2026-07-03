-- Automatizaciones / secuencias (tipo ManyChat) para WhatsApp.
CREATE TABLE "Flow" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "trigger" TEXT NOT NULL DEFAULT 'first_message',
  "keyword" TEXT,
  "steps" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Flow_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Flow_userId_idx" ON "Flow"("userId");
ALTER TABLE "Flow" ADD CONSTRAINT "Flow_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FlowRun" (
  "id" TEXT NOT NULL,
  "flowId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "stepIndex" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'running',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FlowRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FlowRun_contactId_status_idx" ON "FlowRun"("contactId", "status");
ALTER TABLE "FlowRun" ADD CONSTRAINT "FlowRun_flowId_fkey"
  FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FlowRun" ADD CONSTRAINT "FlowRun_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
