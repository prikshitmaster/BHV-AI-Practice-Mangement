-- CreateEnum
CREATE TYPE "ShareSubjectType" AS ENUM ('DOCUMENT_VERSION', 'CONTACT_FIELD');

-- AlterTable
ALTER TABLE "Practice" ADD COLUMN     "documentNamespace" TEXT,
ADD COLUMN     "identifierHolderName" TEXT,
ADD COLUMN     "identifierHolderVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "practiceGroupId" TEXT,
ADD COLUMN     "readOnlyFrom" TIMESTAMP(3),
ADD COLUMN     "registeredDisplayName" TEXT;

-- Backfill documentNamespace for practices that predate ORG04, then enforce
-- NOT NULL. Uses the practice id so the value is unique and stable.
UPDATE "Practice" SET "documentNamespace" = 'practice-' || "id" WHERE "documentNamespace" IS NULL;
ALTER TABLE "Practice" ALTER COLUMN "documentNamespace" SET NOT NULL;


-- CreateTable
CREATE TABLE "PracticeGroup" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PracticeGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeAddress" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'IN',
    "isRegisteredOffice" BOOLEAN NOT NULL DEFAULT false,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "verifiedAt" TIMESTAMP(3),
    "verifiedBy" TEXT,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "PracticeAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeBankAccount" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "ifsc" TEXT NOT NULL,
    "branchName" TEXT,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "verifiedAt" TIMESTAMP(3),
    "verifiedBy" TEXT,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "PracticeBankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeLetterhead" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "storageObjectId" TEXT,
    "headerHtml" TEXT,
    "footerHtml" TEXT,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "PracticeLetterhead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthorisedSignatory" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "personName" TEXT NOT NULL,
    "designation" TEXT NOT NULL,
    "membershipNo" TEXT,
    "userId" TEXT,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "verifiedAt" TIMESTAMP(3),
    "verifiedBy" TEXT,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "AuthorisedSignatory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrossPracticeShare" (
    "id" TEXT NOT NULL,
    "sharingPracticeId" TEXT NOT NULL,
    "receivingPracticeId" TEXT NOT NULL,
    "subjectType" "ShareSubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "subjectVersion" INTEGER,
    "purpose" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "grantedByUserId" TEXT,
    "grantedByName" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedByName" TEXT,
    "lastAccessedAt" TIMESTAMP(3),
    "accessCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CrossPracticeShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PracticeGroup_tenantId_name_key" ON "PracticeGroup"("tenantId", "name");

-- CreateIndex
CREATE INDEX "PracticeAddress_practiceId_effectiveFrom_idx" ON "PracticeAddress"("practiceId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "PracticeAddress_id_practiceId_key" ON "PracticeAddress"("id", "practiceId");

-- CreateIndex
CREATE INDEX "PracticeBankAccount_practiceId_effectiveFrom_idx" ON "PracticeBankAccount"("practiceId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "PracticeBankAccount_id_practiceId_key" ON "PracticeBankAccount"("id", "practiceId");

-- CreateIndex
CREATE INDEX "PracticeLetterhead_practiceId_effectiveFrom_idx" ON "PracticeLetterhead"("practiceId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "PracticeLetterhead_id_practiceId_key" ON "PracticeLetterhead"("id", "practiceId");

-- CreateIndex
CREATE INDEX "AuthorisedSignatory_practiceId_effectiveFrom_idx" ON "AuthorisedSignatory"("practiceId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "AuthorisedSignatory_id_practiceId_key" ON "AuthorisedSignatory"("id", "practiceId");

-- CreateIndex
CREATE INDEX "CrossPracticeShare_receivingPracticeId_expiresAt_idx" ON "CrossPracticeShare"("receivingPracticeId", "expiresAt");

-- CreateIndex
CREATE INDEX "CrossPracticeShare_subjectType_subjectId_idx" ON "CrossPracticeShare"("subjectType", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "Practice_documentNamespace_key" ON "Practice"("documentNamespace");

-- AddForeignKey
ALTER TABLE "PracticeGroup" ADD CONSTRAINT "PracticeGroup_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Practice" ADD CONSTRAINT "Practice_practiceGroupId_fkey" FOREIGN KEY ("practiceGroupId") REFERENCES "PracticeGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeAddress" ADD CONSTRAINT "PracticeAddress_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeBankAccount" ADD CONSTRAINT "PracticeBankAccount_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeLetterhead" ADD CONSTRAINT "PracticeLetterhead_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthorisedSignatory" ADD CONSTRAINT "AuthorisedSignatory_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrossPracticeShare" ADD CONSTRAINT "CrossPracticeShare_sharingPracticeId_fkey" FOREIGN KEY ("sharingPracticeId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrossPracticeShare" ADD CONSTRAINT "CrossPracticeShare_receivingPracticeId_fkey" FOREIGN KEY ("receivingPracticeId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
