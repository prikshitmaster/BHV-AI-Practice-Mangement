-- T13 -- Client portal (PRD 17, POR01-03/POR05).
--
-- Purely ADDITIVE: one new enum and five new tables. No existing column is
-- dropped, retyped or made required, so no backfill is needed and no existing
-- row can be invalidated by this file.
--
-- The portal deliberately does NOT extend "User", "Session" or "Invitation".
-- PRD 17 requires portal authentication to be separate from internal staff
-- administration, so a client contact is modelled as its own kind of
-- principal. Authority to act still comes from "ContactAuthority" -- nothing
-- created here grants access on its own.
--
-- Written idempotently; Prisma does not wrap a migration in a transaction.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "PortalUploadState" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'ABANDONED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "PortalInvitation" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "invitedByUserId" TEXT,
    "invitedByName" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "renewalRequestedAt" TIMESTAMP(3),
    "renewalCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortalInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PortalSession" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idleExpiresAt" TIMESTAMP(3) NOT NULL,
    "absoluteExpiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,

    CONSTRAINT "PortalSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PortalUpload" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "clientRelationshipId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "sessionId" TEXT,
    "itemId" TEXT,
    "filename" TEXT NOT NULL,
    "declaredMimeType" TEXT NOT NULL,
    "expectedBytes" INTEGER NOT NULL,
    "expectedSha256" TEXT,
    "receivedBytes" INTEGER NOT NULL DEFAULT 0,
    "state" "PortalUploadState" NOT NULL DEFAULT 'IN_PROGRESS',
    "completedAt" TIMESTAMP(3),
    "intakeId" TEXT,
    "documentVersionId" TEXT,
    "deduplicatedFromVersionId" TEXT,
    "abandonedAt" TIMESTAMP(3),
    "abandonReason" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortalUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PortalUploadPart" (
    "id" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "partNumber" INTEGER NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortalUploadPart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PracticeSupportContact" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "helpUrl" TEXT,
    "hoursLabel" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedBy" TEXT,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PracticeSupportContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PortalInvitation_tokenHash_key" ON "PortalInvitation"("tokenHash");
CREATE INDEX IF NOT EXISTS "PortalInvitation_practiceId_contactId_idx" ON "PortalInvitation"("practiceId", "contactId");
CREATE INDEX IF NOT EXISTS "PortalInvitation_expiresAt_idx" ON "PortalInvitation"("expiresAt");

CREATE UNIQUE INDEX IF NOT EXISTS "PortalSession_tokenHash_key" ON "PortalSession"("tokenHash");
CREATE INDEX IF NOT EXISTS "PortalSession_contactId_revokedAt_idx" ON "PortalSession"("contactId", "revokedAt");
CREATE INDEX IF NOT EXISTS "PortalSession_practiceId_idx" ON "PortalSession"("practiceId");

CREATE INDEX IF NOT EXISTS "PortalUpload_practiceId_contactId_state_idx" ON "PortalUpload"("practiceId", "contactId", "state");
CREATE INDEX IF NOT EXISTS "PortalUpload_expiresAt_idx" ON "PortalUpload"("expiresAt");
CREATE UNIQUE INDEX IF NOT EXISTS "PortalUpload_id_practiceId_key" ON "PortalUpload"("id", "practiceId");

CREATE INDEX IF NOT EXISTS "PortalUploadPart_uploadId_idx" ON "PortalUploadPart"("uploadId");
-- This is what makes a resumed transfer idempotent: the same part arriving
-- twice updates one row instead of appending a second copy.
CREATE UNIQUE INDEX IF NOT EXISTS "PortalUploadPart_uploadId_partNumber_key" ON "PortalUploadPart"("uploadId", "partNumber");

CREATE INDEX IF NOT EXISTS "PracticeSupportContact_practiceId_archivedAt_idx" ON "PracticeSupportContact"("practiceId", "archivedAt");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "PortalInvitation" ADD CONSTRAINT "PortalInvitation_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PortalSession" ADD CONSTRAINT "PortalSession_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The composite (id, practiceId) reference is the ORG04 isolation guarantee
-- carried into the portal: an upload cannot name a relationship in one
-- practice while claiming to belong to another.
DO $$ BEGIN
  ALTER TABLE "PortalUpload" ADD CONSTRAINT "PortalUpload_clientRelationshipId_practiceId_fkey" FOREIGN KEY ("clientRelationshipId", "practiceId") REFERENCES "ClientRelationship"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PortalUpload" ADD CONSTRAINT "PortalUpload_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PortalUpload" ADD CONSTRAINT "PortalUpload_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PortalSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PortalUpload" ADD CONSTRAINT "PortalUpload_itemId_practiceId_fkey" FOREIGN KEY ("itemId", "practiceId") REFERENCES "ClientRequestItem"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PortalUploadPart" ADD CONSTRAINT "PortalUploadPart_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "PortalUpload"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PracticeSupportContact" ADD CONSTRAINT "PracticeSupportContact_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
