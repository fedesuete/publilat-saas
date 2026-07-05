-- Ramificación de automatizaciones: posición en el árbol de pasos.
ALTER TABLE "FlowRun" ADD COLUMN "cursor" TEXT NOT NULL DEFAULT '0';
-- Los runs lineales en curso siguen desde su stepIndex.
UPDATE "FlowRun" SET "cursor" = "stepIndex"::text WHERE "status" <> 'done';
