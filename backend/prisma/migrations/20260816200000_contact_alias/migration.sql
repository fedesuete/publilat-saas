-- Alias por contacto: nombre que le pone el OPERADOR (agenda) en el Inbox de WhatsApp.
-- Aditivo y puramente visual: columna nullable nueva, NO toca la atribución ni el match del pixel.

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "alias" TEXT;
