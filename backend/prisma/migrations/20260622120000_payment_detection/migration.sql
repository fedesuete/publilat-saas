-- AlterTable
ALTER TABLE "User" ADD COLUMN "paymentDetection" TEXT NOT NULL DEFAULT 'off';

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "paymentDetected" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Contact" ADD COLUMN "paymentDetectedAmount" INTEGER;
ALTER TABLE "Contact" ADD COLUMN "paymentDetectedAt" TIMESTAMP(3);
