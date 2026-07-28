-- Diseño (tema) de la PWA del chat, seleccionable por cliente. Aditivo, default = el actual.
ALTER TABLE "User" ADD COLUMN "chatTheme" TEXT NOT NULL DEFAULT 'whatsapp';
