-- AlterTable
ALTER TABLE "User" ADD COLUMN "themeMode" TEXT NOT NULL DEFAULT 'system';
ALTER TABLE "User" ADD COLUMN "themePreset" TEXT NOT NULL DEFAULT 'graphite';
ALTER TABLE "User" ADD COLUMN "themeAccent" TEXT;
