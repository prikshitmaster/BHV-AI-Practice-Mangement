-- T14 (FIN01, FIN02, FIN04) — fee arrangements, invoice identity, receipts.
--
-- Purely additive. Verified before writing: no DROP COLUMN, no DROP TYPE, no
-- enum recreation, no new REQUIRED column on a table that already holds rows.
-- The one ALTER COLUMN widens ReceiptAllocation.receiptId to NULL, because a
-- CREDIT_NOTE allocation settles an invoice with no money arriving.
--
-- InvoiceStatus gains four values rather than being replaced: the four
-- migrations in this repo that rebuilt an enum each had to hand-write a USING
-- map to avoid dropping the column, and ADD VALUE avoids that class of damage
-- entirely. Values are appended, so DRAFT/ISSUED/CANCELLED keep their ordinals.
--
-- Receipt.bankAccountId is nullable on purpose. FIN04 wants a receipt tied to
-- the bank account it landed in, but rows predating this column exist and
-- inventing an account for them would put a false fact in the register;
-- recordReceipt() requires one for everything created from here on.
--
-- Written idempotently (Prisma runs these outside a transaction, so a
-- mid-file failure must be safe to re-run).

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SeriesKind') THEN
    CREATE TYPE "SeriesKind" AS ENUM ('INVOICE', 'CREDIT_NOTE');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FeeBasis') THEN
    CREATE TYPE "FeeBasis" AS ENUM ('FIXED', 'RECURRING', 'MILESTONE', 'TIME_BASED');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FeeArrangementStatus') THEN
    CREATE TYPE "FeeArrangementStatus" AS ENUM ('DRAFT', 'APPROVED', 'SUPERSEDED', 'WITHDRAWN');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FeeComponentKind') THEN
    CREATE TYPE "FeeComponentKind" AS ENUM ('MILESTONE', 'REIMBURSABLE_EXPENSE', 'ADVANCE', 'SCOPE_CHANGE');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CreditNoteStatus') THEN
    CREATE TYPE "CreditNoteStatus" AS ENUM ('DRAFT', 'APPROVED', 'ISSUED', 'CANCELLED');
  END IF;
END $$;

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AllocationKind" ADD VALUE IF NOT EXISTS 'REFUND';
ALTER TYPE "AllocationKind" ADD VALUE IF NOT EXISTS 'CREDIT_NOTE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "InvoiceStatus" ADD VALUE IF NOT EXISTS 'APPROVED';
ALTER TYPE "InvoiceStatus" ADD VALUE IF NOT EXISTS 'PART_PAID';
ALTER TYPE "InvoiceStatus" ADD VALUE IF NOT EXISTS 'PAID';
ALTER TYPE "InvoiceStatus" ADD VALUE IF NOT EXISTS 'CREDITED';

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "approvedByName" TEXT,
ADD COLUMN IF NOT EXISTS "approvedByUserId" TEXT,
ADD COLUMN IF NOT EXISTS "displayNumber" TEXT,
ADD COLUMN IF NOT EXISTS "dueDate" DATE,
ADD COLUMN IF NOT EXISTS "feeArrangementId" TEXT,
ADD COLUMN IF NOT EXISTS "issueDate" DATE;

-- AlterTable
ALTER TABLE "InvoiceSeries" ADD COLUMN IF NOT EXISTS "kind" "SeriesKind" NOT NULL DEFAULT 'INVOICE',
ADD COLUMN IF NOT EXISTS "numberFormat" TEXT;

-- AlterTable
ALTER TABLE "Receipt" ADD COLUMN IF NOT EXISTS "bankAccountId" TEXT;

-- AlterTable
ALTER TABLE "ReceiptAllocation" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT,
ADD COLUMN IF NOT EXISTS "creditNoteId" TEXT,
ADD COLUMN IF NOT EXISTS "reversalOfId" TEXT,
ADD COLUMN IF NOT EXISTS "reversalReason" TEXT,
ADD COLUMN IF NOT EXISTS "reversedAt" TIMESTAMP(3),
ALTER COLUMN "receiptId" DROP NOT NULL;

