-- Moneda de las ventas del cliente (value/currency del Purchase a Meta). Default ARS.
ALTER TABLE "User" ADD COLUMN "purchaseCurrency" TEXT NOT NULL DEFAULT 'ARS';
