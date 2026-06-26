-- Respuestas rápidas / mensajes guardados del Inbox.
CREATE TABLE "QuickReply" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QuickReply_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "QuickReply_userId_idx" ON "QuickReply"("userId");
ALTER TABLE "QuickReply" ADD CONSTRAINT "QuickReply_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
