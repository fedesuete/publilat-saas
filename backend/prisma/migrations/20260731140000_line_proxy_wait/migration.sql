-- Estado "esperando proxy": si al crear/recuperar una línea no hay proxy sano, NO conecta por la IP
-- del VPS (anti-ban) → queda en espera y un job la conecta cuando el pool se recupera. Aditivo.
ALTER TABLE "WaLine" ADD COLUMN "proxyWait" BOOLEAN NOT NULL DEFAULT false;
