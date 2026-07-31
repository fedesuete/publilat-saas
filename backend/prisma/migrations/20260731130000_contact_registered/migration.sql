-- Registro completo (CompleteRegistration) por contacto: se marca cuando el operador manda las
-- credenciales (auto-detectado) o desde el override manual. Aditivo y nullable.
ALTER TABLE "Contact" ADD COLUMN "registeredAt" TIMESTAMP(3);
