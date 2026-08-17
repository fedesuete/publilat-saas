-- Integración Kommo estilo ScaleOS: el cliente pega su URL + token de larga duración y nuestro
-- webhook recibe los eventos de Kommo (etapa ganada -> Purchase; mensaje entrante -> captura del
-- ref:CODIGO que ata el lead de Kommo al clic del anuncio). Todo aditivo.

-- AlterTable
ALTER TABLE "Integration" ADD COLUMN "kommoBaseUrl" TEXT;
ALTER TABLE "Integration" ADD COLUMN "kommoToken" TEXT;

-- CreateTable
CREATE TABLE "KommoLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kommoLeadId" TEXT NOT NULL,
    "kommoContactId" TEXT,
    "contactId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KommoLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KommoLink_userId_kommoLeadId_key" ON "KommoLink"("userId", "kommoLeadId");
