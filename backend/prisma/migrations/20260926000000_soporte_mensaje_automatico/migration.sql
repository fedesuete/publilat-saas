-- Marca los mensajes que manda el robot (acuse automático). Sin esto, un acuse hace que el ticket
-- PAREZCA respondido y el cliente queda esperando sin que nadie lo vea. Aditivo.
ALTER TABLE "SupportMessage" ADD COLUMN IF NOT EXISTS "auto" BOOLEAN NOT NULL DEFAULT false;
