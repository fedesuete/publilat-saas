-- Cada cuenta puede tener hasta 5 líneas por defecto (antes 1). Más = contactar soporte.
ALTER TABLE "User" ALTER COLUMN "maxLines" SET DEFAULT 5;
-- Sube a 5 a las cuentas que estaban por debajo (preserva las que tienen un plan mayor, ej 30/100).
UPDATE "User" SET "maxLines" = 5 WHERE "maxLines" < 5;
