-- T12 -- Communication and client requests (PRD 16, COM01-04).
-- COM05 (meetings) is R1 and COM06 (WhatsApp / other channels) is R2; neither
-- is created here.
--
-- Purely ADDITIVE. No column is dropped or retyped. The single change to an
-- existing table is ClientRequest.closeRule, which carries a default, so every
-- row T09 wrote survives untouched. COM04's delivery lifecycle is a NEW
-- OutboundState enum rather than a retype of DeliveryState (ObligationAlert
-- still uses that one) -- retyping a live column is the destructive migration
-- this project has been bitten by before.
--
-- Written idempotently (guards on every CREATE TYPE / TABLE / INDEX /
-- CONSTRAINT). Prisma does not wrap a migration in a transaction, so a failure
-- part-way through would otherwise leave partial state that blocks a re-run --
-- see the T09 note in PROGRESS.md.
-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ThreadVisibility" AS ENUM ('INTERNAL', 'CLIENT_VISIBLE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "MessageDirection" AS ENUM ('INTERNAL_NOTE', 'OUTBOUND_TO_CLIENT', 'INBOUND_FROM_CLIENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "MessageChannel" AS ENUM ('PORTAL', 'EMAIL_REFERENCE', 'NOTE', 'MEETING_SUMMARY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "RequestCloseRule" AS ENUM ('ON_RECEIPT', 'ON_ACCEPTANCE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "RequestItemState" AS ENUM ('OUTSTANDING', 'SUBMITTED', 'NOT_AVAILABLE', 'QUESTION_RAISED', 'ACCEPTED', 'REJECTED', 'WAIVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "RequestResponseKind" AS ENUM ('DOCUMENT', 'NOT_AVAILABLE_EXPLANATION', 'QUESTION', 'STAFF_NOTE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "OutboundState" AS ENUM ('QUEUED', 'HELD_QUIET_HOURS', 'SUBMITTED', 'DELIVERED', 'FAILED', 'SUPPRESSED', 'DELIVERY_UNCERTAIN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "OutboundKind" AS ENUM ('CLIENT_MESSAGE', 'DOCUMENT_REQUEST_REMINDER', 'DEADLINE_REMINDER', 'INVOICE', 'DOCUMENT_RELEASE', 'DIGEST');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "DigestMode" AS ENUM ('IMMEDIATE', 'DAILY_DIGEST', 'WEEKLY_DIGEST');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- AlterTable
ALTER TABLE "ClientRequest" ADD COLUMN IF NOT EXISTS "closeRule" "RequestCloseRule" NOT NULL DEFAULT 'ON_ACCEPTANCE';
-- CreateTable
CREATE TABLE IF NOT EXISTS "MessageThread" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "clientRelationshipId" TEXT NOT NULL,
    "engagementId" TEXT,
    "jobId" TEXT,
    "subject" TEXT NOT NULL,
    "visibility" "ThreadVisibility" NOT NULL DEFAULT 'INTERNAL',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageThread_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE IF NOT EXISTS "Message" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "visibility" "ThreadVisibility" NOT NULL,
    "body" TEXT NOT NULL,
    "authorUserId" TEXT,
    "authorContactId" TEXT,
    "authorName" TEXT NOT NULL,
    "externalReference" TEXT,
    "attachedVersionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "redactedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE IF NOT EXISTS "ThreadVisibilityChange" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "fromVisibility" "ThreadVisibility" NOT NULL,
    "toVisibility" "ThreadVisibility" NOT NULL,
    "contentDigest" TEXT NOT NULL,
    "previewedCount" INTEGER NOT NULL,
    "previewedByUserId" TEXT NOT NULL,
    "previewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" TIMESTAMP(3),
    "committedByUserId" TEXT,
    "abandonedAt" TIMESTAMP(3),
    "refusalReason" TEXT,

    CONSTRAINT "ThreadVisibilityChange_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE IF NOT EXISTS "ClientRequestItem" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "documentType" TEXT NOT NULL,
    "description" TEXT,
    "periodLabel" TEXT,
    "periodStart" DATE,
    "periodEnd" DATE,
    "dueDate" DATE,
    "ownerUserId" TEXT,
    "state" "RequestItemState" NOT NULL DEFAULT 'OUTSTANDING',
    "stateChangedAt" TIMESTAMP(3),
    "remindersStoppedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientRequestItem_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE IF NOT EXISTS "ClientRequestItemResponse" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "kind" "RequestResponseKind" NOT NULL,
    "documentVersionId" TEXT,
    "explanation" TEXT,
    "respondedByContactId" TEXT,
    "respondedByUserId" TEXT,
    "respondedByName" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedByUserId" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientRequestItemResponse_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE IF NOT EXISTS "MessageTemplate" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'SERVICE',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE IF NOT EXISTS "OutboundMessage" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "threadId" TEXT,
    "clientRelationshipId" TEXT,
    "kind" "OutboundKind" NOT NULL,
    "sendingPracticeName" TEXT NOT NULL,
    "fromIdentity" TEXT NOT NULL,
    "replyToIdentity" TEXT NOT NULL,
    "letterheadId" TEXT,
    "templateId" TEXT,
    "renderedSubject" TEXT NOT NULL,
    "renderedBody" TEXT NOT NULL,
    "attachedVersionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "portalLinkTokenIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "previewHash" TEXT NOT NULL,
    "previewConfirmedAt" TIMESTAMP(3),
    "previewConfirmedByUserId" TEXT,
    "dedupKey" TEXT NOT NULL,
    "state" "OutboundState" NOT NULL DEFAULT 'QUEUED',
    "stateDetail" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "requestedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboundMessage_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE IF NOT EXISTS "OutboundRecipient" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "contactId" TEXT,
    "address" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'TO',
    "authorityBasis" TEXT NOT NULL,
    "wasChangedRecipient" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboundRecipient_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE IF NOT EXISTS "RecipientVerification" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "contactId" TEXT,
    "address" TEXT NOT NULL,
    "previousAddress" TEXT,
    "proposedByUserId" TEXT,
    "proposedByName" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "verifiedByUserId" TEXT,
    "verifiedByName" TEXT,
    "verificationMethod" TEXT,
    "verificationEvidence" TEXT,
    "refusedAt" TIMESTAMP(3),
    "refusalReason" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecipientVerification_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE IF NOT EXISTS "DeliveryAttempt" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "state" "OutboundState" NOT NULL,
    "providerReference" TEXT,
    "detail" TEXT,
    "isBounce" BOOLEAN NOT NULL DEFAULT false,
    "bounceKind" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryAttempt_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE IF NOT EXISTS "NotificationPreference" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "contactId" TEXT,
    "userId" TEXT,
    "digestMode" "DigestMode" NOT NULL DEFAULT 'IMMEDIATE',
    "quietFromMinute" INTEGER,
    "quietToMinute" INTEGER,
    "timeZone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "quietHoursOverrideKinds" "OutboundKind"[] DEFAULT ARRAY[]::"OutboundKind"[],
    "suppressedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX IF NOT EXISTS "MessageThread_practiceId_clientRelationshipId_updatedAt_idx" ON "MessageThread"("practiceId", "clientRelationshipId", "updatedAt");
