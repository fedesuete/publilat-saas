-- Límites de plan por cliente (configurables desde el panel maestro).
ALTER TABLE "User" ADD COLUMN "maxLines" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "User" ADD COLUMN "maxLandings" INTEGER NOT NULL DEFAULT 50;
