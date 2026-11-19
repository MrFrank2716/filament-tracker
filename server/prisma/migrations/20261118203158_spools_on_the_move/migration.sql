-- AlterTable
ALTER TABLE "Item" ADD COLUMN "outSince" DATETIME;

-- CreateTable
CREATE TABLE "UnknownTag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "deviceId" TEXT,
    "tagId" TEXT NOT NULL,
    "detected" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UnknownTag_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UnknownTag_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "UnknownTag_workspaceId_tagId_key" ON "UnknownTag"("workspaceId", "tagId");

-- CreateIndex
CREATE INDEX "Item_workspaceId_outSince_idx" ON "Item"("workspaceId", "outSince");
