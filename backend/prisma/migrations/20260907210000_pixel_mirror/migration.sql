-- Pixel ESPEJO del cliente: respaldo entrenado en paralelo (CAPI + navegador). Distinto de
-- "hidden", que son las sombras internas nuestras.
ALTER TABLE "Pixel" ADD COLUMN "mirror" BOOLEAN NOT NULL DEFAULT false;
