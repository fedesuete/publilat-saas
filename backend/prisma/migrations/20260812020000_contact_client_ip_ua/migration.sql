-- Guarda la IP y el user agent del visitante de la landing (sesión web original) en el Contact,
-- para poder mandarlos en el Purchase por CAPI (client_ip_address + client_user_agent juntos) y subir
-- el match quality. Aditivo: columnas nullable. Se popula en /go; el Lead no cambia.

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "clientIp" TEXT,
ADD COLUMN     "clientUserAgent" TEXT;
