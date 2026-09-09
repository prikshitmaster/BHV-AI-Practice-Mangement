-- CreateEnum
CREATE TYPE "StepUpPurpose" AS ENUM ('EXPORT', 'ROLE_CHANGE', 'SECRET_REVEAL');

-- CreateEnum
CREATE TYPE "MfaMethod" AS ENUM ('TOTP', 'WEBAUTHN');

-- CreateEnum
CREATE TYPE "RecoveryKind" AS ENUM ('PASSWORD_RESET', 'MFA_RESET');

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "deviceLabel" TEXT,
ADD COLUMN     "tokenHash" TEXT,
ADD COLUMN     "userAgent" TEXT;

-- AUTH02: sessions that predate token hashing cannot be resumed. Give each a
-- random, unmatchable hash and revoke it, rather than deleting audit history.
UPDATE "Session"
SET "tokenHash" = gen_random_uuid()::text || gen_random_uuid()::text,
    "revokedAt" = COALESCE("revokedAt", NOW()),
    "revokedReason" = COALESCE("revokedReason", 'Pre-dates token hashing; forced re-authentication')
WHERE "tokenHash" IS NULL;

ALTER TABLE "Session" ALTER COLUMN "tokenHash" SET NOT NULL;

-- CreateTable
CREATE TABLE "StepUpChallenge" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "purpose" "StepUpPurpose" NOT NULL,
    "satisfiedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StepUpChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "passwordUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MfaEnrolment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "method" "MfaMethod" NOT NULL DEFAULT 'TOTP',
    "secretCiphertext" TEXT NOT NULL,
    "secretIv" TEXT NOT NULL,
    "secretAuthTag" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "lastUsedStep" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MfaEnrolment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MfaRecoveryCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MfaRecoveryCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "role" "PracticeRole" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "channel" TEXT NOT NULL,
    "invitedByUserId" TEXT,
    "invitedByName" TEXT NOT NULL,
    "sponsorUserId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "acceptedByUserId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecoveryRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "RecoveryKind" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "requestedByName" TEXT NOT NULL,
    "approverUserId" TEXT,
    "approverName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecoveryRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DscCustodyRecord" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "certificateIdentifier" TEXT NOT NULL,
    "issuedOn" DATE NOT NULL,
    "expiresOn" DATE NOT NULL,
    "custodianUserId" TEXT,
    "custodianName" TEXT NOT NULL,
    "issuedToCustodianAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "purpose" TEXT NOT NULL,
    "notes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DscCustodyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitCounter" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RateLimitCounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StepUpChallenge_sessionId_purpose_idx" ON "StepUpChallenge"("sessionId", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "UserCredential_userId_key" ON "UserCredential"("userId");

-- CreateIndex
CREATE INDEX "MfaEnrolment_userId_revokedAt_idx" ON "MfaEnrolment"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "MfaRecoveryCode_userId_usedAt_idx" ON "MfaRecoveryCode"("userId", "usedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_email_acceptedAt_idx" ON "Invitation"("email", "acceptedAt");

-- CreateIndex
CREATE INDEX "Invitation_practiceId_idx" ON "Invitation"("practiceId");

-- CreateIndex
CREATE UNIQUE INDEX "RecoveryRequest_tokenHash_key" ON "RecoveryRequest"("tokenHash");

-- CreateIndex
CREATE INDEX "RecoveryRequest_userId_kind_idx" ON "RecoveryRequest"("userId", "kind");

-- CreateIndex
CREATE INDEX "DscCustodyRecord_practiceId_expiresOn_idx" ON "DscCustodyRecord"("practiceId", "expiresOn");

-- CreateIndex
CREATE UNIQUE INDEX "DscCustodyRecord_id_practiceId_key" ON "DscCustodyRecord"("id", "practiceId");

-- CreateIndex
CREATE UNIQUE INDEX "RateLimitCounter_key_key" ON "RateLimitCounter"("key");

-- CreateIndex
CREATE INDEX "RateLimitCounter_windowStart_idx" ON "RateLimitCounter"("windowStart");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- AddForeignKey
ALTER TABLE "StepUpChallenge" ADD CONSTRAINT "StepUpChallenge_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCredential" ADD CONSTRAINT "UserCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MfaEnrolment" ADD CONSTRAINT "MfaEnrolment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MfaRecoveryCode" ADD CONSTRAINT "MfaRecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryRequest" ADD CONSTRAINT "RecoveryRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DscCustodyRecord" ADD CONSTRAINT "DscCustodyRecord_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
