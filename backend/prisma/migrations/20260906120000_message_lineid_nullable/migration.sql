-- La conversacion SOBREVIVE a la linea: lineId pasa a nullable para que "Eliminar linea"
-- no tenga que borrar los mensajes (perdida de historial del CRM).
ALTER TABLE "Message" ALTER COLUMN "lineId" DROP NOT NULL;
