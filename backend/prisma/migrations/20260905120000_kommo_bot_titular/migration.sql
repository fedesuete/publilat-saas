-- Bot Kommo estilo raul: el nombre completo del jugador (como figura en su banco) queda VINCULADO a su
-- usuario del casino al registrarse — es la llave del matcheo de sus transferencias. Aditivo.

-- AlterTable
ALTER TABLE "KommoBotState" ADD COLUMN "titular" TEXT;
