-- Día de Chat App independiente de WhatsApp (mismo saldo de días, auto-renovable). Aditivo.
ALTER TABLE "User" ADD COLUMN "chatDayEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "chatDayExpiresAt" TIMESTAMP(3);
