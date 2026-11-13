-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Membership_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Unit_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "website" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "Supplier_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT '',
    "code" TEXT NOT NULL DEFAULT '',
    "parentId" TEXT,
    CONSTRAINT "Location_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Location_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Location" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ItemType" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT 'Package',
    "color" TEXT NOT NULL DEFAULT 'slate',
    "defaultUnitId" TEXT,
    "tracksLife" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ItemType_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ItemType_defaultUnitId_fkey" FOREIGN KEY ("defaultUnitId") REFERENCES "Unit" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CustomField" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "itemTypeId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fieldType" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT '',
    "options" JSONB NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "showInList" BOOLEAN NOT NULL DEFAULT true,
    "isSizeDimension" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "CustomField_itemTypeId_fkey" FOREIGN KEY ("itemTypeId") REFERENCES "ItemType" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "itemTypeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT NOT NULL DEFAULT '',
    "quantity" REAL NOT NULL DEFAULT 0,
    "capacity" REAL,
    "minQuantity" REAL NOT NULL DEFAULT 0,
    "unitCost" REAL NOT NULL DEFAULT 0,
    "unitId" TEXT,
    "supplierId" TEXT,
    "locationId" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "fields" JSONB NOT NULL,
    "usageHours" REAL NOT NULL DEFAULT 0,
    "lifeHours" REAL,
    "wearFlag" BOOLEAN NOT NULL DEFAULT false,
    "isRemnant" BOOLEAN NOT NULL DEFAULT false,
    "parentId" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Item_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Item_itemTypeId_fkey" FOREIGN KEY ("itemTypeId") REFERENCES "ItemType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Item_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Item_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Item_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Item_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Item" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MachineType" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT 'Cog',
    CONSTRAINT "MachineType_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Machine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "machineTypeId" TEXT,
    "name" TEXT NOT NULL,
    "manufacturer" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL DEFAULT '',
    "serial" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'ready',
    "usageHours" REAL NOT NULL DEFAULT 0,
    "hourlyCost" REAL NOT NULL DEFAULT 0,
    "locationId" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Machine_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Machine_machineTypeId_fkey" FOREIGN KEY ("machineTypeId") REFERENCES "MachineType" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Machine_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SubUnit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "machineId" TEXT,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT '',
    "readings" JSONB NOT NULL,
    "statusNote" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "SubUnit_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SubUnit_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Slot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subUnitId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "itemId" TEXT,
    CONSTRAINT "Slot_subUnitId_fkey" FOREIGN KEY ("subUnitId") REFERENCES "SubUnit" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Slot_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MaintenanceTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "machineId" TEXT,
    "machineTypeId" TEXT,
    "intervalDays" REAL,
    "intervalHours" REAL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MaintenanceTask_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MaintenanceTask_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MaintenanceTask_machineTypeId_fkey" FOREIGN KEY ("machineTypeId") REFERENCES "MachineType" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MaintenanceLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "performedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hoursAtService" REAL NOT NULL DEFAULT 0,
    "notes" TEXT NOT NULL DEFAULT '',
    "userId" TEXT,
    CONSTRAINT "MaintenanceLog_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "MaintenanceTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MaintenanceLog_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MaintenanceLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MaintenancePart" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "logId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    CONSTRAINT "MaintenancePart_logId_fkey" FOREIGN KEY ("logId") REFERENCES "MaintenanceLog" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MaintenancePart_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "machineId" TEXT,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "durationHours" REAL NOT NULL DEFAULT 0,
    "notes" TEXT NOT NULL DEFAULT '',
    "extraCost" REAL NOT NULL DEFAULT 0,
    "materialCost" REAL NOT NULL DEFAULT 0,
    "toolingCost" REAL NOT NULL DEFAULT 0,
    "machineCost" REAL NOT NULL DEFAULT 0,
    "totalCost" REAL NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "Job_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Job_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Job_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JobUsage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" REAL NOT NULL DEFAULT 0,
    "hours" REAL NOT NULL DEFAULT 0,
    "cost" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "JobUsage_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "JobUsage_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "delta" REAL NOT NULL,
    "balanceAfter" REAL NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "jobId" TEXT,
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockMovement_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StockMovement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StockMovement_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StockMovement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "_ItemMachineCompatibility" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_ItemMachineCompatibility_A_fkey" FOREIGN KEY ("A") REFERENCES "Item" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_ItemMachineCompatibility_B_fkey" FOREIGN KEY ("B") REFERENCES "Machine" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_workspaceId_key" ON "Membership"("userId", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Unit_workspaceId_symbol_key" ON "Unit"("workspaceId", "symbol");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_workspaceId_name_key" ON "Supplier"("workspaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ItemType_workspaceId_name_key" ON "ItemType"("workspaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "CustomField_itemTypeId_key_key" ON "CustomField"("itemTypeId", "key");

-- CreateIndex
CREATE INDEX "Item_workspaceId_itemTypeId_idx" ON "Item"("workspaceId", "itemTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "MachineType_workspaceId_name_key" ON "MachineType"("workspaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Slot_itemId_key" ON "Slot"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "Slot_subUnitId_position_key" ON "Slot"("subUnitId", "position");

-- CreateIndex
CREATE INDEX "MaintenanceLog_taskId_machineId_performedAt_idx" ON "MaintenanceLog"("taskId", "machineId", "performedAt");

-- CreateIndex
CREATE INDEX "Job_workspaceId_status_idx" ON "Job"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "StockMovement_itemId_createdAt_idx" ON "StockMovement"("itemId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "_ItemMachineCompatibility_AB_unique" ON "_ItemMachineCompatibility"("A", "B");

-- CreateIndex
CREATE INDEX "_ItemMachineCompatibility_B_index" ON "_ItemMachineCompatibility"("B");
