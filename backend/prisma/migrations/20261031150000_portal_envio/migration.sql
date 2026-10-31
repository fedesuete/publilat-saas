-- CreateTable
CREATE TABLE "PortalEnvio" (
    "id" TEXT NOT NULL,
    "eventoId" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'enviando',
    "destino" TEXT,
    "waMsgId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortalEnvio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PortalEnvio_eventoId_key" ON "PortalEnvio"("eventoId");