-- CreateTable
CREATE TABLE IF NOT EXISTS "FeeArrangement" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "clientRelationshipId" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "basis" "FeeBasis" NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "agreedAmount" DECIMAL(18,2),
    "agreedRateAmount" DECIMAL(18,2),
    "agreedRateUnit" TEXT,
    "recurrenceLabel" TEXT,
    "taxTreatment" TEXT NOT NULL,
    "taxRatePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "status" "FeeArrangementStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedByUserId" TEXT,
    "approvedByName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedSnapshot" JSONB,
    "parentArrangementId" TEXT,
    "revisionNumber" INTEGER NOT NULL DEFAULT 0,
    "supersededAt" TIMESTAMP(3),
    "changeReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeeArrangement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "FeeComponent" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "arrangementId" TEXT NOT NULL,
    "kind" "FeeComponentKind" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "dueOn" DATE,
    "reachedAt" TIMESTAMP(3),
    "invoicedAt" TIMESTAMP(3),
    "invoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeeComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CreditNote" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "displayNumber" TEXT,
    "reason" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "status" "CreditNoteStatus" NOT NULL DEFAULT 'DRAFT',
    "reviewedByUserId" TEXT,
    "reviewedByName" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "issuedSnapshot" JSONB,
    "issuedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FeeArrangement_practiceId_engagementId_status_idx" ON "FeeArrangement"("practiceId", "engagementId", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "FeeArrangement_id_practiceId_key" ON "FeeArrangement"("id", "practiceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FeeComponent_practiceId_arrangementId_idx" ON "FeeComponent"("practiceId", "arrangementId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "FeeComponent_id_practiceId_key" ON "FeeComponent"("id", "practiceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CreditNote_practiceId_invoiceId_idx" ON "CreditNote"("practiceId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CreditNote_id_practiceId_key" ON "CreditNote"("id", "practiceId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CreditNote_seriesId_sequenceNumber_key" ON "CreditNote"("seriesId", "sequenceNumber");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ReceiptAllocation_reversalOfId_key" ON "ReceiptAllocation"("reversalOfId");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Invoice_feeArrangementId_practiceId_fkey') THEN
    ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_feeArrangementId_practiceId_fkey" FOREIGN KEY ("feeArrangementId", "practiceId") REFERENCES "FeeArrangement"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Receipt_bankAccountId_practiceId_fkey') THEN
    ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_bankAccountId_practiceId_fkey" FOREIGN KEY ("bankAccountId", "practiceId") REFERENCES "PracticeBankAccount"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReceiptAllocation_creditNoteId_practiceId_fkey') THEN
    ALTER TABLE "ReceiptAllocation" ADD CONSTRAINT "ReceiptAllocation_creditNoteId_practiceId_fkey" FOREIGN KEY ("creditNoteId", "practiceId") REFERENCES "CreditNote"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReceiptAllocation_reversalOfId_fkey') THEN
    ALTER TABLE "ReceiptAllocation" ADD CONSTRAINT "ReceiptAllocation_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "ReceiptAllocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FeeArrangement_practiceId_fkey') THEN
    ALTER TABLE "FeeArrangement" ADD CONSTRAINT "FeeArrangement_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FeeArrangement_clientRelationshipId_practiceId_fkey') THEN
    ALTER TABLE "FeeArrangement" ADD CONSTRAINT "FeeArrangement_clientRelationshipId_practiceId_fkey" FOREIGN KEY ("clientRelationshipId", "practiceId") REFERENCES "ClientRelationship"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FeeArrangement_engagementId_practiceId_fkey') THEN
    ALTER TABLE "FeeArrangement" ADD CONSTRAINT "FeeArrangement_engagementId_practiceId_fkey" FOREIGN KEY ("engagementId", "practiceId") REFERENCES "Engagement"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FeeArrangement_parentArrangementId_fkey') THEN
    ALTER TABLE "FeeArrangement" ADD CONSTRAINT "FeeArrangement_parentArrangementId_fkey" FOREIGN KEY ("parentArrangementId") REFERENCES "FeeArrangement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FeeComponent_arrangementId_practiceId_fkey') THEN
    ALTER TABLE "FeeComponent" ADD CONSTRAINT "FeeComponent_arrangementId_practiceId_fkey" FOREIGN KEY ("arrangementId", "practiceId") REFERENCES "FeeArrangement"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreditNote_practiceId_fkey') THEN
    ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreditNote_seriesId_practiceId_fkey') THEN
    ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_seriesId_practiceId_fkey" FOREIGN KEY ("seriesId", "practiceId") REFERENCES "InvoiceSeries"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreditNote_invoiceId_practiceId_fkey') THEN
    ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_invoiceId_practiceId_fkey" FOREIGN KEY ("invoiceId", "practiceId") REFERENCES "Invoice"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
