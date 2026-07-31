-- Embudo de eventos a Meta: el Lead se dispara en el 1er INBOUND real (no en el clic).
-- Default false = comportamiento actual (Lead en el clic) para NO tocar a los clientes que funcionan.
-- Se prende SOLO para victor (piloto). Aditivo y backward-compatible.
ALTER TABLE "User" ADD COLUMN "leadOnInbound" BOOLEAN NOT NULL DEFAULT false;
UPDATE "User" SET "leadOnInbound" = true WHERE "slug" = 'victor';
