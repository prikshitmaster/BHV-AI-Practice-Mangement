-- T11 — Document management and evidence custody (PRD §15, DOC01-04 + DOC06).
-- DOC05 (physical register) is R1 and is not created here.
--
-- Purely ADDITIVE: no column is dropped or retyped, and every new column on
-- the existing Document / DocumentVersion tables carries a default, so the
-- rows T02-T10 already wrote survive untouched.
--
-- Written idempotently (guards on every CREATE TYPE / TABLE / INDEX /
-- CONSTRAINT and on the enum additions). Prisma does not wrap a migration in
-- a transaction, so a failure part-way through this file would otherwise
-- leave partial state that blocks a re-run — see the T09 note in PROGRESS.md.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "DocumentKind" AS ENUM ('INTERNAL', 'CLIENT_SUPPLIED', 'APPROVED_DELIVERABLE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "IntakeOutcome" AS ENUM ('ACCEPTED', 'QUARANTINED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "RejectionReason" AS ENUM ('NONE', 'DISALLOWED_TYPE', 'MIME_MISMATCH', 'TOO_LARGE', 'EMPTY_FILE', 'DECOMPRESSION_LIMIT', 'ENCRYPTED_ARCHIVE', 'MALWARE_SIGNATURE', 'SCANNER_UNAVAILABLE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "VersionStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'SUPERSEDED', 'WITHDRAWN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "DerivationKind" AS ENUM ('ORIGINAL', 'OCR', 'CONVERSION', 'REDACTION', 'COMPRESSION');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ClassificationStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'REJECTED', 'CORRECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "DocumentSetState" AS ENUM ('OPEN', 'FINALISED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "DeletionState" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'EXECUTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ScanVerdict" ADD VALUE IF NOT EXISTS 'SUSPICIOUS';
ALTER TYPE "ScanVerdict" ADD VALUE IF NOT EXISTS 'SCAN_UNAVAILABLE';

-- AlterTable
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "documentSetId" TEXT,
ADD COLUMN IF NOT EXISTS "documentType" TEXT,
ADD COLUMN IF NOT EXISTS "kind" "DocumentKind" NOT NULL DEFAULT 'INTERNAL',
ADD COLUMN IF NOT EXISTS "lockedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "lockedByUserId" TEXT,
ADD COLUMN IF NOT EXISTS "obligationId" TEXT,
ADD COLUMN IF NOT EXISTS "periodEnd" DATE,
ADD COLUMN IF NOT EXISTS "periodLabel" TEXT,
ADD COLUMN IF NOT EXISTS "periodStart" DATE,
ADD COLUMN IF NOT EXISTS "retentionBasis" TEXT,
ADD COLUMN IF NOT EXISTS "retentionPolicyId" TEXT,
ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "workingPaper" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "DocumentVersion" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "approvedByUserId" TEXT,
ADD COLUMN IF NOT EXISTS "approvedByUserName" TEXT,
ADD COLUMN IF NOT EXISTS "declaredMimeType" TEXT,
ADD COLUMN IF NOT EXISTS "derivation" "DerivationKind" NOT NULL DEFAULT 'ORIGINAL',
ADD COLUMN IF NOT EXISTS "derivedFromVersionId" TEXT,
ADD COLUMN IF NOT EXISTS "filename" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "status" "VersionStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN IF NOT EXISTS "supersededAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DocumentIntake" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "documentId" TEXT,
    "documentVersionId" TEXT,
    "clientRelationshipId" TEXT,
    "engagementId" TEXT,
    "obligationId" TEXT,
    "checklistItemId" TEXT,
    "clientRequestId" TEXT,
    "periodLabel" TEXT,
    "filename" TEXT NOT NULL,
    "declaredMimeType" TEXT NOT NULL,
    "detectedMimeType" TEXT,
    "sizeBytes" BIGINT NOT NULL,
    "sha256" TEXT,
    "source" "DocumentSource" NOT NULL,
    "uploadedByUserId" TEXT,
    "uploadedByContactId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" "IntakeOutcome" NOT NULL,
    "rejectionReason" "RejectionReason" NOT NULL DEFAULT 'NONE',
    "rejectionDetail" TEXT,
    "scanVerdict" "ScanVerdict" NOT NULL DEFAULT 'PENDING',
    "scannerName" TEXT,
    "scannerVersion" TEXT,
    "quarantineObjectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentIntake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DocumentClassification" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "documentVersionId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "producedBy" TEXT NOT NULL,
    "modelVersion" TEXT,
    "sourceReference" TEXT,
    "status" "ClassificationStatus" NOT NULL DEFAULT 'DRAFT',
    "supersedesId" TEXT,
    "decidedByUserId" TEXT,
    "decidedByUserName" TEXT,
    "decidedAt" TIMESTAMP(3),
    "correctionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentClassification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DocumentRelease" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "documentVersionId" TEXT NOT NULL,
    "releasedByUserId" TEXT NOT NULL,
    "releasedByUserName" TEXT NOT NULL,
    "reason" TEXT,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "revokeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentRelease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DocumentReleaseRecipient" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "clientRelationshipId" TEXT NOT NULL,
    "contactNameAtRelease" TEXT NOT NULL,

    CONSTRAINT "DocumentReleaseRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DocumentAccessToken" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "documentVersionId" TEXT NOT NULL,
    "releaseId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "issuedToUserId" TEXT,
    "issuedToContactId" TEXT,
    "issuedByUserId" TEXT,
    "purpose" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentAccessToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "RedactionReview" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "documentVersionId" TEXT NOT NULL,
    "sourceVersionId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "checkedHiddenText" BOOLEAN NOT NULL DEFAULT false,
    "checkedMetadata" BOOLEAN NOT NULL DEFAULT false,
    "checkedAttachments" BOOLEAN NOT NULL DEFAULT false,
    "checkedOcrLayer" BOOLEAN NOT NULL DEFAULT false,
    "reviewedByUserId" TEXT NOT NULL,
    "reviewedByUserName" TEXT NOT NULL,
    "conclusion" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RedactionReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DocumentSet" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "engagementId" TEXT,
    "clientRelationshipId" TEXT,
    "name" TEXT NOT NULL,
    "state" "DocumentSetState" NOT NULL DEFAULT 'OPEN',
    "manifest" JSONB,
    "manifestSha256" TEXT,
    "finalisedAt" TIMESTAMP(3),
    "finalisedByUserId" TEXT,
    "finalisedByUserName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DocumentSetEntry" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "documentSetId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "documentVersionId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentSetEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "RetentionPolicy" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "recordClass" TEXT NOT NULL,
    "retainYears" INTEGER NOT NULL,
    "basis" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetentionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LegalHold" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "scopeDocumentId" TEXT,
    "scopeEngagementId" TEXT,
    "scopeClientRelationshipId" TEXT,
    "placedByUserId" TEXT NOT NULL,
    "placedByUserName" TEXT NOT NULL,
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "releasedByUserId" TEXT,
    "releaseReason" TEXT,

    CONSTRAINT "LegalHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DeletionRequest" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,
    "eligibilityCheckedAt" TIMESTAMP(3),
    "eligible" BOOLEAN,
    "ineligibleReason" TEXT,
    "state" "DeletionState" NOT NULL DEFAULT 'REQUESTED',
    "approvedByUserId" TEXT,
    "approvedByUserName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "executedAt" TIMESTAMP(3),
    "backupExpiryNote" TEXT,

    CONSTRAINT "DeletionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DocumentIntake_practiceId_receivedAt_idx" ON "DocumentIntake"("practiceId", "receivedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DocumentIntake_practiceId_outcome_idx" ON "DocumentIntake"("practiceId", "outcome");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DocumentClassification_practiceId_documentVersionId_field_idx" ON "DocumentClassification"("practiceId", "documentVersionId", "field");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DocumentRelease_practiceId_documentId_idx" ON "DocumentRelease"("practiceId", "documentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DocumentReleaseRecipient_practiceId_contactId_idx" ON "DocumentReleaseRecipient"("practiceId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "DocumentReleaseRecipient_releaseId_contactId_key" ON "DocumentReleaseRecipient"("releaseId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "DocumentAccessToken_tokenHash_key" ON "DocumentAccessToken"("tokenHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DocumentAccessToken_practiceId_expiresAt_idx" ON "DocumentAccessToken"("practiceId", "expiresAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DocumentAccessToken_issuedToUserId_idx" ON "DocumentAccessToken"("issuedToUserId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RedactionReview_practiceId_idx" ON "RedactionReview"("practiceId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "RedactionReview_documentVersionId_practiceId_key" ON "RedactionReview"("documentVersionId", "practiceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DocumentSet_practiceId_state_idx" ON "DocumentSet"("practiceId", "state");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "DocumentSet_id_practiceId_key" ON "DocumentSet"("id", "practiceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DocumentSetEntry_practiceId_idx" ON "DocumentSetEntry"("practiceId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "DocumentSetEntry_documentSetId_documentVersionId_key" ON "DocumentSetEntry"("documentSetId", "documentVersionId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "RetentionPolicy_practiceId_recordClass_effectiveFrom_key" ON "RetentionPolicy"("practiceId", "recordClass", "effectiveFrom");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LegalHold_practiceId_releasedAt_idx" ON "LegalHold"("practiceId", "releasedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DeletionRequest_practiceId_state_idx" ON "DeletionRequest"("practiceId", "state");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Document_practiceId_kind_idx" ON "Document"("practiceId", "kind");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Document_practiceId_documentType_idx" ON "Document"("practiceId", "documentType");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Document_practiceId_title_idx" ON "Document"("practiceId", "title");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DocumentVersion_practiceId_status_idx" ON "DocumentVersion"("practiceId", "status");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Document" ADD CONSTRAINT "Document_obligationId_practiceId_fkey" FOREIGN KEY ("obligationId", "practiceId") REFERENCES "Obligation"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Document" ADD CONSTRAINT "Document_documentSetId_practiceId_fkey" FOREIGN KEY ("documentSetId", "practiceId") REFERENCES "DocumentSet"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_derivedFromVersionId_practiceId_fkey" FOREIGN KEY ("derivedFromVersionId", "practiceId") REFERENCES "DocumentVersion"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "DocumentIntake" ADD CONSTRAINT "DocumentIntake_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "DocumentIntake" ADD CONSTRAINT "DocumentIntake_clientRelationshipId_practiceId_fkey" FOREIGN KEY ("clientRelationshipId", "practiceId") REFERENCES "ClientRelationship"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "DocumentIntake" ADD CONSTRAINT "DocumentIntake_engagementId_practiceId_fkey" FOREIGN KEY ("engagementId", "practiceId") REFERENCES "Engagement"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "DocumentClassification" ADD CONSTRAINT "DocumentClassification_documentVersionId_practiceId_fkey" FOREIGN KEY ("documentVersionId", "practiceId") REFERENCES "DocumentVersion"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "DocumentClassification" ADD CONSTRAINT "DocumentClassification_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "DocumentClassification"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "DocumentRelease" ADD CONSTRAINT "DocumentRelease_documentVersionId_practiceId_fkey" FOREIGN KEY ("documentVersionId", "practiceId") REFERENCES "DocumentVersion"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "DocumentReleaseRecipient" ADD CONSTRAINT "DocumentReleaseRecipient_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "DocumentRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "DocumentReleaseRecipient" ADD CONSTRAINT "DocumentReleaseRecipient_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "DocumentAccessToken" ADD CONSTRAINT "DocumentAccessToken_documentVersionId_practiceId_fkey" FOREIGN KEY ("documentVersionId", "practiceId") REFERENCES "DocumentVersion"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "DocumentAccessToken" ADD CONSTRAINT "DocumentAccessToken_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "DocumentRelease"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "RedactionReview" ADD CONSTRAINT "RedactionReview_documentVersionId_practiceId_fkey" FOREIGN KEY ("documentVersionId", "practiceId") REFERENCES "DocumentVersion"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "DocumentSet" ADD CONSTRAINT "DocumentSet_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "DocumentSetEntry" ADD CONSTRAINT "DocumentSetEntry_documentSetId_practiceId_fkey" FOREIGN KEY ("documentSetId", "practiceId") REFERENCES "DocumentSet"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "DocumentSetEntry" ADD CONSTRAINT "DocumentSetEntry_documentId_practiceId_fkey" FOREIGN KEY ("documentId", "practiceId") REFERENCES "Document"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "DocumentSetEntry" ADD CONSTRAINT "DocumentSetEntry_documentVersionId_practiceId_fkey" FOREIGN KEY ("documentVersionId", "practiceId") REFERENCES "DocumentVersion"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "RetentionPolicy" ADD CONSTRAINT "RetentionPolicy_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "LegalHold" ADD CONSTRAINT "LegalHold_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "DeletionRequest" ADD CONSTRAINT "DeletionRequest_documentId_practiceId_fkey" FOREIGN KEY ("documentId", "practiceId") REFERENCES "Document"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
