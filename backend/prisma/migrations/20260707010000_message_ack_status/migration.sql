-- Ack de WhatsApp por mensaje saliente: sent | delivered | read | failed.
-- "failed" = WhatsApp lo rechazó (ej. código 463); antes quedaba como enviado y el Inbox mentía.
ALTER TABLE "Message" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'sent';
ALTER TABLE "Message" ADD COLUMN "error" TEXT;
