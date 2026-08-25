-- Alias por jugador del Chat App: nombre que le pone el OPERADOR (agenda), igual que Contact.alias
-- en el Inbox de WhatsApp. Los jugadores quedan como "user12345" o ponen cualquier cosa y el operador
-- no sabe quién es quién. Aditivo y solo visual: no toca username/atribución/casino.

-- AlterTable
ALTER TABLE "ChatPlayer" ADD COLUMN "alias" TEXT;
