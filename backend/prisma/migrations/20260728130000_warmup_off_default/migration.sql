-- Calentamiento (warmup) de líneas OFF por default + apagarlo en TODAS las líneas existentes.
-- Pedido del dueño: daba el error de "cupo de envíos" a los clientes. Se reactiva por línea en Admin.
ALTER TABLE "WaLine" ALTER COLUMN "warmupEnabled" SET DEFAULT false;
UPDATE "WaLine" SET "warmupEnabled" = false WHERE "warmupEnabled" = true;
