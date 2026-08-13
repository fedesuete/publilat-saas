-- Pixel "sombra" server-side: recibe una COPIA de los eventos CAPI del usuario pero queda oculto del
-- dashboard "Mi Pixel" (no se lista/edita/borra desde ahí). Se carga a mano por SQL. Aditivo: columna
-- con default false -> el comportamiento de todos los pixeles existentes queda idéntico.

-- AlterTable
ALTER TABLE "Pixel" ADD COLUMN     "hidden" BOOLEAN NOT NULL DEFAULT false;
