-- Índices en las tablas más escritas/consultadas (seguridad: mitigan seq-scans que
-- amplifican un flood de webhooks; performance: Inbox, warmup y match de contactos).
-- CREATE INDEX IF NOT EXISTS: idempotente, no falla si ya existe.
CREATE INDEX IF NOT EXISTS "WaLine_sessionId_idx" ON "WaLine"("sessionId");
CREATE INDEX IF NOT EXISTS "WaLine_userId_idx" ON "WaLine"("userId");
CREATE INDEX IF NOT EXISTS "Contact_userId_phone_idx" ON "Contact"("userId", "phone");
CREATE INDEX IF NOT EXISTS "Contact_userId_stage_idx" ON "Contact"("userId", "stage");
CREATE INDEX IF NOT EXISTS "Message_contactId_createdAt_idx" ON "Message"("contactId", "createdAt");
CREATE INDEX IF NOT EXISTS "Message_lineId_direction_createdAt_idx" ON "Message"("lineId", "direction", "createdAt");
