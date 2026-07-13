-- Landings aisladas en S3+CloudFront (dominio descartable por cliente, anti-quemado).
ALTER TABLE "User" ADD COLUMN "s3Prefix" TEXT;
ALTER TABLE "User" ADD COLUMN "cloudfrontDomain" TEXT;
ALTER TABLE "User" ADD COLUMN "cloudfrontDistId" TEXT;
ALTER TABLE "Landing" ADD COLUMN "publishedAt" TIMESTAMP(3);
