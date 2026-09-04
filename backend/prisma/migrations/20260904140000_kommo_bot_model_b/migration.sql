-- Bot Kommo Fase 2 (modelo B, auto-carga): identidad del jugador en el casino creada por el bot.
-- Aditivo: columnas nullable.

-- AlterTable
ALTER TABLE "KommoBotState" ADD COLUMN "casinoUsername" TEXT;
ALTER TABLE "KommoBotState" ADD COLUMN "playerId" TEXT;
