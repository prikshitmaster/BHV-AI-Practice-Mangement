-- CreateEnum
CREATE TYPE "BackupArtifactKind" AS ENUM ('DATABASE_ROWS', 'DATABASE_NATIVE_DUMP', 'OBJECT_MANIFEST', 'OBJECT_PAYLOAD', 'CONFIGURATION', 'TEMPLATE', 'KEY_INVENTORY', 'AUDIT_EVENTS');

-- CreateEnum
CREATE TYPE "BackupRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "RestoreStatus" AS ENUM ('RUNNING', 'RECONCILING', 'HELD', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "RestoreCheckCategory" AS ENUM ('OBJECT_HASH', 'OBJECT_REFERENCE', 'PERMISSION', 'LEGAL_HOLD', 'ERASURE', 'OBLIGATION', 'RECEIPT_BALANCE', 'OUTBOUND_HOLD', 'AUDIT_CHAIN');

-- CreateEnum
CREATE TYPE "DrillScenario" AS ENUM ('SCHEDULED_QUARTERLY', 'PRIMARY_SERVER_LOSS', 'KEY_SERVICE_UNAVAILABLE', 'SOLE_ADMINISTRATOR_DEPARTED');

-- CreateEnum
CREATE TYPE "MonitoredService" AS ENUM ('DATABASE', 'OBJECT_STORE', 'QUEUE', 'INTERNET', 'EMAIL', 'AI', 'CONNECTOR');

-- CreateEnum
CREATE TYPE "ServiceState" AS ENUM ('OPERATIONAL', 'DEGRADED', 'OFFLINE', 'UNKNOWN');

-- CreateTable
CREATE TABLE "BackupRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "dataAsOf" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "status" "BackupRunStatus" NOT NULL DEFAULT 'RUNNING',
    "failureReason" TEXT,
    "primaryLocation" TEXT NOT NULL,
    "offsiteLocation" TEXT,
    "immutableCopy" BOOLEAN NOT NULL DEFAULT false,
    "encrypted" BOOLEAN NOT NULL DEFAULT true,
    "encryptionKeyId" TEXT,
    "manifestSha256" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL DEFAULT 0,
    "createdByUserId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackupRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupArtifact" (
    "id" TEXT NOT NULL,
    "backupRunId" TEXT NOT NULL,
    "kind" "BackupArtifactKind" NOT NULL,
    "name" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL DEFAULT 0,
    "recordCount" INTEGER,
    "encrypted" BOOLEAN NOT NULL DEFAULT true,
    "storedAt" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackupArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestoreRun" (
    "id" TEXT NOT NULL,
    "backupRunId" TEXT NOT NULL,
    "targetLabel" TEXT NOT NULL,
    "isolated" BOOLEAN NOT NULL,
    "externalSendingDisabled" BOOLEAN NOT NULL,
    "dataAsOf" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usableAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "measuredRpoSeconds" INTEGER,
    "measuredRtoSeconds" INTEGER,
    "rpoTargetSeconds" INTEGER NOT NULL,
    "rtoTargetSeconds" INTEGER NOT NULL,
    "targetsMet" BOOLEAN,
    "outboundHeldFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outboundReleasedAt" TIMESTAMP(3),
    "outboundReleasedByUserId" TEXT,
    "quarantinedOutboundCount" INTEGER NOT NULL DEFAULT 0,
    "status" "RestoreStatus" NOT NULL DEFAULT 'RUNNING',
    "failureReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RestoreRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestoreCheck" (
    "id" TEXT NOT NULL,
    "restoreRunId" TEXT NOT NULL,
    "category" "RestoreCheckCategory" NOT NULL,
    "subject" TEXT NOT NULL,
    "expected" TEXT NOT NULL,
    "actual" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "detail" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RestoreCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestoreDrill" (
    "id" TEXT NOT NULL,
    "restoreRunId" TEXT,
    "scenario" "DrillScenario" NOT NULL,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "performedByUserId" TEXT,
    "achievedRpoSeconds" INTEGER,
    "achievedRtoSeconds" INTEGER,
    "missingItems" TEXT[],
    "exceptions" TEXT[],
    "remediationOwnerUserId" TEXT,
    "remediationOwnerName" TEXT NOT NULL,
    "remediationDueAt" TIMESTAMP(3),
    "remediationClosedAt" TIMESTAMP(3),
    "notes" TEXT,
    "nextDueAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RestoreDrill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceStatusRecord" (
    "id" TEXT NOT NULL,
    "service" "MonitoredService" NOT NULL,
    "state" "ServiceState" NOT NULL DEFAULT 'UNKNOWN',
    "since" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "detail" TEXT,
    "degradedGuidance" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ServiceStatusRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DowntimeWorkRecord" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "recordedByUserId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "service" "MonitoredService",
    "description" TEXT NOT NULL,
    "jobId" TEXT,
    "obligationId" TEXT,
    "reconciledAt" TIMESTAMP(3),
    "reconciledByUserId" TEXT,
    "reconciliationNote" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "DowntimeWorkRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BackupRun_status_dataAsOf_idx" ON "BackupRun"("status", "dataAsOf");

-- CreateIndex
CREATE INDEX "BackupArtifact_kind_sha256_idx" ON "BackupArtifact"("kind", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "BackupArtifact_backupRunId_kind_name_key" ON "BackupArtifact"("backupRunId", "kind", "name");

-- CreateIndex
CREATE INDEX "RestoreRun_status_startedAt_idx" ON "RestoreRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "RestoreCheck_restoreRunId_category_passed_idx" ON "RestoreCheck"("restoreRunId", "category", "passed");

-- CreateIndex
CREATE INDEX "RestoreDrill_scenario_performedAt_idx" ON "RestoreDrill"("scenario", "performedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceStatusRecord_service_key" ON "ServiceStatusRecord"("service");

-- CreateIndex
CREATE INDEX "DowntimeWorkRecord_practiceId_reconciledAt_idx" ON "DowntimeWorkRecord"("practiceId", "reconciledAt");

-- AddForeignKey
ALTER TABLE "BackupArtifact" ADD CONSTRAINT "BackupArtifact_backupRunId_fkey" FOREIGN KEY ("backupRunId") REFERENCES "BackupRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestoreRun" ADD CONSTRAINT "RestoreRun_backupRunId_fkey" FOREIGN KEY ("backupRunId") REFERENCES "BackupRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestoreCheck" ADD CONSTRAINT "RestoreCheck_restoreRunId_fkey" FOREIGN KEY ("restoreRunId") REFERENCES "RestoreRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestoreDrill" ADD CONSTRAINT "RestoreDrill_restoreRunId_fkey" FOREIGN KEY ("restoreRunId") REFERENCES "RestoreRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DowntimeWorkRecord" ADD CONSTRAINT "DowntimeWorkRecord_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
