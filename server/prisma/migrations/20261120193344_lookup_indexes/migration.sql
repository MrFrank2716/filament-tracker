-- CreateIndex
CREATE INDEX "Job_workspaceId_completedAt_idx" ON "Job"("workspaceId", "completedAt");

-- CreateIndex
CREATE INDEX "JobRequestFile_requestId_idx" ON "JobRequestFile"("requestId");

-- CreateIndex
CREATE INDEX "JobUsage_jobId_idx" ON "JobUsage"("jobId");

-- CreateIndex
CREATE INDEX "JobUsage_itemId_idx" ON "JobUsage"("itemId");

-- CreateIndex
CREATE INDEX "Location_workspaceId_idx" ON "Location"("workspaceId");

-- CreateIndex
CREATE INDEX "Location_parentId_idx" ON "Location"("parentId");

-- CreateIndex
CREATE INDEX "Machine_workspaceId_idx" ON "Machine"("workspaceId");

-- CreateIndex
CREATE INDEX "MaintenanceLog_machineId_idx" ON "MaintenanceLog"("machineId");

-- CreateIndex
CREATE INDEX "MaintenancePart_logId_idx" ON "MaintenancePart"("logId");

-- CreateIndex
CREATE INDEX "MaintenancePart_itemId_idx" ON "MaintenancePart"("itemId");

-- CreateIndex
CREATE INDEX "MaintenanceTask_workspaceId_idx" ON "MaintenanceTask"("workspaceId");

-- CreateIndex
CREATE INDEX "Membership_workspaceId_idx" ON "Membership"("workspaceId");

-- CreateIndex
CREATE INDEX "StockMovement_workspaceId_createdAt_idx" ON "StockMovement"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_jobId_idx" ON "StockMovement"("jobId");

-- CreateIndex
CREATE INDEX "SubUnit_machineId_idx" ON "SubUnit"("machineId");
