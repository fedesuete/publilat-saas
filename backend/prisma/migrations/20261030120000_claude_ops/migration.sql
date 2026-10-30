-- CreateTable
CREATE TABLE "ClaudeJob" (
    "id" TEXT NOT NULL,
    "numero" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "session" TEXT NOT NULL,
    "groupJid" TEXT NOT NULL,
    "msgId" TEXT NOT NULL,
    "autor" TEXT NOT NULL,
    "autorNombre" TEXT,
    "texto" TEXT NOT NULL,
    "imagenes" JSONB,
    "imagenesEnviadas" INTEGER NOT NULL DEFAULT 0,
    "estado" TEXT NOT NULL DEFAULT 'nuevo',
    "pendiente" TEXT,
    "claudeSession" TEXT,
    "plan" TEXT,
    "resultado" TEXT,
    "aprobadoPor" TEXT,
    "tomadoAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClaudeJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClaudeJob_numero_key" ON "ClaudeJob"("numero");

-- CreateIndex
CREATE INDEX "ClaudeJob_estado_idx" ON "ClaudeJob"("estado");

