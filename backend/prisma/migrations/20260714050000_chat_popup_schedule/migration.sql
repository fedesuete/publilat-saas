-- Chat App: ventana de programación del popup (desde/hasta). ADITIVO.
ALTER TABLE "User" ADD COLUMN "popupFrom" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "popupUntil" TIMESTAMP(3);
