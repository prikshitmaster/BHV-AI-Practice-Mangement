-- CreateEnum
CREATE TYPE "RetentionDirection" AS ENUM ('RETAIN_AT_LEAST', 'DELETE_AFTER');

-- CreateEnum
CREATE TYPE "RetentionTrigger" AS ENUM ('CREATED', 'ENGAGEMENT_CLOSED', 'FINANCIAL_YEAR_END', 'RELATIONSHIP_ENDED', 'LAST_ACTIVITY');

-- CreateEnum
CREATE TYPE "RetentionCoverage" AS ENUM ('ORIGINAL', 'DERIVATIVE', 'EMAIL', 'AI_OUTPUT', 'ICT_LOG', 'BACKUP');

-- CreateEnum
CREATE TYPE "LegalBasis" AS ENUM ('LEGAL_OBLIGATION', 'PROFESSIONAL_DUTY', 'CONTRACT_PERFORMANCE', 'LEGITIMATE_USE', 'CONSENT');

-- CreateEnum
CREATE TYPE "ProcessingStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "RegulatoryState" AS ENUM ('ENACTED', 'NOTIFIED', 'PROSPECTIVE', 'OPERATIONAL', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "IncidentTrack" AS ENUM ('SECURITY', 'ROUTINE_SUPPORT');

