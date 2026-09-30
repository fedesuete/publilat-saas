-- Relay de soporte por grupo de WhatsApp. TODO aditivo: columnas nuevas con default y tablas nuevas.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "supportGroupId" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "supportRelayEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "supportAckText" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "supportIgnoreGroups" JSONB;

CREATE TABLE IF NOT EXISTS "SupportThread" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contactId" TEXT,
    "groupJid" TEXT,
    "groupName" TEXT,
    "code" TEXT NOT NULL,
    "lastAckAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupportThread_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SupportThread_contactId_key" ON "SupportThread"("contactId");
CREATE UNIQUE INDEX IF NOT EXISTS "SupportThread_groupJid_key" ON "SupportThread"("groupJid");
CREATE UNIQUE INDEX IF NOT EXISTS "SupportThread_code_key" ON "SupportThread"("code");
CREATE INDEX IF NOT EXISTS "SupportThread_userId_idx" ON "SupportThread"("userId");

CREATE TABLE IF NOT EXISTS "SupportRelayMsg" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "groupMsgId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupportRelayMsg_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SupportRelayMsg_messageId_key" ON "SupportRelayMsg"("messageId");
CREATE INDEX IF NOT EXISTS "SupportRelayMsg_threadId_idx" ON "SupportRelayMsg"("threadId");
CREATE INDEX IF NOT EXISTS "SupportRelayMsg_groupMsgId_idx" ON "SupportRelayMsg"("groupMsgId");
