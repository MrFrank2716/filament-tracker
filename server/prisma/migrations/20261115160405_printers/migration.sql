-- AlterTable
ALTER TABLE "Item" ADD COLUMN "tagId" TEXT;

-- AlterTable
ALTER TABLE "SubUnit" ADD COLUMN "externalId" TEXT;

-- CreateTable
CREATE TABLE "Bridge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT,
    "pairingHash" TEXT,
    "pairingExpiresAt" DATETIME,
    "version" TEXT NOT NULL DEFAULT '',
    "platform" TEXT NOT NULL DEFAULT '',
    "capabilities" JSONB NOT NULL,
    "lastSeenAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Bridge_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PrinterLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "bridgeId" TEXT NOT NULL,
    "vendor" TEXT NOT NULL DEFAULT 'bambu',
    "serial" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "modelName" TEXT NOT NULL DEFAULT '',
    "firmware" TEXT NOT NULL DEFAULT '',
    "codeState" TEXT NOT NULL DEFAULT 'ok',
    "lastState" JSONB,
    "lastStateAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PrinterLink_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PrinterLink_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PrinterLink_bridgeId_fkey" FOREIGN KEY ("bridgeId") REFERENCES "Bridge" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Slot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subUnitId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "itemId" TEXT,
    "detected" JSONB,
    "source" TEXT NOT NULL DEFAULT 'manual',
    CONSTRAINT "Slot_subUnitId_fkey" FOREIGN KEY ("subUnitId") REFERENCES "SubUnit" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Slot_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Slot" ("id", "itemId", "label", "position", "subUnitId") SELECT "id", "itemId", "label", "position", "subUnitId" FROM "Slot";
DROP TABLE "Slot";
ALTER TABLE "new_Slot" RENAME TO "Slot";
CREATE UNIQUE INDEX "Slot_itemId_key" ON "Slot"("itemId");
CREATE UNIQUE INDEX "Slot_subUnitId_position_key" ON "Slot"("subUnitId", "position");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Bridge_tokenHash_key" ON "Bridge"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Bridge_pairingHash_key" ON "Bridge"("pairingHash");

-- CreateIndex
CREATE INDEX "Bridge_workspaceId_idx" ON "Bridge"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "PrinterLink_machineId_key" ON "PrinterLink"("machineId");

-- CreateIndex
CREATE INDEX "PrinterLink_bridgeId_idx" ON "PrinterLink"("bridgeId");

-- CreateIndex
CREATE UNIQUE INDEX "PrinterLink_workspaceId_serial_key" ON "PrinterLink"("workspaceId", "serial");

-- CreateIndex
CREATE INDEX "Item_workspaceId_tagId_idx" ON "Item"("workspaceId", "tagId");

-- CreateIndex
CREATE INDEX "SubUnit_workspaceId_externalId_idx" ON "SubUnit"("workspaceId", "externalId");
