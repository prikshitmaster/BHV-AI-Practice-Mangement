-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('UNVERIFIED', 'FORMAT_CHECKED', 'PENDING_VERIFICATION', 'VERIFIED', 'FAILED_VERIFICATION');

-- CreateEnum
CREATE TYPE "FieldSource" AS ENUM ('MANUAL_ENTRY', 'BULK_IMPORT', 'PORTAL_UPLOAD', 'CLIENT_DECLARATION', 'GOVERNMENT_PORTAL', 'DOCUMENT_EXTRACTION');

-- CreateEnum
CREATE TYPE "ChangeRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AcceptanceDecision" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "designation" TEXT,
ADD COLUMN     "emailVerificationStatus" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
ADD COLUMN     "phoneVerificationStatus" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
ADD COLUMN     "source" "FieldSource" NOT NULL DEFAULT 'MANUAL_ENTRY';

-- AlterTable
ALTER TABLE "PartyIdentifier" ADD COLUMN     "label" TEXT,
ADD COLUMN     "source" "FieldSource" NOT NULL DEFAULT 'MANUAL_ENTRY',
ADD COLUMN     "sourceEvidence" TEXT,
ADD COLUMN     "stateCode" TEXT,
ADD COLUMN     "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED';

-- CreateTable
CREATE TABLE "PartyGroupLink" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "parentPartyId" TEXT NOT NULL,
    "childPartyId" TEXT NOT NULL,
    "relationshipType" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "PartyGroupLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactChangeRequest" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT NOT NULL,
    "requestedByUserId" TEXT,
    "requestedByContactId" TEXT,
    "requestedByName" TEXT NOT NULL,
    "source" "FieldSource" NOT NULL,
    "sourceEvidence" TEXT,
    "status" "ChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "decidedByUserId" TEXT,
    "decidedByName" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcceptanceCheck" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "clientRelationshipId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "competenceAssessment" TEXT NOT NULL,
    "resourcesAssessment" TEXT NOT NULL,
    "ethicalThreats" TEXT NOT NULL,
    "independenceAssessment" TEXT,
    "predecessorCommunication" TEXT,
    "clientAuthority" TEXT NOT NULL,
    "conflictSummary" JSONB NOT NULL,
    "decision" "AcceptanceDecision" NOT NULL DEFAULT 'PENDING',
    "partnerUserId" TEXT,
    "partnerName" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcceptanceCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntakeDraft" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "serviceCode" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "missingFields" TEXT[],
    "createdByUserId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "discardedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntakeDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartyGroupLink_tenantId_idx" ON "PartyGroupLink"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "PartyGroupLink_parentPartyId_childPartyId_relationshipType_key" ON "PartyGroupLink"("parentPartyId", "childPartyId", "relationshipType");

-- CreateIndex
CREATE INDEX "ContactChangeRequest_practiceId_status_idx" ON "ContactChangeRequest"("practiceId", "status");

-- CreateIndex
CREATE INDEX "ContactChangeRequest_contactId_createdAt_idx" ON "ContactChangeRequest"("contactId", "createdAt");

-- CreateIndex
CREATE INDEX "AcceptanceCheck_practiceId_decision_idx" ON "AcceptanceCheck"("practiceId", "decision");

-- CreateIndex
CREATE INDEX "IntakeDraft_practiceId_createdByUserId_idx" ON "IntakeDraft"("practiceId", "createdByUserId");

-- CreateIndex
CREATE INDEX "PartyIdentifier_kind_value_idx" ON "PartyIdentifier"("kind", "value");

-- AddForeignKey
ALTER TABLE "PartyGroupLink" ADD CONSTRAINT "PartyGroupLink_parentPartyId_fkey" FOREIGN KEY ("parentPartyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyGroupLink" ADD CONSTRAINT "PartyGroupLink_childPartyId_fkey" FOREIGN KEY ("childPartyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactChangeRequest" ADD CONSTRAINT "ContactChangeRequest_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcceptanceCheck" ADD CONSTRAINT "AcceptanceCheck_clientRelationshipId_practiceId_fkey" FOREIGN KEY ("clientRelationshipId", "practiceId") REFERENCES "ClientRelationship"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;
