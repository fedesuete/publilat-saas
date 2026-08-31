-- Variantes rotativas de la respuesta automática a los leads de formularios de Meta: cada lead recibe
-- una al azar (texto o audio de la biblioteca). Evita el patrón "N mensajes idénticos" que WhatsApp
-- detecta como spam, y habilita responder por audio cuando el texto no es opción. Aditivo.

-- AlterTable
ALTER TABLE "Integration" ADD COLUMN "leadgenReplies" JSONB;
