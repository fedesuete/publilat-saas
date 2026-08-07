-- Contact.code deja de ser único GLOBAL y pasa a único POR usuario (userId, code): dos clientes pueden
-- generar el mismo `ref:` sin que el create explote (P2002) y se pierda el lead. Es una migración de
-- CONSTRAINT (drop del índice global + create del compuesto), no aditiva pura, pero sin riesgo de
-- violación: el unique global garantizaba que hoy no hay códigos duplicados, así que (userId, code)
-- tampoco los tiene. Los contactos sin código (code NULL) no chocan (NULLs son distintos en Postgres).

-- DropIndex
DROP INDEX "Contact_code_key";

-- CreateIndex
CREATE UNIQUE INDEX "Contact_userId_code_key" ON "Contact"("userId", "code");
