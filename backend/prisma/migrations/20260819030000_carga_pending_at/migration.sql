-- Carga iniciada: cuándo se le mostró el CVU al jugador. El recordatorio de carga abandonada
-- (job carga-reminder) lo usa para avisar por push si pasó X min sin subir el comprobante.
-- Aditivo y nullable: no toca nada existente.

-- AlterTable
ALTER TABLE "ChatConversation" ADD COLUMN "cargaPendingAt" TIMESTAMP(3);
