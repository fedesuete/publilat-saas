-- Chat App: link wa.me configurable para el CTA "Escribinos por WhatsApp" del registro un-tap
-- (aditivo: columna nullable).
ALTER TABLE "User" ADD COLUMN "chatWaLink" TEXT;
