-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WorkState') THEN
    CREATE TYPE "WorkState" AS ENUM ('DRAFT', 'READY', 'IN_PROGRESS', 'WAITING_FOR_CLIENT', 'WAITING_INTERNALLY', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED_FOR_ACTION', 'SUBMITTED_DELIVERED', 'COMPLETED', 'CANCELLED', 'REOPENED');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WorkSubjectType') THEN
    CREATE TYPE "WorkSubjectType" AS ENUM ('JOB', 'TASK');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'Priority') THEN
    CREATE TYPE "Priority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ClientRequestState') THEN
    CREATE TYPE "ClientRequestState" AS ENUM ('OPEN', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED');
  END IF;
END $$;

-- AlterTable
ALTER TABLE "ChecklistItem" ADD COLUMN IF NOT EXISTS "completedByUserId" TEXT,
ADD COLUMN IF NOT EXISTS "isRequired" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "notApplicable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "notApplicableReason" TEXT,
ADD COLUMN IF NOT EXISTS "requiredRole" "PracticeRole";

-- AlterTable
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "estimateMinutes" INTEGER,
ADD COLUMN IF NOT EXISTS "obligationId" TEXT,
ADD COLUMN IF NOT EXISTS "priority" "Priority" NOT NULL DEFAULT 'NORMAL',
ADD COLUMN IF NOT EXISTS "reopenCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "tags" TEXT[],
ADD COLUMN IF NOT EXISTS "templateVersionSnapshot" JSONB,
ALTER COLUMN "state" DROP DEFAULT;

-- WRK02: convert the existing Job states onto the full state set by MAPPING
-- them, not by dropping the column. Prisma's generated diff would have
-- discarded every recorded state; BLOCKED becomes WAITING_INTERNALLY and
-- NOT_STARTED becomes READY.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Job' AND column_name = 'state' AND udt_name <> 'WorkState'
  ) THEN
    EXECUTE $sql$ALTER TABLE "Job" ALTER COLUMN "state" TYPE "WorkState" USING (
  CASE "state"::text
    WHEN 'NOT_STARTED' THEN 'READY'
    WHEN 'IN_PROGRESS' THEN 'IN_PROGRESS'
    WHEN 'BLOCKED'     THEN 'WAITING_INTERNALLY'
    WHEN 'IN_REVIEW'   THEN 'IN_REVIEW'
    WHEN 'COMPLETED'   THEN 'COMPLETED'
    WHEN 'CANCELLED'   THEN 'CANCELLED'
  END::"WorkState"
);$sql$;
  END IF;
END $$;
ALTER TABLE "Job" ALTER COLUMN "state" SET DEFAULT 'READY';

-- AlterTable
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "estimateMinutes" INTEGER,
ADD COLUMN IF NOT EXISTS "priority" "Priority" NOT NULL DEFAULT 'NORMAL',
ADD COLUMN IF NOT EXISTS "reviewerUserId" TEXT,
ADD COLUMN IF NOT EXISTS "tags" TEXT[],
ALTER COLUMN "state" DROP DEFAULT;

-- WRK02: convert the existing Task states onto the full state set by MAPPING
-- them, not by dropping the column. Prisma's generated diff would have
-- discarded every recorded state; BLOCKED becomes WAITING_INTERNALLY and
-- NOT_STARTED becomes READY.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Task' AND column_name = 'state' AND udt_name <> 'WorkState'
  ) THEN
    EXECUTE $sql$ALTER TABLE "Task" ALTER COLUMN "state" TYPE "WorkState" USING (
  CASE "state"::text
    WHEN 'NOT_STARTED' THEN 'READY'
    WHEN 'IN_PROGRESS' THEN 'IN_PROGRESS'
    WHEN 'BLOCKED'     THEN 'WAITING_INTERNALLY'
    WHEN 'IN_REVIEW'   THEN 'IN_REVIEW'
    WHEN 'COMPLETED'   THEN 'COMPLETED'
    WHEN 'CANCELLED'   THEN 'CANCELLED'
  END::"WorkState"
);$sql$;
  END IF;
END $$;
ALTER TABLE "Task" ALTER COLUMN "state" SET DEFAULT 'READY';

-- AlterTable
ALTER TABLE "TaskDependency" ADD COLUMN IF NOT EXISTS "evidenceDocumentId" TEXT,
ADD COLUMN IF NOT EXISTS "requiredEvidenceLabel" TEXT;

-- DropEnum
DROP TYPE IF EXISTS "JobState";

-- DropEnum
DROP TYPE IF EXISTS "TaskState";

-- CreateTable
CREATE TABLE IF NOT EXISTS "WorkStateTransition" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "subjectType" "WorkSubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "fromState" "WorkState" NOT NULL,
    "toState" "WorkState" NOT NULL,
    "actorUserId" TEXT,
    "actorName" TEXT NOT NULL,
    "reason" TEXT,
    "subjectVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkStateTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ClientRequest" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "clientRelationshipId" TEXT NOT NULL,
    "engagementId" TEXT,
    "jobId" TEXT,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "requestedItems" JSONB NOT NULL,
    "state" "ClientRequestState" NOT NULL DEFAULT 'OPEN',
    "dueDate" DATE,
    "sentAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "slaPausedAt" TIMESTAMP(3),
    "slaPausedTotalMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TimeEntry" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "jobId" TEXT,
    "taskId" TEXT,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stoppedAt" TIMESTAMP(3),
    "minutes" INTEGER,
    "note" TEXT,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "WorkReassignment" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "subjectType" "WorkSubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "fromUserId" TEXT,
    "toUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorName" TEXT NOT NULL,
    "activeTimerIds" TEXT[],
    "pendingApprovalsCount" INTEGER NOT NULL DEFAULT 0,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkReassignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WorkStateTransition_practiceId_subjectType_subjectId_create_idx" ON "WorkStateTransition"("practiceId", "subjectType", "subjectId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ClientRequest_practiceId_state_idx" ON "ClientRequest"("practiceId", "state");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ClientRequest_practiceId_dueDate_idx" ON "ClientRequest"("practiceId", "dueDate");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TimeEntry_practiceId_userId_stoppedAt_idx" ON "TimeEntry"("practiceId", "userId", "stoppedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WorkReassignment_practiceId_subjectType_subjectId_idx" ON "WorkReassignment"("practiceId", "subjectType", "subjectId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WorkReassignment_practiceId_toUserId_idx" ON "WorkReassignment"("practiceId", "toUserId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Job_practiceId_state_idx" ON "Job"("practiceId", "state");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Task_practiceId_state_idx" ON "Task"("practiceId", "state");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClientRequest_clientRelationshipId_practiceId_fkey') THEN
    ALTER TABLE "ClientRequest" ADD CONSTRAINT "ClientRequest_clientRelationshipId_practiceId_fkey" FOREIGN KEY ("clientRelationshipId", "practiceId") REFERENCES "ClientRelationship"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClientRequest_jobId_practiceId_fkey') THEN
    ALTER TABLE "ClientRequest" ADD CONSTRAINT "ClientRequest_jobId_practiceId_fkey" FOREIGN KEY ("jobId", "practiceId") REFERENCES "Job"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TimeEntry_jobId_practiceId_fkey') THEN
    ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_jobId_practiceId_fkey" FOREIGN KEY ("jobId", "practiceId") REFERENCES "Job"("id", "practiceId") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