-- CreateIndex
CREATE INDEX IF NOT EXISTS "MessageThread_practiceId_engagementId_idx" ON "MessageThread"("practiceId", "engagementId");
-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MessageThread_id_practiceId_key" ON "MessageThread"("id", "practiceId");
-- CreateIndex
CREATE INDEX IF NOT EXISTS "Message_practiceId_threadId_createdAt_idx" ON "Message"("practiceId", "threadId", "createdAt");
-- CreateIndex
CREATE INDEX IF NOT EXISTS "ThreadVisibilityChange_practiceId_threadId_previewedAt_idx" ON "ThreadVisibilityChange"("practiceId", "threadId", "previewedAt");
-- CreateIndex
CREATE INDEX IF NOT EXISTS "ClientRequestItem_practiceId_state_dueDate_idx" ON "ClientRequestItem"("practiceId", "state", "dueDate");
-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ClientRequestItem_id_practiceId_key" ON "ClientRequestItem"("id", "practiceId");
-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ClientRequestItem_requestId_sequence_key" ON "ClientRequestItem"("requestId", "sequence");
-- CreateIndex
CREATE INDEX IF NOT EXISTS "ClientRequestItemResponse_practiceId_itemId_createdAt_idx" ON "ClientRequestItemResponse"("practiceId", "itemId", "createdAt");
-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MessageTemplate_tenantId_code_key" ON "MessageTemplate"("tenantId", "code");
-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "OutboundMessage_dedupKey_key" ON "OutboundMessage"("dedupKey");
-- CreateIndex
CREATE INDEX IF NOT EXISTS "OutboundMessage_practiceId_state_scheduledFor_idx" ON "OutboundMessage"("practiceId", "state", "scheduledFor");
-- CreateIndex
CREATE INDEX IF NOT EXISTS "OutboundMessage_practiceId_kind_createdAt_idx" ON "OutboundMessage"("practiceId", "kind", "createdAt");
-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "OutboundMessage_id_practiceId_key" ON "OutboundMessage"("id", "practiceId");
-- CreateIndex
CREATE INDEX IF NOT EXISTS "OutboundRecipient_practiceId_messageId_idx" ON "OutboundRecipient"("practiceId", "messageId");
-- CreateIndex
CREATE INDEX IF NOT EXISTS "RecipientVerification_practiceId_address_verifiedAt_idx" ON "RecipientVerification"("practiceId", "address", "verifiedAt");
-- CreateIndex
CREATE INDEX IF NOT EXISTS "DeliveryAttempt_practiceId_createdAt_idx" ON "DeliveryAttempt"("practiceId", "createdAt");
-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "DeliveryAttempt_messageId_attemptNo_key" ON "DeliveryAttempt"("messageId", "attemptNo");
-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "NotificationPreference_practiceId_contactId_key" ON "NotificationPreference"("practiceId", "contactId");
-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "NotificationPreference_practiceId_userId_key" ON "NotificationPreference"("practiceId", "userId");
-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ClientRequest_id_practiceId_key" ON "ClientRequest"("id", "practiceId");
-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "MessageThread" ADD CONSTRAINT "MessageThread_clientRelationshipId_practiceId_fkey" FOREIGN KEY ("clientRelationshipId", "practiceId") REFERENCES "ClientRelationship"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "MessageThread" ADD CONSTRAINT "MessageThread_engagementId_practiceId_fkey" FOREIGN KEY ("engagementId", "practiceId") REFERENCES "Engagement"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "MessageThread" ADD CONSTRAINT "MessageThread_jobId_practiceId_fkey" FOREIGN KEY ("jobId", "practiceId") REFERENCES "Job"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Message" ADD CONSTRAINT "Message_threadId_practiceId_fkey" FOREIGN KEY ("threadId", "practiceId") REFERENCES "MessageThread"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ThreadVisibilityChange" ADD CONSTRAINT "ThreadVisibilityChange_threadId_practiceId_fkey" FOREIGN KEY ("threadId", "practiceId") REFERENCES "MessageThread"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ClientRequestItem" ADD CONSTRAINT "ClientRequestItem_requestId_practiceId_fkey" FOREIGN KEY ("requestId", "practiceId") REFERENCES "ClientRequest"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ClientRequestItemResponse" ADD CONSTRAINT "ClientRequestItemResponse_itemId_practiceId_fkey" FOREIGN KEY ("itemId", "practiceId") REFERENCES "ClientRequestItem"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "MessageTemplate" ADD CONSTRAINT "MessageTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_threadId_practiceId_fkey" FOREIGN KEY ("threadId", "practiceId") REFERENCES "MessageThread"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "OutboundRecipient" ADD CONSTRAINT "OutboundRecipient_messageId_practiceId_fkey" FOREIGN KEY ("messageId", "practiceId") REFERENCES "OutboundMessage"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_messageId_practiceId_fkey" FOREIGN KEY ("messageId", "practiceId") REFERENCES "OutboundMessage"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
