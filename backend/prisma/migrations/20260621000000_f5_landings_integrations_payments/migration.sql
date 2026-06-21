-- AlterTable
ALTER TABLE "Landing" ADD COLUMN "config" JSONB;
ALTER TABLE "Landing" ADD COLUMN "published" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'nativo',
    "webhookUrl" TEXT,
    "secret" TEXT,
    "onLead" BOOLEAN NOT NULL DEFAULT true,
    "onPurchase" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT,
    "days" INTEGER NOT NULL,
    "amount" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'ARS',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Integration_userId_key" ON "Integration"("userId");

-- AddForeignKey
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
