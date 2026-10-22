-- Aviso por correo de las cargas calificadas (aditiva: columna nullable).
ALTER TABLE "LandingSubmission" ADD COLUMN     "emailedAt" TIMESTAMP(3);
