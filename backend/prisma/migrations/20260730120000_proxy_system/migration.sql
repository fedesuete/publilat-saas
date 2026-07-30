-- Sistema de proxies para líneas de WhatsApp (anti-ban). Pool gestionado SOLO por el admin, OCULTO al
-- cliente. Aditivo y backward-compatible: las líneas sin proxyId se conectan igual que hoy; las líneas
-- Cloud API no usan proxy. `Proxy.password` se cifra en reposo (lib/crypto.ts) desde la app.

-- Pool de proxies (admin)
CREATE TABLE "Proxy" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'dataimpulse',
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "protocol" TEXT NOT NULL DEFAULT 'http',
    "country" TEXT,
    "sticky" BOOLEAN NOT NULL DEFAULT true,
    "sessTime" INTEGER NOT NULL DEFAULT 120,
    "maxLines" INTEGER NOT NULL DEFAULT 4,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "healthy" BOOLEAN NOT NULL DEFAULT true,
    "lastCheckAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Proxy_pkey" PRIMARY KEY ("id")
);

-- Auditoría del sistema de proxies (admin)
CREATE TABLE "ProxyEvent" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "proxyId" TEXT,
    "type" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProxyEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProxyEvent_lineId_idx" ON "ProxyEvent"("lineId");
CREATE INDEX "ProxyEvent_createdAt_idx" ON "ProxyEvent"("createdAt");

-- Campos de proxy en la línea (aditivos, nullable; `banned` con default)
ALTER TABLE "WaLine" ADD COLUMN "proxyId" TEXT;
ALTER TABLE "WaLine" ADD COLUMN "proxySession" TEXT;
ALTER TABLE "WaLine" ADD COLUMN "proxyAssignedAt" TIMESTAMP(3);
ALTER TABLE "WaLine" ADD COLUMN "banned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WaLine" ADD COLUMN "lastProxyRotateAt" TIMESTAMP(3);
CREATE INDEX "WaLine_proxyId_idx" ON "WaLine"("proxyId");
ALTER TABLE "WaLine" ADD CONSTRAINT "WaLine_proxyId_fkey" FOREIGN KEY ("proxyId") REFERENCES "Proxy"("id") ON DELETE SET NULL ON UPDATE CASCADE;
