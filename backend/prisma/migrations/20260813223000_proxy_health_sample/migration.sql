-- Monitor de estabilidad de proxy (Fase 4, test IPRoyal). Un sample cada 5 min por línea de prueba.
-- Aditivo y aislado: tabla nueva, no toca nada existente.

-- CreateTable
CREATE TABLE "ProxyHealthSample" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "proxyId" TEXT,
    "ip" TEXT,
    "country" TEXT,
    "ipChanged" BOOLEAN NOT NULL DEFAULT false,
    "sessionState" TEXT,
    "errorCode" TEXT,
    "flaps" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProxyHealthSample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProxyHealthSample_lineId_createdAt_idx" ON "ProxyHealthSample"("lineId", "createdAt");
