-- Sonido custom del panel (operador) al llegar un mensaje nuevo. URL de un BrandingAsset (audio) que
-- sube el operador desde Configuración. Aditivo, nullable -> sin sonido custom, el panel usa el "ding".

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "notifSoundUrl" TEXT;
