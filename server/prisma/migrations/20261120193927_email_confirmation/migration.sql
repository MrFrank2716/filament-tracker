-- AlterTable
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" DATETIME;

-- CreateTable
CREATE TABLE "SignInAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "SignInAttempt_key_at_idx" ON "SignInAttempt"("key", "at");

-- Everyone who registered before confirmation existed keeps working as before. Guests have no address to confirm.
UPDATE "User" SET "emailVerifiedAt" = CURRENT_TIMESTAMP WHERE "isGuest" = false;
