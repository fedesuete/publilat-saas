-- Cargas del formulario de landings B2B (aditiva: tabla nueva).
-- CreateTable
CREATE TABLE "LandingSubmission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "landing" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "nombre" TEXT,
    "telefono" TEXT,
    "pais" TEXT,
    "respuestas" JSONB NOT NULL DEFAULT '{}',
    "califica" BOOLEAN NOT NULL,
    "motivo" TEXT,
    "fbclid" TEXT,
    "fbp" TEXT,
    "fbc" TEXT,
    "utm" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "externalId" TEXT NOT NULL,
    "contactId" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "submitEvent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LandingSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LandingSubmission_ref_key" ON "LandingSubmission"("ref");

-- CreateIndex
CREATE INDEX "LandingSubmission_userId_createdAt_idx" ON "LandingSubmission"("userId", "createdAt");
