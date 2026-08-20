-- IDs del clic de Meta en la cuenta (landing de ventas de Publi.lat): cierran el loop del pixel
-- Clientes-publilat (Lead al alta + Purchase al pagar, atados al anuncio). Aditivo y nullable.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "fbp" TEXT;
ALTER TABLE "User" ADD COLUMN "fbc" TEXT;
ALTER TABLE "User" ADD COLUMN "fbclid" TEXT;
