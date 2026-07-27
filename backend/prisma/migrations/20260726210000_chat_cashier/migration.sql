-- Cajero self-service del Chat App (Fase E): wallet + carga (depósito) + retiro. Aditivo.
-- La acreditación al wallet la habilita SOLO el operador o un webhook de gateway real (nunca por imagen).

CREATE TABLE "ChatWallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'ARS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChatWallet_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ChatWallet_playerId_key" ON "ChatWallet"("playerId");
CREATE INDEX "ChatWallet_userId_idx" ON "ChatWallet"("userId");
ALTER TABLE "ChatWallet" ADD CONSTRAINT "ChatWallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ChatDeposit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ARS',
    "method" TEXT NOT NULL,
    "comprobanteType" TEXT,
    "comprobanteData" BYTEA,
    "gatewayRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "ChatDeposit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ChatDeposit_userId_status_idx" ON "ChatDeposit"("userId", "status");
ALTER TABLE "ChatDeposit" ADD CONSTRAINT "ChatDeposit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ChatWithdrawal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ARS',
    "destino" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "ChatWithdrawal_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ChatWithdrawal_userId_status_idx" ON "ChatWithdrawal"("userId", "status");
ALTER TABLE "ChatWithdrawal" ADD CONSTRAINT "ChatWithdrawal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
