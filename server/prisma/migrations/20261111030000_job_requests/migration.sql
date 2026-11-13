-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN "requestToken" TEXT;

-- CreateTable
CREATE TABLE "JobRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "machineId" TEXT,
    "title" TEXT NOT NULL,
    "details" TEXT NOT NULL DEFAULT '',
    "requesterName" TEXT NOT NULL,
    "requesterEmail" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewNote" TEXT NOT NULL DEFAULT '',
    "reviewedById" TEXT,
    "reviewedAt" DATETIME,
    "trackToken" TEXT NOT NULL,
    "jobId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "JobRequest_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "JobRequest_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "JobRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "JobRequest_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JobRequestFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JobRequestFile_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "JobRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "JobRequest_trackToken_key" ON "JobRequest"("trackToken");

-- CreateIndex
CREATE UNIQUE INDEX "JobRequest_jobId_key" ON "JobRequest"("jobId");

-- CreateIndex
CREATE INDEX "JobRequest_workspaceId_status_idx" ON "JobRequest"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_requestToken_key" ON "Workspace"("requestToken");

