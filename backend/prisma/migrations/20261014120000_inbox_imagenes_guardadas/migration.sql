-- Imágenes guardadas del Inbox (aditiva: tabla nueva).
-- CreateTable
CREATE TABLE "ImageClip" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImageClip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImageClip_userId_idx" ON "ImageClip"("userId");
