-- Chat App (módulo aislado jugador↔cajero). ADITIVO: branding en User + 5 tablas nuevas.

-- Branding white-label por cuenta
ALTER TABLE "User" ADD COLUMN "brandName" TEXT;
ALTER TABLE "User" ADD COLUMN "logoUrl" TEXT;
ALTER TABLE "User" ADD COLUMN "primaryColor" TEXT;
ALTER TABLE "User" ADD COLUMN "accentColor" TEXT;
ALTER TABLE "User" ADD COLUMN "welcomeText" TEXT;
ALTER TABLE "User" ADD COLUMN "welcomeMsgText" TEXT;
ALTER TABLE "User" ADD COLUMN "welcomeMsgImage" TEXT;

-- ChatPlayer
CREATE TABLE "ChatPlayer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nombre" TEXT,
    "casinoUsername" TEXT NOT NULL,
    "invitedByUserId" TEXT,
    "inviteCodeId" TEXT,
    "estatus" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatPlayer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ChatPlayer_userId_casinoUsername_key" ON "ChatPlayer"("userId", "casinoUsername");
CREATE INDEX "ChatPlayer_userId_idx" ON "ChatPlayer"("userId");

-- ChatConversation
CREATE TABLE "ChatConversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "assignedOperatorId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "unreadOperator" INTEGER NOT NULL DEFAULT 0,
    "unreadPlayer" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3),
    "lastMessagePreview" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatConversation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ChatConversation_userId_status_idx" ON "ChatConversation"("userId", "status");
CREATE INDEX "ChatConversation_playerId_idx" ON "ChatConversation"("playerId");

-- ChatMessage
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderType" TEXT NOT NULL,
    "senderId" TEXT,
    "body" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ChatMessage_conversationId_createdAt_idx" ON "ChatMessage"("conversationId", "createdAt");

-- InviteCode
CREATE TABLE "InviteCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InviteCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InviteCode_code_key" ON "InviteCode"("code");
CREATE INDEX "InviteCode_userId_operatorId_idx" ON "InviteCode"("userId", "operatorId");

-- ChatPushSub
CREATE TABLE "ChatPushSub" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "playerId" TEXT,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatPushSub_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ChatPushSub_userId_endpoint_key" ON "ChatPushSub"("userId", "endpoint");
CREATE INDEX "ChatPushSub_userId_idx" ON "ChatPushSub"("userId");

-- Foreign keys
ALTER TABLE "ChatPlayer" ADD CONSTRAINT "ChatPlayer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatConversation" ADD CONSTRAINT "ChatConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatConversation" ADD CONSTRAINT "ChatConversation_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "ChatPlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ChatConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InviteCode" ADD CONSTRAINT "InviteCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatPushSub" ADD CONSTRAINT "ChatPushSub_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatPushSub" ADD CONSTRAINT "ChatPushSub_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "ChatPlayer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
