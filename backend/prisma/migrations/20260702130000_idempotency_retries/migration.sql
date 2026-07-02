-- Idempotencia de webhooks: waMessageId único (elimina duplicados existentes primero).
DELETE FROM "Message" a
USING "Message" b
WHERE a."waMessageId" IS NOT NULL
  AND a."waMessageId" = b."waMessageId"
  AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."id" > b."id"));

CREATE UNIQUE INDEX "Message_waMessageId_key" ON "Message"("waMessageId");

-- Reintentos CAPI: contador de intentos para dead-letter.
ALTER TABLE "MetaEvent" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
