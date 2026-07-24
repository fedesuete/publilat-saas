-- Carga/descarga contra la plataforma del socio (ganamos). Aditivo. UNIQUE sobre referencia
-- (idempotencia/anti doble-débito a nivel DB, no solo en código).
CREATE TABLE "CasinoTx" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT,
    "playerId" TEXT,
    "type" TEXT NOT NULL,
    "usuario" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ARS',
    "referencia" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "txId" TEXT,
    "errorCode" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CasinoTx_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CasinoTx_referencia_key" ON "CasinoTx"("referencia");
CREATE INDEX "CasinoTx_userId_status_idx" ON "CasinoTx"("userId", "status");

ALTER TABLE "CasinoTx" ADD CONSTRAINT "CasinoTx_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
