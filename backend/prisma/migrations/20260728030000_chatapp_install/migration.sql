-- Secuencia de instalación del Chat App: mensajes guardados + fotos de tutorial. Aditivo.
ALTER TABLE "User" ADD COLUMN "chatInstallMsg1" TEXT;
ALTER TABLE "User" ADD COLUMN "chatInstallMsg2" TEXT;
ALTER TABLE "User" ADD COLUMN "chatInstallMsg3" TEXT;
ALTER TABLE "User" ADD COLUMN "chatTutIosImg" TEXT;
ALTER TABLE "User" ADD COLUMN "chatTutAndroidImg" TEXT;
