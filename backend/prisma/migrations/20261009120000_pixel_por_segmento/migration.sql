-- Pixel por tipo de cliente (segmento). Aditivo.
ALTER TABLE "Pixel" ADD COLUMN IF NOT EXISTS "label" TEXT;
CREATE TABLE IF NOT EXISTS "ContactSegment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "pixelRowId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ContactSegment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ContactSegment_contactId_key" ON "ContactSegment"("contactId");
CREATE INDEX IF NOT EXISTS "ContactSegment_userId_idx" ON "ContactSegment"("userId");
