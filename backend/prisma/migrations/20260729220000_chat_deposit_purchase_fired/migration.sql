-- Idempotencia del Purchase por carga del Chat App: marca cuándo se disparó el Purchase a Meta,
-- para no mandarlo dos veces (al leer el comprobante con IA y luego al aprobar la carga).
-- OJO: mandar el Purchase a Meta es SOLO la señal de marketing; NO acredita fichas (eso sigue
-- gateado por el operador que aprueba, o por el webhook de gateway real — regla §9.2).
ALTER TABLE "ChatDeposit" ADD COLUMN "purchaseFiredAt" TIMESTAMP(3);
