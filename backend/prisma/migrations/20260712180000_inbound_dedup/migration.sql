-- Idempotencia atómica de eventos entrantes de WhatsApp (anti-duplicado por carrera).
-- Aditiva: crea una tabla nueva, no toca datos existentes.
CREATE TABLE IF NOT EXISTS "InboundDedup" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InboundDedup_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "InboundDedup_key_key" ON "InboundDedup"("key");
CREATE INDEX IF NOT EXISTS "InboundDedup_createdAt_idx" ON "InboundDedup"("createdAt");
