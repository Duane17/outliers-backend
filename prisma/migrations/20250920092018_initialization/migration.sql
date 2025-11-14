-- CreateEnum
CREATE TYPE "public"."ConnectorType" AS ENUM ('S3', 'GCS', 'AZURE_BLOB', 'POSTGRES', 'BIGQUERY', 'SNOWFLAKE', 'HTTP', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."CollaborationRole" AS ENUM ('PROVIDER', 'CONSUMER', 'BOTH');

-- CreateEnum
CREATE TYPE "public"."JobType" AS ENUM ('SMPC', 'TEE');

-- CreateEnum
CREATE TYPE "public"."JobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "public"."JobEventType" AS ENUM ('QUEUED', 'STARTED', 'PROGRESS', 'COMPLETED', 'FAILED', 'CALLBACK', 'STATUS_CHANGE');

-- CreateEnum
CREATE TYPE "public"."AuditActorType" AS ENUM ('USER', 'API_KEY', 'SYSTEM');

-- CreateTable
CREATE TABLE "public"."Dataset" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "connectorType" "public"."ConnectorType" NOT NULL,
    "resourceUri" TEXT NOT NULL,
    "encManifest" JSONB,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Consent" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "retentionDays" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Collaboration" (
    "id" TEXT NOT NULL,
    "ownerOrgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Collaboration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CollaborationParticipant" (
    "id" TEXT NOT NULL,
    "collaborationId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "role" "public"."CollaborationRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollaborationParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Job" (
    "id" TEXT NOT NULL,
    "collaborationId" TEXT NOT NULL,
    "type" "public"."JobType" NOT NULL,
    "status" "public"."JobStatus" NOT NULL DEFAULT 'PENDING',
    "input" JSONB NOT NULL,
    "artifactUri" TEXT,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."JobEvent" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "type" "public"."JobEventType" NOT NULL,
    "oldStatus" "public"."JobStatus",
    "newStatus" "public"."JobStatus",
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AuditLog" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "actorType" "public"."AuditActorType" NOT NULL,
    "actorUserId" TEXT,
    "actorApiKeyId" TEXT,
    "action" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Dataset_orgId_idx" ON "public"."Dataset"("orgId");

-- CreateIndex
CREATE INDEX "Dataset_connectorType_idx" ON "public"."Dataset"("connectorType");

-- CreateIndex
CREATE INDEX "Dataset_createdAt_idx" ON "public"."Dataset"("createdAt");

-- CreateIndex
CREATE INDEX "Consent_datasetId_idx" ON "public"."Consent"("datasetId");

-- CreateIndex
CREATE INDEX "Consent_jurisdiction_idx" ON "public"."Consent"("jurisdiction");

-- CreateIndex
CREATE INDEX "Collaboration_ownerOrgId_idx" ON "public"."Collaboration"("ownerOrgId");

-- CreateIndex
CREATE INDEX "Collaboration_createdAt_idx" ON "public"."Collaboration"("createdAt");

-- CreateIndex
CREATE INDEX "CollaborationParticipant_orgId_idx" ON "public"."CollaborationParticipant"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "CollaborationParticipant_collaborationId_orgId_key" ON "public"."CollaborationParticipant"("collaborationId", "orgId");

-- CreateIndex
CREATE INDEX "Job_collaborationId_idx" ON "public"."Job"("collaborationId");

-- CreateIndex
CREATE INDEX "Job_status_idx" ON "public"."Job"("status");

-- CreateIndex
CREATE INDEX "Job_createdAt_idx" ON "public"."Job"("createdAt");

-- CreateIndex
CREATE INDEX "JobEvent_jobId_idx" ON "public"."JobEvent"("jobId");

-- CreateIndex
CREATE INDEX "JobEvent_createdAt_idx" ON "public"."JobEvent"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_orgId_idx" ON "public"."AuditLog"("orgId");

-- CreateIndex
CREATE INDEX "AuditLog_actorType_idx" ON "public"."AuditLog"("actorType");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "public"."AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "public"."AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "public"."Dataset" ADD CONSTRAINT "Dataset_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Consent" ADD CONSTRAINT "Consent_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "public"."Dataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Collaboration" ADD CONSTRAINT "Collaboration_ownerOrgId_fkey" FOREIGN KEY ("ownerOrgId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CollaborationParticipant" ADD CONSTRAINT "CollaborationParticipant_collaborationId_fkey" FOREIGN KEY ("collaborationId") REFERENCES "public"."Collaboration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CollaborationParticipant" ADD CONSTRAINT "CollaborationParticipant_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Job" ADD CONSTRAINT "Job_collaborationId_fkey" FOREIGN KEY ("collaborationId") REFERENCES "public"."Collaboration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."JobEvent" ADD CONSTRAINT "JobEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "public"."Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuditLog" ADD CONSTRAINT "AuditLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuditLog" ADD CONSTRAINT "AuditLog_actorApiKeyId_fkey" FOREIGN KEY ("actorApiKeyId") REFERENCES "public"."ApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;
