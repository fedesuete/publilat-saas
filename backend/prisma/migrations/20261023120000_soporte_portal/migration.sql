-- Tickets del portal de Lucky Soft en el relay de soporte (aditiva: columnas nullable).
-- AlterTable
ALTER TABLE "SupportThread" ADD COLUMN     "portalEmail" TEXT,
ADD COLUMN     "portalTicketId" TEXT;
-- CreateIndex
CREATE UNIQUE INDEX "SupportThread_portalTicketId_key" ON "SupportThread"("portalTicketId");
