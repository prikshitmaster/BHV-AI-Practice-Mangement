-- CreateEnum
CREATE TYPE "OutboxState" AS ENUM ('PENDING', 'DISPATCHED', 'FAILED', 'DEAD');

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "practiceId" TEXT,
    "eventType" TEXT NOT NULL,
    "actionKey" TEXT,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "subjectVersion" INTEGER,
    "payload" JSONB NOT NULL,
    "correlationId" TEXT,
    "state" "OutboxState" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lastError" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduledFor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executedAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "claimedBy" TEXT,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxConsumerReceipt" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "consumer" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "detail" TEXT,
    "handledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxConsumerReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OutboxEvent_actionKey_key" ON "OutboxEvent"("actionKey");

-- CreateIndex
CREATE INDEX "OutboxEvent_state_scheduledFor_idx" ON "OutboxEvent"("state", "scheduledFor");

-- CreateIndex
CREATE INDEX "OutboxEvent_practiceId_subjectType_subjectId_idx" ON "OutboxEvent"("practiceId", "subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "OutboxConsumerReceipt_consumer_handledAt_idx" ON "OutboxConsumerReceipt"("consumer", "handledAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxConsumerReceipt_eventId_consumer_key" ON "OutboxConsumerReceipt"("eventId", "consumer");

-- AddForeignKey
ALTER TABLE "OutboxConsumerReceipt" ADD CONSTRAINT "OutboxConsumerReceipt_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "OutboxEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

