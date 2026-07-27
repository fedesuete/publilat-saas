-- Datos de pago estructurados del cajero (para botones "Copiar CBU" / "Copiar Alias"). Aditivo.
ALTER TABLE "User" ADD COLUMN "chatPayCbu" TEXT;
ALTER TABLE "User" ADD COLUMN "chatPayAlias" TEXT;
ALTER TABLE "User" ADD COLUMN "chatPayTitular" TEXT;
