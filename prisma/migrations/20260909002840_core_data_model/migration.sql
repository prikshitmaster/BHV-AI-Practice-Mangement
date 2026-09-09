/*
  Warnings:

  - You are about to drop the `HealthCheck` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "PracticeConstitution" AS ENUM ('PROPRIETORSHIP', 'PARTNERSHIP', 'LLP');

-- CreateEnum
CREATE TYPE "RegistrationKind" AS ENUM ('FRN', 'PAN', 'TAN', 'GSTIN');

-- CreateEnum
CREATE TYPE "PracticeRole" AS ENUM ('OWNER', 'PARTNER', 'MANAGER', 'SENIOR', 'ARTICLE', 'ADMIN', 'PORTAL_ONLY');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "PartyType" AS ENUM ('INDIVIDUAL', 'HUF', 'PARTNERSHIP', 'LLP', 'COMPANY', 'TRUST', 'AOP_BOI', 'SOCIETY', 'GOVERNMENT');

-- CreateEnum
CREATE TYPE "IdentifierKind" AS ENUM ('PAN', 'GSTIN', 'CIN', 'LLPIN', 'TAN', 'DIN', 'AADHAAR_LAST4');

-- CreateEnum
CREATE TYPE "AcceptanceStatus" AS ENUM ('PROSPECT', 'ACCEPTED', 'DECLINED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "ConfidentialityClass" AS ENUM ('NORMAL', 'RESTRICTED', 'HIGHLY_RESTRICTED');

-- CreateEnum
CREATE TYPE "ContactAuthorityLevel" AS ENUM ('VIEW_ONLY', 'UPLOAD', 'APPROVE', 'SIGNATORY');

-- CreateEnum
CREATE TYPE "EngagementState" AS ENUM ('DRAFT', 'PENDING_ACCEPTANCE', 'ACCEPTED', 'ACTIVE', 'CLOSED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "JobState" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskState" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ObligationStatus" AS ENUM ('REVIEW_REQUIRED', 'OPEN', 'IN_PROGRESS', 'FILED', 'NOT_APPLICABLE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DocumentSource" AS ENUM ('STAFF_UPLOAD', 'PORTAL_UPLOAD', 'EMAIL_INTAKE', 'SCAN', 'SYSTEM_GENERATED');

-- CreateEnum
CREATE TYPE "ScanVerdict" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'UNSUPPORTED_TYPE');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AllocationKind" AS ENUM ('PAYMENT', 'TDS', 'WRITE_OFF', 'ADVANCE');

-- CreateEnum
CREATE TYPE "ApprovalSubjectType" AS ENUM ('ENGAGEMENT', 'INVOICE', 'DOCUMENT_VERSION', 'OBLIGATION', 'FILING');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "EventResult" AS ENUM ('SUCCESS', 'FAILURE');

-- DropTable
DROP TABLE "HealthCheck";

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Practice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "constitution" "PracticeConstitution" NOT NULL,
    "jurisdictionTimeZone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Practice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeRegistration" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "kind" "RegistrationKind" NOT NULL,
    "value" TEXT NOT NULL,
    "stateCode" TEXT,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "verifiedAt" TIMESTAMP(3),
    "verifiedBy" TEXT,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "PracticeRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeMembership" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "PracticeRole" NOT NULL,
    "branchId" TEXT,
    "teamId" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "grantExpiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "PracticeMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Party" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "type" "PartyType" NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Party_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartyIdentifier" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "kind" "IdentifierKind" NOT NULL,
    "value" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "verifiedBy" TEXT,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "PartyIdentifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientRelationship" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "acceptanceStatus" "AcceptanceStatus" NOT NULL DEFAULT 'PROSPECT',
    "confidentiality" "ConfidentialityClass" NOT NULL DEFAULT 'NORMAL',
    "acceptedAt" TIMESTAMP(3),
    "terminatedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactAuthority" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "clientRelationshipId" TEXT NOT NULL,
    "authority" "ContactAuthorityLevel" NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ContactAuthority_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Engagement" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "clientRelationshipId" TEXT NOT NULL,
    "serviceCode" TEXT NOT NULL,
    "templateVersion" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "ownerUserId" TEXT,
    "reviewerUserId" TEXT,
    "state" "EngagementState" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 0,
    "acceptedSnapshot" JSONB,
    "acceptedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Engagement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "dedupKey" TEXT NOT NULL,
    "state" "JobState" NOT NULL DEFAULT 'NOT_STARTED',
    "version" INTEGER NOT NULL DEFAULT 0,
    "ownerUserId" TEXT,
    "reviewerUserId" TEXT,
    "dueDate" DATE,
    "completedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "state" "TaskState" NOT NULL DEFAULT 'NOT_STARTED',
    "version" INTEGER NOT NULL DEFAULT 0,
    "assigneeUserId" TEXT,
    "dueDate" DATE,
    "completedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistItem" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isComplete" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskDependency" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "dependsOnTaskId" TEXT NOT NULL,

    CONSTRAINT "TaskDependency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObligationRule" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "applicability" JSONB NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ObligationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Obligation" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "clientRelationshipId" TEXT NOT NULL,
    "engagementId" TEXT,
    "ruleId" TEXT NOT NULL,
    "ruleVersion" INTEGER NOT NULL,
    "periodKey" TEXT NOT NULL,
    "originalStatutoryDate" DATE NOT NULL,
    "currentStatutoryDate" DATE NOT NULL,
    "internalTargetDate" DATE,
    "status" "ObligationStatus" NOT NULL DEFAULT 'REVIEW_REQUIRED',
    "version" INTEGER NOT NULL DEFAULT 0,
    "filedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Obligation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObligationChange" (
    "id" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "changedByUserId" TEXT,
    "changedByName" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "beforeMeta" JSONB NOT NULL,
    "afterMeta" JSONB NOT NULL,
    "approvedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ObligationChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "clientRelationshipId" TEXT,
    "engagementId" TEXT,
    "title" TEXT NOT NULL,
    "classification" "ConfidentialityClass" NOT NULL DEFAULT 'NORMAL',
    "retentionUntil" DATE,
    "legalHold" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentVersion" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "storageObjectId" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "source" "DocumentSource" NOT NULL,
    "scanVerdict" "ScanVerdict" NOT NULL DEFAULT 'PENDING',
    "preparedByUserId" TEXT,
    "reviewedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentReleaseGrant" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "documentVersionId" TEXT NOT NULL,
    "grantedToContactId" TEXT,
    "grantedToUserId" TEXT,
    "grantedByUserId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentReleaseGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceSeries" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "registrationId" TEXT,
    "code" TEXT NOT NULL,
    "fiscalPeriod" TEXT NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    "lockedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "InvoiceSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "clientRelationshipId" TEXT NOT NULL,
    "engagementId" TEXT,
    "sequenceNumber" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "taxRuleVersion" TEXT,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "issuedSnapshot" JSONB,
    "issuedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitAmount" DECIMAL(18,2) NOT NULL,
    "taxRatePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(18,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "clientRelationshipId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptAllocation" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "kind" "AllocationKind" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceiptAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "subjectType" "ApprovalSubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "subjectVersion" INTEGER NOT NULL,
    "actorUserId" TEXT,
    "actorDisplayName" TEXT NOT NULL,
    "authority" TEXT NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comments" TEXT,
    "sourceFileSha256" TEXT,
    "externalReference" TEXT,
    "acknowledgedAt" TIMESTAMP(3),

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "practiceId" TEXT,
    "actorUserId" TEXT,
    "actorServiceIdentity" TEXT,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "correlationId" TEXT,
    "beforeMeta" JSONB,
    "afterMeta" JSONB,
    "ruleVersion" TEXT,
    "modelVersion" TEXT,
    "result" "EventResult" NOT NULL,
    "errorMessage" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Practice_tenantId_name_key" ON "Practice"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "PracticeRegistration_id_practiceId_key" ON "PracticeRegistration"("id", "practiceId");

-- CreateIndex
CREATE UNIQUE INDEX "PracticeRegistration_practiceId_kind_value_effectiveFrom_key" ON "PracticeRegistration"("practiceId", "kind", "value", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_id_practiceId_key" ON "Branch"("id", "practiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_practiceId_name_key" ON "Branch"("practiceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Team_id_practiceId_key" ON "Team"("id", "practiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_practiceId_name_key" ON "Team"("practiceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "PracticeMembership_userId_idx" ON "PracticeMembership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PracticeMembership_id_practiceId_key" ON "PracticeMembership"("id", "practiceId");

-- CreateIndex
CREATE UNIQUE INDEX "PracticeMembership_practiceId_userId_role_effectiveFrom_key" ON "PracticeMembership"("practiceId", "userId", "role", "effectiveFrom");

-- CreateIndex
CREATE INDEX "Party_tenantId_legalName_idx" ON "Party"("tenantId", "legalName");

-- CreateIndex
CREATE UNIQUE INDEX "PartyIdentifier_partyId_kind_value_effectiveFrom_key" ON "PartyIdentifier"("partyId", "kind", "value", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "ClientRelationship_id_practiceId_key" ON "ClientRelationship"("id", "practiceId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientRelationship_practiceId_partyId_key" ON "ClientRelationship"("practiceId", "partyId");

-- CreateIndex
CREATE INDEX "ContactAuthority_practiceId_idx" ON "ContactAuthority"("practiceId");

-- CreateIndex
CREATE UNIQUE INDEX "ContactAuthority_clientRelationshipId_contactId_authority_e_key" ON "ContactAuthority"("clientRelationshipId", "contactId", "authority", "effectiveFrom");

-- CreateIndex
CREATE INDEX "Engagement_practiceId_state_idx" ON "Engagement"("practiceId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "Engagement_id_practiceId_key" ON "Engagement"("id", "practiceId");

-- CreateIndex
CREATE INDEX "Job_practiceId_state_idx" ON "Job"("practiceId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "Job_id_practiceId_key" ON "Job"("id", "practiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Job_practiceId_dedupKey_key" ON "Job"("practiceId", "dedupKey");

-- CreateIndex
CREATE INDEX "Task_practiceId_state_idx" ON "Task"("practiceId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "Task_id_practiceId_key" ON "Task"("id", "practiceId");

-- CreateIndex
CREATE INDEX "ChecklistItem_practiceId_idx" ON "ChecklistItem"("practiceId");

-- CreateIndex
CREATE INDEX "TaskDependency_practiceId_idx" ON "TaskDependency"("practiceId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskDependency_taskId_dependsOnTaskId_key" ON "TaskDependency"("taskId", "dependsOnTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "ObligationRule_code_version_key" ON "ObligationRule"("code", "version");

-- CreateIndex
CREATE INDEX "Obligation_practiceId_currentStatutoryDate_idx" ON "Obligation"("practiceId", "currentStatutoryDate");

-- CreateIndex
CREATE UNIQUE INDEX "Obligation_id_practiceId_key" ON "Obligation"("id", "practiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Obligation_practiceId_clientRelationshipId_ruleId_periodKey_key" ON "Obligation"("practiceId", "clientRelationshipId", "ruleId", "periodKey");

-- CreateIndex
CREATE INDEX "ObligationChange_obligationId_createdAt_idx" ON "ObligationChange"("obligationId", "createdAt");

-- CreateIndex
CREATE INDEX "Document_practiceId_classification_idx" ON "Document"("practiceId", "classification");

-- CreateIndex
CREATE UNIQUE INDEX "Document_id_practiceId_key" ON "Document"("id", "practiceId");

-- CreateIndex
CREATE INDEX "DocumentVersion_practiceId_sha256_idx" ON "DocumentVersion"("practiceId", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_id_practiceId_key" ON "DocumentVersion"("id", "practiceId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_documentId_versionNo_key" ON "DocumentVersion"("documentId", "versionNo");

-- CreateIndex
CREATE INDEX "DocumentReleaseGrant_practiceId_expiresAt_idx" ON "DocumentReleaseGrant"("practiceId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceSeries_id_practiceId_key" ON "InvoiceSeries"("id", "practiceId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceSeries_practiceId_code_fiscalPeriod_key" ON "InvoiceSeries"("practiceId", "code", "fiscalPeriod");

-- CreateIndex
CREATE INDEX "Invoice_practiceId_status_idx" ON "Invoice"("practiceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_id_practiceId_key" ON "Invoice"("id", "practiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_seriesId_sequenceNumber_key" ON "Invoice"("seriesId", "sequenceNumber");

-- CreateIndex
CREATE INDEX "InvoiceLine_practiceId_idx" ON "InvoiceLine"("practiceId");

-- CreateIndex
CREATE INDEX "Receipt_practiceId_receivedAt_idx" ON "Receipt"("practiceId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_id_practiceId_key" ON "Receipt"("id", "practiceId");

-- CreateIndex
CREATE INDEX "ReceiptAllocation_practiceId_invoiceId_idx" ON "ReceiptAllocation"("practiceId", "invoiceId");

-- CreateIndex
CREATE INDEX "Approval_practiceId_subjectType_subjectId_idx" ON "Approval"("practiceId", "subjectType", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "Approval_practiceId_subjectType_subjectId_subjectVersion_de_key" ON "Approval"("practiceId", "subjectType", "subjectId", "subjectVersion", "decidedAt");

-- CreateIndex
CREATE INDEX "Event_practiceId_createdAt_idx" ON "Event"("practiceId", "createdAt");

-- CreateIndex
CREATE INDEX "Event_targetType_targetId_idx" ON "Event"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "Event_correlationId_idx" ON "Event"("correlationId");

-- AddForeignKey
ALTER TABLE "Practice" ADD CONSTRAINT "Practice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeRegistration" ADD CONSTRAINT "PracticeRegistration_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeMembership" ADD CONSTRAINT "PracticeMembership_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeMembership" ADD CONSTRAINT "PracticeMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeMembership" ADD CONSTRAINT "PracticeMembership_branchId_practiceId_fkey" FOREIGN KEY ("branchId", "practiceId") REFERENCES "Branch"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeMembership" ADD CONSTRAINT "PracticeMembership_teamId_practiceId_fkey" FOREIGN KEY ("teamId", "practiceId") REFERENCES "Team"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Party" ADD CONSTRAINT "Party_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyIdentifier" ADD CONSTRAINT "PartyIdentifier_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientRelationship" ADD CONSTRAINT "ClientRelationship_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientRelationship" ADD CONSTRAINT "ClientRelationship_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactAuthority" ADD CONSTRAINT "ContactAuthority_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactAuthority" ADD CONSTRAINT "ContactAuthority_clientRelationshipId_practiceId_fkey" FOREIGN KEY ("clientRelationshipId", "practiceId") REFERENCES "ClientRelationship"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Engagement" ADD CONSTRAINT "Engagement_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Engagement" ADD CONSTRAINT "Engagement_clientRelationshipId_practiceId_fkey" FOREIGN KEY ("clientRelationshipId", "practiceId") REFERENCES "ClientRelationship"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_engagementId_practiceId_fkey" FOREIGN KEY ("engagementId", "practiceId") REFERENCES "Engagement"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_jobId_practiceId_fkey" FOREIGN KEY ("jobId", "practiceId") REFERENCES "Job"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_taskId_practiceId_fkey" FOREIGN KEY ("taskId", "practiceId") REFERENCES "Task"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_taskId_practiceId_fkey" FOREIGN KEY ("taskId", "practiceId") REFERENCES "Task"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_dependsOnTaskId_practiceId_fkey" FOREIGN KEY ("dependsOnTaskId", "practiceId") REFERENCES "Task"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Obligation" ADD CONSTRAINT "Obligation_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Obligation" ADD CONSTRAINT "Obligation_clientRelationshipId_practiceId_fkey" FOREIGN KEY ("clientRelationshipId", "practiceId") REFERENCES "ClientRelationship"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Obligation" ADD CONSTRAINT "Obligation_engagementId_practiceId_fkey" FOREIGN KEY ("engagementId", "practiceId") REFERENCES "Engagement"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Obligation" ADD CONSTRAINT "Obligation_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "ObligationRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObligationChange" ADD CONSTRAINT "ObligationChange_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "Obligation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_clientRelationshipId_practiceId_fkey" FOREIGN KEY ("clientRelationshipId", "practiceId") REFERENCES "ClientRelationship"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_engagementId_practiceId_fkey" FOREIGN KEY ("engagementId", "practiceId") REFERENCES "Engagement"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_documentId_practiceId_fkey" FOREIGN KEY ("documentId", "practiceId") REFERENCES "Document"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentReleaseGrant" ADD CONSTRAINT "DocumentReleaseGrant_documentVersionId_practiceId_fkey" FOREIGN KEY ("documentVersionId", "practiceId") REFERENCES "DocumentVersion"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceSeries" ADD CONSTRAINT "InvoiceSeries_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceSeries" ADD CONSTRAINT "InvoiceSeries_registrationId_practiceId_fkey" FOREIGN KEY ("registrationId", "practiceId") REFERENCES "PracticeRegistration"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_seriesId_practiceId_fkey" FOREIGN KEY ("seriesId", "practiceId") REFERENCES "InvoiceSeries"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_clientRelationshipId_practiceId_fkey" FOREIGN KEY ("clientRelationshipId", "practiceId") REFERENCES "ClientRelationship"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_engagementId_practiceId_fkey" FOREIGN KEY ("engagementId", "practiceId") REFERENCES "Engagement"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_practiceId_fkey" FOREIGN KEY ("invoiceId", "practiceId") REFERENCES "Invoice"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_clientRelationshipId_practiceId_fkey" FOREIGN KEY ("clientRelationshipId", "practiceId") REFERENCES "ClientRelationship"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptAllocation" ADD CONSTRAINT "ReceiptAllocation_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptAllocation" ADD CONSTRAINT "ReceiptAllocation_receiptId_practiceId_fkey" FOREIGN KEY ("receiptId", "practiceId") REFERENCES "Receipt"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptAllocation" ADD CONSTRAINT "ReceiptAllocation_invoiceId_practiceId_fkey" FOREIGN KEY ("invoiceId", "practiceId") REFERENCES "Invoice"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
