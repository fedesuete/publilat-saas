-- Anti-ban por línea: proxy de salida + rampa de calentamiento (números nuevos).
ALTER TABLE "WaLine" ADD COLUMN "proxyUrl" TEXT;
ALTER TABLE "WaLine" ADD COLUMN "warmupEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "WaLine" ADD COLUMN "warmupStartedAt" TIMESTAMP(3);

-- Las líneas que YA operaron (se emparejaron alguna vez: connected o con número capturado)
-- se consideran "calentando" desde su creación, así quedan fuera de la rampa. Las que nunca
-- se emparejaron quedan en NULL: el webhook les estampa el arranque en su primer connect.
UPDATE "WaLine" SET "warmupStartedAt" = "createdAt" WHERE "connected" = true OR "phone" <> '';
