-- Salud de línea: calidad (Cloud API) + último chequeo.
ALTER TABLE "WaLine" ADD COLUMN "qualityRating" TEXT;
ALTER TABLE "WaLine" ADD COLUMN "lastCheckedAt" TIMESTAMP(3);
