-- Bot de carga/descarga en el canal KOMMO (Fase 1): estado de la conversación por lead de Kommo
-- (paso del flujo + monto en curso). Aditivo: tabla nueva, no toca nada existente.

-- CreateTable
CREATE TABLE "KommoBotState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kommoLeadId" TEXT NOT NULL,
    "step" TEXT,
    "amountCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KommoBotState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KommoBotState_userId_kommoLeadId_key" ON "KommoBotState"("userId", "kommoLeadId");
