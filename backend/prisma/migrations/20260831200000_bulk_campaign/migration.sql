-- Envíos masivos: campaña por cuenta con variantes rotativas (texto/audio), ritmo configurable y
-- filtros de audiencia. Aditivo: tabla nueva, no toca contactos/mensajes/atribución.

-- CreateTable
CREATE TABLE "BulkCampaign" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "variants" JSONB NOT NULL DEFAULT '[]',
    "pauseMinS" INTEGER NOT NULL DEFAULT 170,
    "pauseMaxS" INTEGER NOT NULL DEFAULT 230,
    "lineId" TEXT,
    "audSource" TEXT,
    "audStage" TEXT NOT NULL DEFAULT 'NUEVO',
    "audMaxDays" INTEGER,
    "audLimit" INTEGER NOT NULL DEFAULT 25,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "sent" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "lastRunAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BulkCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BulkCampaign_userId_key" ON "BulkCampaign"("userId");
