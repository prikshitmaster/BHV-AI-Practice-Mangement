-- CreateEnum
CREATE TYPE "AssignmentScope" AS ENUM ('OWN_WORK', 'ASSIGNED_ENGAGEMENTS', 'TEAM', 'BRANCH', 'PRACTICE', 'COMBINED');

-- CreateEnum
CREATE TYPE "RestrictedPermission" AS ENUM ('HR_RECORDS', 'CREDENTIALS', 'FEE_RATES', 'PROTECTED_WORKPAPERS', 'CREDENTIAL_EXPORT');

-- CreateEnum
CREATE TYPE "QueuedJobState" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- AlterEnum
BEGIN;
CREATE TYPE "PracticeRole_new" AS ENUM ('GROUP_OWNER', 'PRACTICE_PARTNER', 'MANAGER', 'REVIEWER', 'STAFF_ARTICLE', 'FINANCE', 'HR', 'IT_ADMIN', 'QUALITY_REVIEWER', 'CLIENT_CONTACT');
-- IAM02: map the previous role names onto the PRD role set rather than
-- dropping memberships. SENIOR becomes REVIEWER and ADMIN becomes IT_ADMIN,
-- which deliberately separates IT control from professional data authority.
ALTER TABLE "PracticeMembership" ALTER COLUMN "role" TYPE "PracticeRole_new" USING (
  CASE "role"::text
    WHEN 'OWNER'       THEN 'GROUP_OWNER'
    WHEN 'PARTNER'     THEN 'PRACTICE_PARTNER'
    WHEN 'MANAGER'     THEN 'MANAGER'
    WHEN 'SENIOR'      THEN 'REVIEWER'
    WHEN 'ARTICLE'     THEN 'STAFF_ARTICLE'
    WHEN 'ADMIN'       THEN 'IT_ADMIN'
    WHEN 'PORTAL_ONLY' THEN 'CLIENT_CONTACT'
  END::"PracticeRole_new"
);
ALTER TYPE "PracticeRole" RENAME TO "PracticeRole_old";
ALTER TYPE "PracticeRole_new" RENAME TO "PracticeRole";
DROP TYPE "public"."PracticeRole_old";
COMMIT;

-- AlterTable
ALTER TABLE "Practice" ADD COLUMN     "invoiceApprovalThreshold" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PracticeMembership" ADD COLUMN     "assignmentScope" "AssignmentScope" NOT NULL DEFAULT 'OWN_WORK';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "invitedAt" TIMESTAMP(3),
ADD COLUMN     "invitedByUserId" TEXT,
ADD COLUMN     "lastAccessReviewAt" TIMESTAMP(3),
ADD COLUMN     "mfaEnrolledAt" TIMESTAMP(3),
ADD COLUMN     "sponsorUserId" TEXT,
ADD COLUMN     "suspendedAt" TIMESTAMP(3),
ADD COLUMN     "suspendedReason" TEXT;

-- CreateTable
CREATE TABLE "PermissionGrant" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "permission" "RestrictedPermission" NOT NULL,
    "reason" TEXT NOT NULL,
    "grantedByUserId" TEXT,
    "grantedByName" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "PermissionGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idleExpiresAt" TIMESTAMP(3) NOT NULL,
    "absoluteExpiresAt" TIMESTAMP(3) NOT NULL,
    "mfaVerifiedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueuedJob" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "state" "QueuedJobState" NOT NULL DEFAULT 'QUEUED',
    "cancelledReason" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "QueuedJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SelfReviewException" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "subjectType" "ApprovalSubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "subjectVersion" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "disclosedByUserId" TEXT,
    "disclosedByName" TEXT NOT NULL,
    "qualityReviewRequired" BOOLEAN NOT NULL DEFAULT true,
    "qualityReviewedAt" TIMESTAMP(3),
    "qualityReviewedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SelfReviewException_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PermissionGrant_practiceId_permission_idx" ON "PermissionGrant"("practiceId", "permission");

-- CreateIndex
CREATE UNIQUE INDEX "PermissionGrant_membershipId_permission_effectiveFrom_key" ON "PermissionGrant"("membershipId", "permission", "effectiveFrom");

-- CreateIndex
CREATE INDEX "Session_userId_revokedAt_idx" ON "Session"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "QueuedJob_state_createdAt_idx" ON "QueuedJob"("state", "createdAt");

-- CreateIndex
CREATE INDEX "QueuedJob_requestedByUserId_state_idx" ON "QueuedJob"("requestedByUserId", "state");

-- CreateIndex
CREATE INDEX "SelfReviewException_practiceId_subjectType_subjectId_idx" ON "SelfReviewException"("practiceId", "subjectType", "subjectId");

-- AddForeignKey
ALTER TABLE "PermissionGrant" ADD CONSTRAINT "PermissionGrant_membershipId_practiceId_fkey" FOREIGN KEY ("membershipId", "practiceId") REFERENCES "PracticeMembership"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueuedJob" ADD CONSTRAINT "QueuedJob_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelfReviewException" ADD CONSTRAINT "SelfReviewException_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
