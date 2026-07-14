-- Chat App: historial de avisos push enviados (métricas). ADITIVO.
CREATE TABLE "ChatBroadcast" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "image" TEXT,
    "target" TEXT NOT NULL,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatBroadcast_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ChatBroadcast_userId_createdAt_idx" ON "ChatBroadcast"("userId", "createdAt");
ALTER TABLE "ChatBroadcast" ADD CONSTRAINT "ChatBroadcast_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