-- CreateEnum
CREATE TYPE "CertInAssessment" AS ENUM ('PENDING', 'APPLICABLE', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "RootCauseStatus" AS ENUM ('UNKNOWN', 'INVESTIGATING', 'IDENTIFIED');

-- CreateEnum
CREATE TYPE "IncidentClockRegime" AS ENUM ('CERT_IN_6H', 'DPDP_AFFECTED_PERSONS', 'DPDP_BOARD_INITIAL', 'DPDP_BOARD_DETAILED_72H');

-- CreateEnum
CREATE TYPE "ErasureState" AS ENUM ('REQUESTED', 'REVIEWED', 'PARTIALLY_ACTIONED', 'ACTIONED', 'ALL_RETAINED');

-- CreateEnum
CREATE TYPE "ErasureItemKind" AS ENUM ('DOCUMENT', 'CONTACT_PHONE', 'CONTACT_EMAIL', 'AUDIT_TRAIL');

-- CreateEnum
CREATE TYPE "ErasureDecision" AS ENUM ('ERASE', 'RETAIN');

-- DropIndex
DROP INDEX "RetentionPolicy_practiceId_recordClass_effectiveFrom_key";

-- AlterTable
ALTER TABLE "RetentionPolicy" ADD COLUMN     "covers" "RetentionCoverage"[] DEFAULT ARRAY['ORIGINAL', 'DERIVATIVE']::"RetentionCoverage"[],
ADD COLUMN     "createdByUserId" TEXT,
ADD COLUMN     "direction" "RetentionDirection" NOT NULL DEFAULT 'RETAIN_AT_LEAST',
ADD COLUMN     "regulatoryRequirementId" TEXT,
ADD COLUMN     "retainDays" INTEGER,
ADD COLUMN     "trigger" "RetentionTrigger" NOT NULL DEFAULT 'CREATED';

-- CreateTable
CREATE TABLE "ProcessingActivity" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "dataCategories" TEXT[],
    "source" TEXT NOT NULL,
    "accessRoles" "PracticeRole"[],
    "recipients" TEXT[],
    "vendor" TEXT,
    "hostingLocation" TEXT NOT NULL,
    "retentionClass" TEXT NOT NULL,
    "legalBasis" "LegalBasis" NOT NULL,
    "legalAuthority" TEXT NOT NULL,
    "noticeReference" TEXT,
    "consentRecordReference" TEXT,
    "status" "ProcessingStatus" NOT NULL DEFAULT 'DRAFT',
    "ownerName" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessingActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegulatoryRequirement" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "instrument" TEXT NOT NULL,
    "state" "RegulatoryState" NOT NULL,
    "sourceReference" TEXT NOT NULL,
    "sourceDate" DATE NOT NULL,
    "effectiveFrom" DATE,
    "effectiveRule" TEXT NOT NULL,
    "supersededByCode" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegulatoryRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegulatoryStateChange" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "fromState" "RegulatoryState",
    "toState" "RegulatoryState" NOT NULL,
    "sourceReference" TEXT NOT NULL,
    "sourceDate" DATE NOT NULL,
    "effectiveFrom" DATE,
    "reason" TEXT NOT NULL,
    "changedByUserId" TEXT NOT NULL,
    "changedByName" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegulatoryStateChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityIncident" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "track" "IncidentTrack" NOT NULL,
    "summary" TEXT NOT NULL,
    "awarenessAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "certInAssessment" "CertInAssessment" NOT NULL DEFAULT 'PENDING',
    "certInCategory" TEXT,
    "certInReason" TEXT,
    "assessedByUserId" TEXT,
    "assessedByName" TEXT,
    "assessedAt" TIMESTAMP(3),
    "rootCause" "RootCauseStatus" NOT NULL DEFAULT 'UNKNOWN',
    "rootCauseNote" TEXT,
    "securityAlertId" TEXT,
    "reportedByUserId" TEXT NOT NULL,
    "reportedByName" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecurityIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentReport" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "regime" "IncidentClockRegime" NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL,
    "reference" TEXT NOT NULL,
    "recordedByUserId" TEXT NOT NULL,
    "recordedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentAwarenessRevision" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "previousAwarenessAt" TIMESTAMP(3) NOT NULL,
    "newAwarenessAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "revisedByUserId" TEXT NOT NULL,
    "revisedByName" TEXT NOT NULL,
    "revisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentAwarenessRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErasureRequest" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "contactId" TEXT,
    "receivedVia" TEXT NOT NULL,
    "requestText" TEXT NOT NULL,
    "state" "ErasureState" NOT NULL DEFAULT 'REQUESTED',
    "requestedByUserId" TEXT NOT NULL,
    "requestedByName" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedByUserId" TEXT,
    "reviewedByName" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "actionedAt" TIMESTAMP(3),
    "outcomeSummary" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ErasureRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErasureItem" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "kind" "ErasureItemKind" NOT NULL,
    "targetId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "mustRetainReason" TEXT,
    "decision" "ErasureDecision",
    "reason" TEXT,
    "actionedAt" TIMESTAMP(3),
    "deletionRequestId" TEXT,

    CONSTRAINT "ErasureItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProcessingActivity_practiceId_name_key" ON "ProcessingActivity"("practiceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessingActivity_id_practiceId_key" ON "ProcessingActivity"("id", "practiceId");

-- CreateIndex
CREATE UNIQUE INDEX "RegulatoryRequirement_practiceId_code_key" ON "RegulatoryRequirement"("practiceId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "RegulatoryRequirement_id_practiceId_key" ON "RegulatoryRequirement"("id", "practiceId");

-- CreateIndex
CREATE INDEX "RegulatoryStateChange_requirementId_changedAt_idx" ON "RegulatoryStateChange"("requirementId", "changedAt");

-- CreateIndex
CREATE INDEX "SecurityIncident_practiceId_closedAt_idx" ON "SecurityIncident"("practiceId", "closedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityIncident_id_practiceId_key" ON "SecurityIncident"("id", "practiceId");

-- CreateIndex
CREATE UNIQUE INDEX "IncidentReport_incidentId_regime_key" ON "IncidentReport"("incidentId", "regime");

-- CreateIndex
CREATE INDEX "ErasureRequest_practiceId_state_idx" ON "ErasureRequest"("practiceId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "ErasureRequest_id_practiceId_key" ON "ErasureRequest"("id", "practiceId");

-- CreateIndex
CREATE UNIQUE INDEX "ErasureItem_requestId_kind_targetId_key" ON "ErasureItem"("requestId", "kind", "targetId");

-- CreateIndex
CREATE INDEX "RetentionPolicy_practiceId_recordClass_idx" ON "RetentionPolicy"("practiceId", "recordClass");

-- CreateIndex
CREATE UNIQUE INDEX "RetentionPolicy_practiceId_recordClass_direction_basis_effe_key" ON "RetentionPolicy"("practiceId", "recordClass", "direction", "basis", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "ProcessingActivity" ADD CONSTRAINT "ProcessingActivity_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegulatoryRequirement" ADD CONSTRAINT "RegulatoryRequirement_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegulatoryStateChange" ADD CONSTRAINT "RegulatoryStateChange_requirementId_practiceId_fkey" FOREIGN KEY ("requirementId", "practiceId") REFERENCES "RegulatoryRequirement"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityIncident" ADD CONSTRAINT "SecurityIncident_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentReport" ADD CONSTRAINT "IncidentReport_incidentId_practiceId_fkey" FOREIGN KEY ("incidentId", "practiceId") REFERENCES "SecurityIncident"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentAwarenessRevision" ADD CONSTRAINT "IncidentAwarenessRevision_incidentId_practiceId_fkey" FOREIGN KEY ("incidentId", "practiceId") REFERENCES "SecurityIncident"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErasureRequest" ADD CONSTRAINT "ErasureRequest_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErasureRequest" ADD CONSTRAINT "ErasureRequest_engagementId_practiceId_fkey" FOREIGN KEY ("engagementId", "practiceId") REFERENCES "Engagement"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErasureItem" ADD CONSTRAINT "ErasureItem_requestId_practiceId_fkey" FOREIGN KEY ("requestId", "practiceId") REFERENCES "ErasureRequest"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;

