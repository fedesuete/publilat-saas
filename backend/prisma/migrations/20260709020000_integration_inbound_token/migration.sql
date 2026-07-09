-- Token del webhook ENTRANTE (CRM externo → Publi.lat): marca la compra y dispara el Purchase.
-- Opaco y único por usuario; viaja en la URL que se pega en el Salesbot de Kommo.
ALTER TABLE "Integration" ADD COLUMN "inboundToken" TEXT;
CREATE UNIQUE INDEX "Integration_inboundToken_key" ON "Integration"("inboundToken");
