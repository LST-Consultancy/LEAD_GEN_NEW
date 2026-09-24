-- CreateTable
CREATE TABLE "SupportRequest" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "history" JSONB NOT NULL DEFAULT '[]',
    "diagnostics" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupportRequest_reference_key" ON "SupportRequest"("reference");

-- CreateIndex
CREATE INDEX "SupportRequest_workspaceId_status_idx" ON "SupportRequest"("workspaceId", "status");

-- AddForeignKey
ALTER TABLE "SupportRequest" ADD CONSTRAINT "SupportRequest_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
