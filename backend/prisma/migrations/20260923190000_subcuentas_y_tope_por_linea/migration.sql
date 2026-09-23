-- Sub-cuentas: un cliente puede tener cuentas hijas (con SUS líneas/landings/contactos) y entrar a
-- manejarlas desde su panel. Y tope diario de la rotación por línea: cuántas personas como máximo
-- mandamos a cada número por día. Todo ADITIVO (columnas con default): nada cambia para quien no lo usa.
ALTER TABLE "User" ADD COLUMN "parentUserId" TEXT;
ALTER TABLE "User" ADD COLUMN "maxSubAccounts" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS "User_parentUserId_idx" ON "User"("parentUserId");

ALTER TABLE "WaLine" ADD COLUMN "dailyCap" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WaLine" ADD COLUMN "routedToday" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WaLine" ADD COLUMN "routedTodayAt" TIMESTAMP(3);
