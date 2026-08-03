-- Toggle del cartel "Instalá la app" dentro del chat. Off por defecto.
ALTER TABLE "User" ADD COLUMN "chatInstallPromptEnabled" BOOLEAN NOT NULL DEFAULT false;
