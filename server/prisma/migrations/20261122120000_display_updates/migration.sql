-- AlterTable
ALTER TABLE "Device" ADD COLUMN "updateTo" TEXT;
ALTER TABLE "Device" ADD COLUMN "updateStartedAt" DATETIME;
ALTER TABLE "Device" ADD COLUMN "updateError" TEXT;
