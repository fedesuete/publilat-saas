-- Lector de comprobantes en modo AUTO para TODOS los clientes + default auto (pedido del dueño).
-- auto = dispara Purchase a Meta al leer un comprobante con confianza alta (>=0.7) y monto > 0.
-- Reversible por cliente (Detección de pago -> off/assisted).
ALTER TABLE "User" ALTER COLUMN "paymentDetection" SET DEFAULT 'auto';
UPDATE "User" SET "paymentDetection" = 'auto' WHERE "paymentDetection" <> 'auto';
