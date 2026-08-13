-- API key del casino POR CUENTA (partner-api multi-tenant). Cifrada en reposo. Si está seteada, la
-- cuenta opera su propio tenant del casino; si no, cae a la key global del .env (legacy, ej. mrchcod).
-- Aditivo, nullable -> el comportamiento actual (key global) queda idéntico hasta cargar una por cuenta.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "casinoApiKey" TEXT;
