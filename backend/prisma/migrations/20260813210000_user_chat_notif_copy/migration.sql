-- Copy branded del modal de notificaciones de la PWA (por cuenta). Nullable -> default neutro en el
-- código de la PWA si están vacíos. Aditivo, no cambia nada del comportamiento actual.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "chatNotifTitle" TEXT;
ALTER TABLE "User" ADD COLUMN     "chatNotifText" TEXT;
