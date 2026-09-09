-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RuleStatus') THEN
    CREATE TYPE "RuleStatus" AS ENUM ('DRAFT', 'REVIEWED', 'ACTIVE', 'SUPERSEDED', 'RETIRED');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'GoverningLaw') THEN
    CREATE TYPE "GoverningLaw" AS ENUM ('INCOME_TAX_ACT_1961', 'INCOME_TAX_ACT_2025', 'CGST_ACT_2017', 'COMPANIES_ACT_2013', 'LLP_ACT_2008', 'OTHER');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TaxpayerCategory') THEN
    CREATE TYPE "TaxpayerCategory" AS ENUM ('INDIVIDUAL', 'HUF', 'FIRM', 'LLP', 'COMPANY_PRIVATE', 'COMPANY_PUBLIC', 'TRUST', 'AOP_BOI', 'COOPERATIVE', 'AUDIT_CASE', 'NON_AUDIT_CASE', 'TRANSFER_PRICING_CASE');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AlertKindDue') THEN
    CREATE TYPE "AlertKindDue" AS ENUM ('DUE_SOON', 'OVERDUE', 'ESCALATION', 'CATCH_UP');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DeliveryState') THEN
    CREATE TYPE "DeliveryState" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'BOUNCED', 'FAILED');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ExtensionStatus') THEN
    CREATE TYPE "ExtensionStatus" AS ENUM ('DRAFT', 'PREVIEWED', 'APPLIED', 'WITHDRAWN');
  END IF;
END $$;

-- AlterEnum
BEGIN;
CREATE TYPE "ObligationStatus_new" AS ENUM ('REVIEW_REQUIRED', 'OPEN', 'DUE_SOON', 'OVERDUE', 'WAITING', 'SUBMITTED_AWAITING_ACK', 'FILED', 'REJECTED', 'NOT_APPLICABLE', 'CANCELLED');
ALTER TABLE "public"."Obligation" ALTER COLUMN "status" DROP DEFAULT;
-- DUE04: map the previous statuses onto the new set rather than casting
-- blindly. IN_PROGRESS has no DUE04 equivalent and becomes OPEN; a blind
-- ::text cast would fail on it.
ALTER TABLE "Obligation" ALTER COLUMN "status" TYPE "ObligationStatus_new" USING (
  CASE "status"::text
    WHEN 'IN_PROGRESS' THEN 'OPEN'
    ELSE "status"::text
  END::"ObligationStatus_new"
);
ALTER TYPE "ObligationStatus" RENAME TO "ObligationStatus_old";
ALTER TYPE "ObligationStatus_new" RENAME TO "ObligationStatus";
DROP TYPE "public"."ObligationStatus_old";
ALTER TABLE "Obligation" ALTER COLUMN "status" SET DEFAULT 'REVIEW_REQUIRED';
COMMIT;

-- AlterTable
ALTER TABLE "Obligation" ADD COLUMN IF NOT EXISTS "assessmentYear" TEXT,
ADD COLUMN IF NOT EXISTS "clientDocumentCutoff" DATE,
ADD COLUMN IF NOT EXISTS "formVersion" TEXT,
ADD COLUMN IF NOT EXISTS "governingLaw" "GoverningLaw",
ADD COLUMN IF NOT EXISTS "paymentDeadline" DATE,
ADD COLUMN IF NOT EXISTS "reviewTargetDate" DATE,
ADD COLUMN IF NOT EXISTS "taxYear" TEXT,
ADD COLUMN IF NOT EXISTS "taxpayerCategory" "TaxpayerCategory";

-- AlterTable
ALTER TABLE "ObligationChange" ADD COLUMN IF NOT EXISTS "extensionId" TEXT,
ADD COLUMN IF NOT EXISTS "sourceReference" TEXT;

-- AlterTable
ALTER TABLE "ObligationRule" ADD COLUMN IF NOT EXISTS "approvingCaName" TEXT,
ADD COLUMN IF NOT EXISTS "authoritativeSource" TEXT,
ADD COLUMN IF NOT EXISTS "dueDateExpression" TEXT,
ADD COLUMN IF NOT EXISTS "formVersion" TEXT,
ADD COLUMN IF NOT EXISTS "governingLaw" "GoverningLaw" NOT NULL DEFAULT 'OTHER',
ADD COLUMN IF NOT EXISTS "jurisdiction" TEXT NOT NULL DEFAULT 'IN',
ADD COLUMN IF NOT EXISTS "relevantPeriod" TEXT,
ADD COLUMN IF NOT EXISTS "service" TEXT,
ADD COLUMN IF NOT EXISTS "sourceDate" DATE,
ADD COLUMN IF NOT EXISTS "status" "RuleStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN IF NOT EXISTS "taxpayerCategory" "TaxpayerCategory",
ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE IF NOT EXISTS "StatutoryExtension" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "notificationReference" TEXT NOT NULL,
    "authoritativeSource" TEXT,
    "sourceDate" DATE NOT NULL,
    "jurisdiction" TEXT NOT NULL DEFAULT 'IN',
    "governingLaw" "GoverningLaw",
    "ruleCode" TEXT,
    "taxpayerCategory" "TaxpayerCategory",
    "periodKey" TEXT,
    "formVersion" TEXT,
    "originalDate" DATE NOT NULL,
    "extendedDate" DATE NOT NULL,
    "status" "ExtensionStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedByName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "previewedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "appliedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatutoryExtension_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ObligationAlert" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "kind" "AlertKindDue" NOT NULL,
    "escalationLevel" INTEGER NOT NULL DEFAULT 0,
    "responsibleRole" "PracticeRole",
    "dueAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "deliveryState" "DeliveryState" NOT NULL DEFAULT 'PENDING',
    "deliveryDetail" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedByUserId" TEXT,
    "acknowledgedByName" TEXT,
    "dedupKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ObligationAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "FilingEvidence" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "acknowledgementReference" TEXT NOT NULL,
    "filedAt" TIMESTAMP(3) NOT NULL,
    "portalResponse" JSONB,
    "documentVersionId" TEXT,
    "sourceFileSha256" TEXT,
    "reviewerUserId" TEXT,
    "reviewerName" TEXT NOT NULL,
    "reviewerConfirmedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FilingEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "StatutoryExtension_tenantId_status_idx" ON "StatutoryExtension"("tenantId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ObligationAlert_practiceId_kind_dueAt_idx" ON "ObligationAlert"("practiceId", "kind", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ObligationAlert_dedupKey_key" ON "ObligationAlert"("dedupKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FilingEvidence_practiceId_obligationId_idx" ON "FilingEvidence"("practiceId", "obligationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ObligationRule_status_jurisdiction_idx" ON "ObligationRule"("status", "jurisdiction");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ObligationChange_extensionId_fkey') THEN
    ALTER TABLE "ObligationChange" ADD CONSTRAINT "ObligationChange_extensionId_fkey" FOREIGN KEY ("extensionId") REFERENCES "StatutoryExtension"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ObligationAlert_obligationId_fkey') THEN
    ALTER TABLE "ObligationAlert" ADD CONSTRAINT "ObligationAlert_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "Obligation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FilingEvidence_obligationId_fkey') THEN
    ALTER TABLE "FilingEvidence" ADD CONSTRAINT "FilingEvidence_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "Obligation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
