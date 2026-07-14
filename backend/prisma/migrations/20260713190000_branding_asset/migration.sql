-- Chat App: imágenes de branding servidas por el backend (bucket S3 privado sin CDN). ADITIVO.
CREATE TABLE "BrandingAsset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BrandingAsset_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BrandingAsset_userId_idx" ON "BrandingAsset"("userId");
ALTER TABLE "BrandingAsset" ADD CONSTRAINT "BrandingAsset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
