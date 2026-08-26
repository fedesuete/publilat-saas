-- Skins de marca del Chat App (pedido de Gg/mrc): un 2º link de entrada con su propia piel visual,
-- cayendo al MISMO inbox/bot/cajero de la cuenta. Aditivo: tabla nueva + skinId nullable en ChatPlayer.

-- CreateTable
CREATE TABLE "ChatSkin" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "brandName" TEXT,
    "logoUrl" TEXT,
    "primaryColor" TEXT,
    "accentColor" TEXT,
    "chatTheme" TEXT NOT NULL DEFAULT 'whatsapp',
    "welcomeText" TEXT,
    "welcomeMsgText" TEXT,
    "chatDirectWelcome" TEXT,
    "chatPlatformUrl" TEXT,
    "chatNotifTitle" TEXT,
    "chatNotifText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatSkin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChatSkin_slug_key" ON "ChatSkin"("slug");

-- AddForeignKey
ALTER TABLE "ChatSkin" ADD CONSTRAINT "ChatSkin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "ChatPlayer" ADD COLUMN "skinId" TEXT;

-- AddForeignKey
ALTER TABLE "ChatPlayer" ADD CONSTRAINT "ChatPlayer_skinId_fkey" FOREIGN KEY ("skinId") REFERENCES "ChatSkin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
