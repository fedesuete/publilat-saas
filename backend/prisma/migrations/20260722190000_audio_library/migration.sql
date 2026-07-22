-- Biblioteca de audios reutilizables del Inbox + límite por cliente.
ALTER TABLE "User" ADD COLUMN "maxAudioClips" INTEGER NOT NULL DEFAULT 2;

CREATE TABLE "AudioClip" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AudioClip_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AudioClip_userId_idx" ON "AudioClip"("userId");

ALTER TABLE "AudioClip" ADD CONSTRAINT "AudioClip_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
