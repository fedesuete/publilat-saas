-- AlterTable: WaLine soporta Cloud API oficial (CTWA), sin romper las líneas Baileys
ALTER TABLE "WaLine" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'baileys';
ALTER TABLE "WaLine" ADD COLUMN "wabaPhoneNumberId" TEXT;
ALTER TABLE "WaLine" ADD COLUMN "wabaId" TEXT;
ALTER TABLE "WaLine" ADD COLUMN "accessToken" TEXT;
ALTER TABLE "WaLine" ADD COLUMN "verifyToken" TEXT;

-- AlterTable: Contact guarda el click id de Click-to-WhatsApp
ALTER TABLE "Contact" ADD COLUMN "ctwaClid" TEXT;
