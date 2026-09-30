-- Chat App: interruptor de "pedir el nombre" en el chat directo + respuestas automaticas por palabra clave. Aditivo.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "chatAskName" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "chatAutoReplies" JSONB;
