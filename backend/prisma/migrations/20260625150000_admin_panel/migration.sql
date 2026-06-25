-- Rol de usuario (super-admin)
DO $$ BEGIN
  CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Campos nuevos en User
ALTER TABLE "User" ADD COLUMN "role" "Role" NOT NULL DEFAULT 'USER';
ALTER TABLE "User" ADD COLUMN "suspended" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "demoExpiresAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "source" TEXT;
ALTER TABLE "User" ADD COLUMN "lastLoginAt" TIMESTAMP(3);

-- Hilo de soporte
CREATE TABLE "SupportMessage" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "fromAdmin" BOOLEAN NOT NULL DEFAULT false,
  "body" TEXT NOT NULL,
  "mediaUrl" TEXT,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SupportMessage_userId_idx" ON "SupportMessage"("userId");
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Auditoría del admin
CREATE TABLE "AdminLog" (
  "id" TEXT NOT NULL,
  "adminId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "targetUserId" TEXT,
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AdminLog_createdAt_idx" ON "AdminLog"("createdAt");
