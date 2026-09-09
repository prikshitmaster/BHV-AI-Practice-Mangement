-- CreateEnum
CREATE TYPE "EngagementKind" AS ENUM ('ANNUAL_RETAINER', 'AD_HOC');

-- CreateEnum
CREATE TYPE "ClosureKind" AS ENUM ('COMPLETION', 'WITHDRAWAL', 'CANCELLATION', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "LetterReviewState" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'SENT');

-- CreateEnum
CREATE TYPE "AcceptanceKind" AS ENUM ('TYPED_CONSENT', 'ELECTRONIC_ACCEPTANCE', 'LEGALLY_EFFECTIVE_SIGNATURE');

-- CreateEnum
CREATE TYPE "EngagementChangeType" AS ENUM ('SCOPE', 'FEE', 'PERIOD', 'PRACTICE');

-- CreateEnum
CREATE TYPE "ChangeStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "BlockKind" AS ENUM ('INDEPENDENCE', 'ACCEPTANCE', 'FEE_APPROVAL', 'AUTHORITY');

-- AlterTable
ALTER TABLE "Engagement" ADD COLUMN     "billingEntityRegistrationId" TEXT,
ADD COLUMN     "closureAuthorisedByName" TEXT,
ADD COLUMN     "closureKind" "ClosureKind",
ADD COLUMN     "closureReason" TEXT,
ADD COLUMN     "exclusions" TEXT,
ADD COLUMN     "feeBasis" TEXT,
ADD COLUMN     "kind" "EngagementKind" NOT NULL DEFAULT 'AD_HOC',
ADD COLUMN     "parentEngagementId" TEXT,
ADD COLUMN     "plannedEndDate" DATE,
ADD COLUMN     "plannedStartDate" DATE,
ADD COLUMN     "revisionNumber" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "scope" TEXT,
ADD COLUMN     "supersededAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ServiceTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "applicabilityInputs" JSONB NOT NULL,
    "documentChecklist" JSONB NOT NULL,
    "steps" JSONB NOT NULL,
    "roles" JSONB NOT NULL,
    "reviewGates" JSONB NOT NULL,
    "deliverables" JSONB NOT NULL,
    "feeModel" JSONB NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "approvedByName" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngagementLetter" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "templateCode" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "bodySnapshot" JSONB NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "reviewState" "LetterReviewState" NOT NULL DEFAULT 'DRAFT',
    "reviewedByUserId" TEXT,
    "reviewedByName" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "sentVersion" INTEGER,
    "acceptanceKind" "AcceptanceKind",
    "acceptedAt" TIMESTAMP(3),
    "signatoryName" TEXT,
    "signatoryCapacity" TEXT,
    "acceptanceEvidence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EngagementLetter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngagementChange" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "changeType" "EngagementChangeType" NOT NULL,
    "reason" TEXT NOT NULL,
    "beforeSnapshot" JSONB NOT NULL,
    "afterSnapshot" JSONB NOT NULL,
    "requiresFeeReview" BOOLEAN NOT NULL DEFAULT false,
    "requiresAuthorityReview" BOOLEAN NOT NULL DEFAULT false,
    "requiresClientArrangements" BOOLEAN NOT NULL DEFAULT false,
    "clientArrangementsEvidence" TEXT,
    "resultingEngagementId" TEXT,
    "status" "ChangeStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "requestedByUserId" TEXT,
    "requestedByName" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "approvedByName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EngagementChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngagementBlock" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "kind" "BlockKind" NOT NULL,
    "reason" TEXT NOT NULL,
    "raisedByName" TEXT NOT NULL,
    "raisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedByUserId" TEXT,
    "resolvedByName" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,

    CONSTRAINT "EngagementBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceTemplate_tenantId_code_idx" ON "ServiceTemplate"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceTemplate_tenantId_code_version_key" ON "ServiceTemplate"("tenantId", "code", "version");

-- CreateIndex
CREATE INDEX "EngagementLetter_practiceId_engagementId_idx" ON "EngagementLetter"("practiceId", "engagementId");

-- CreateIndex
CREATE UNIQUE INDEX "EngagementLetter_id_practiceId_key" ON "EngagementLetter"("id", "practiceId");

-- CreateIndex
CREATE INDEX "EngagementChange_practiceId_engagementId_idx" ON "EngagementChange"("practiceId", "engagementId");

-- CreateIndex
CREATE INDEX "EngagementBlock_practiceId_engagementId_resolvedAt_idx" ON "EngagementBlock"("practiceId", "engagementId", "resolvedAt");

-- AddForeignKey
ALTER TABLE "Engagement" ADD CONSTRAINT "Engagement_parentEngagementId_fkey" FOREIGN KEY ("parentEngagementId") REFERENCES "Engagement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementLetter" ADD CONSTRAINT "EngagementLetter_engagementId_practiceId_fkey" FOREIGN KEY ("engagementId", "practiceId") REFERENCES "Engagement"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementChange" ADD CONSTRAINT "EngagementChange_engagementId_practiceId_fkey" FOREIGN KEY ("engagementId", "practiceId") REFERENCES "Engagement"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementBlock" ADD CONSTRAINT "EngagementBlock_engagementId_practiceId_fkey" FOREIGN KEY ("engagementId", "practiceId") REFERENCES "Engagement"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;
