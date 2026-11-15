-- CreateTable
CREATE TABLE "PrinterRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "printerLinkId" TEXT NOT NULL,
    "jobId" TEXT,
    "name" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "outcome" TEXT NOT NULL DEFAULT '',
    "filaments" JSONB NOT NULL,
    "usageSource" TEXT NOT NULL DEFAULT '',
    "progress" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "PrinterRun_printerLinkId_fkey" FOREIGN KEY ("printerLinkId") REFERENCES "PrinterLink" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PrinterRun_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Job" (
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
    "priority" INTEGER NOT NULL DEFAULT 0,
    "queuePosition" INTEGER NOT NULL DEFAULT 0,
    "startedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "failureReason" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "Job_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Job_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Job_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Job" ("completedAt", "createdAt", "createdById", "durationHours", "extraCost", "id", "machineCost", "machineId", "materialCost", "name", "notes", "priority", "queuePosition", "startedAt", "status", "toolingCost", "totalCost", "workspaceId") SELECT "completedAt", "createdAt", "createdById", "durationHours", "extraCost", "id", "machineCost", "machineId", "materialCost", "name", "notes", "priority", "queuePosition", "startedAt", "status", "toolingCost", "totalCost", "workspaceId" FROM "Job";
DROP TABLE "Job";
ALTER TABLE "new_Job" RENAME TO "Job";
CREATE INDEX "Job_workspaceId_status_idx" ON "Job"("workspaceId", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "PrinterRun_printerLinkId_endedAt_idx" ON "PrinterRun"("printerLinkId", "endedAt");

-- CreateIndex
CREATE INDEX "PrinterRun_workspaceId_startedAt_idx" ON "PrinterRun"("workspaceId", "startedAt");
