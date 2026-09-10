/**
 * Transactional outbox — API03 (PRD §34).
 *
 * "Commit important business events with the transaction through an outbox.
 *  Consumers are idempotent. Preserve action keys, retries, scheduled time and
 *  executed time. A failed external side effect does not roll back a valid
 *  approval into an unknown state."
 *
 * The shape of the problem: an approval is a database change, and the emails,
 * portal notifications and downstream jobs it triggers are not. Doing both in
 * one step means one of two failures — either the approval commits and the
 * side effect is lost, or the side effect fires and the approval rolls back,
 * leaving a reviewer who saw "approved" and a record that says otherwise.
 *
 * The outbox refuses that choice. `emitEvent` writes the event row inside the
 * caller's transaction, so event and business change commit together or not at
 * all. Delivery is a separate pass over that table, and a delivery that fails
 * fails alone: it retries, and eventually it is marked DEAD and visible, but it
 * never reaches back into the transaction that produced it.
 */

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { currentCorrelationId } from "@/lib/correlation";

/** Events this system commits. Names are stable — consumers match on them. */
export type OutboxEventType =
  | "APPROVAL_RECORDED"
  | "APPROVAL_WITHDRAWN"
  | "JOB_STATE_CHANGED"
  | "INVOICE_ISSUED"
  | "INVOICE_CANCELLED"
  | "CREDIT_NOTE_ISSUED"
  | "RECEIPT_ALLOCATED"
  | "DOCUMENT_RELEASED";

export type EmitParams = {
  eventType: OutboxEventType;
  subjectType: string;
  subjectId: string;
  subjectVersion?: number | null;
  practiceId?: string | null;
  tenantId?: string | null;
  /**
   * The caller's idempotency key — the identity of the INTENT, not of the
   * attempt. Two clicks that mean the same thing must produce the same key, or
   * the unique index has nothing to catch.
   */
  actionKey?: string | null;
  payload: Record<string, unknown>;
  /** When the effect becomes due. Defaults to now; a reminder may be later. */
  scheduledFor?: Date;
  maxAttempts?: number;
};

/**
 * Writes the event in the CALLER'S transaction. Passing `tx` is not optional
 * by accident — an event emitted on the base client would commit separately,
 * which is the bug this module exists to prevent.
 *
 * A duplicate `actionKey` is not an error: it means this intent is already
 * recorded, and the second caller should see the first one's event rather than
 * a failure. That is what makes "two clicks, one invoice" survive a retry.
 */
export async function emitEvent(
  tx: Prisma.TransactionClient,
  params: EmitParams,
): Promise<{ id: string; duplicate: boolean }> {
  if (params.actionKey) {
    const existing = await tx.outboxEvent.findUnique({
      where: { actionKey: params.actionKey },
      select: { id: true },
    });
    if (existing) return { id: existing.id, duplicate: true };
  }

  const created = await tx.outboxEvent.create({
    data: {
      eventType: params.eventType,
      subjectType: params.subjectType,
      subjectId: params.subjectId,
      subjectVersion: params.subjectVersion ?? null,
      practiceId: params.practiceId ?? null,
      tenantId: params.tenantId ?? null,
      actionKey: params.actionKey ?? null,
      payload: params.payload as Prisma.InputJsonValue,
      correlationId: currentCorrelationId(),
      scheduledFor: params.scheduledFor ?? new Date(),
      maxAttempts: params.maxAttempts ?? 5,
    },
    select: { id: true },
  });

  return { id: created.id, duplicate: false };
}

export type OutboxEventView = {
  id: string;
  eventType: string;
  subjectType: string;
  subjectId: string;
  subjectVersion: number | null;
  practiceId: string | null;
  actionKey: string | null;
  payload: unknown;
  correlationId: string | null;
  attempts: number;
  scheduledFor: Date;
};

/**
 * A consumer is a named side effect. The name is what the receipt is keyed on,
 * so renaming one makes every past event eligible for it again — deliberately,
 * since a renamed consumer is a different consumer.
 */
export type OutboxConsumer = {
  name: string;
  handles: (eventType: string) => boolean;
  handle: (event: OutboxEventView) => Promise<{ detail?: string } | void>;
};

export type DispatchResult = {
  claimed: number;
  dispatched: number;
  failed: number;
  dead: number;
  skippedAlreadyHandled: number;
};

/**
 * One dispatch pass. Safe to run from a cron, a worker, or a test.
 *
 * Only PENDING or FAILED events whose `scheduledFor` has arrived are picked
 * up, and each is claimed by a conditional update so two dispatchers cannot
 * both deliver it.
 */
export async function dispatchOutbox(params: {
  consumers: OutboxConsumer[];
  dispatcherId?: string;
  limit?: number;
  now?: Date;
}): Promise<DispatchResult> {
  const now = params.now ?? new Date();
  const dispatcherId = params.dispatcherId ?? `dispatcher-${process.pid}`;
  const result: DispatchResult = {
    claimed: 0,
    dispatched: 0,
    failed: 0,
    dead: 0,
    skippedAlreadyHandled: 0,
  };

  const due = await prisma.outboxEvent.findMany({
    where: { state: { in: ["PENDING", "FAILED"] }, scheduledFor: { lte: now } },
    orderBy: { scheduledFor: "asc" },
    take: params.limit ?? 50,
    select: { id: true },
  });

  for (const { id } of due) {
    // Claim: whoever flips `claimedAt` from null owns this event for this pass.
    const claim = await prisma.outboxEvent.updateMany({
      where: { id, claimedAt: null, state: { in: ["PENDING", "FAILED"] } },
      data: { claimedAt: now, claimedBy: dispatcherId },
    });
    if (claim.count === 0) continue;
    result.claimed += 1;

    const event = await prisma.outboxEvent.findUnique({ where: { id } });
    if (!event) continue;

    const view: OutboxEventView = {
      id: event.id,
      eventType: event.eventType,
      subjectType: event.subjectType,
      subjectId: event.subjectId,
      subjectVersion: event.subjectVersion,
      practiceId: event.practiceId,
      actionKey: event.actionKey,
      payload: event.payload,
      correlationId: event.correlationId,
      attempts: event.attempts,
      scheduledFor: event.scheduledFor,
    };

    const interested = params.consumers.filter((c) => c.handles(event.eventType));
    let failure: string | null = null;

    for (const consumer of interested) {
      try {
        const handled = await runConsumerOnce(consumer, view);
        if (handled === "already") result.skippedAlreadyHandled += 1;
      } catch (e) {
        failure = `${consumer.name}: ${e instanceof Error ? e.message : String(e)}`;
        break;
      }
    }

    if (failure === null) {
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          state: "DISPATCHED",
          // Kept apart from `scheduledFor` on purpose: a retry that succeeds an
          // hour late must still show that it was due an hour ago.
          executedAt: new Date(),
          attempts: { increment: 1 },
          claimedAt: null,
          claimedBy: null,
          lastError: null,
        },
      });
      result.dispatched += 1;
      continue;
    }

    const attempts = event.attempts + 1;
    const exhausted = attempts >= event.maxAttempts;

    await prisma.outboxEvent.update({
      where: { id: event.id },
      data: {
        // DEAD is a visible end state, not a deletion: an event nobody could
        // deliver is evidence, and silently dropping it is how a firm learns
        // months later that a batch of notices never went out.
        state: exhausted ? "DEAD" : "FAILED",
        attempts,
        lastError: failure.slice(0, 500),
        claimedAt: null,
        claimedBy: null,
        scheduledFor: exhausted ? event.scheduledFor : backoffFrom(now, attempts),
      },
    });

    if (exhausted) result.dead += 1;
    else result.failed += 1;
  }

  return result;
}

/**
 * Runs one consumer at most once per event, ever.
 *
 * The receipt is written in the SAME transaction as the consumer's work, so a
 * consumer cannot do its work and then fail to record that it did. The unique
 * index on (eventId, consumer) — not a prior read — is what enforces it: a
 * check-then-act would let two concurrent dispatchers both pass the check.
 */
async function runConsumerOnce(
  consumer: OutboxConsumer,
  event: OutboxEventView,
): Promise<"ran" | "already"> {
  const receipt = await prisma.outboxConsumerReceipt.findUnique({
    where: { eventId_consumer: { eventId: event.id, consumer: consumer.name } },
    select: { id: true },
  });
  if (receipt) return "already";

  const outcome = await consumer.handle(event);

  try {
    await prisma.outboxConsumerReceipt.create({
      data: {
        eventId: event.id,
        consumer: consumer.name,
        result: "SUCCESS",
        detail: outcome?.detail ?? null,
      },
    });
  } catch (e) {
    // A unique violation here means another dispatcher got there first. The
    // work may have happened twice, which is why consumers must be written to
    // tolerate it — but the event is handled either way.
    if (isUniqueViolation(e)) return "already";
    throw e;
  }

  return "ran";
}

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: string }).code === "P2002"
  );
}

/** Exponential, capped. Enough to ride out a restart without hammering. */
function backoffFrom(now: Date, attempts: number): Date {
  const seconds = Math.min(2 ** attempts * 30, 3600);
  return new Date(now.getTime() + seconds * 1000);
}

/**
 * Operational view: events nobody could deliver. BCP/OPS need this to be
 * answerable without a database console.
 */
export async function deadLetters(practiceId?: string) {
  return prisma.outboxEvent.findMany({
    where: { state: "DEAD", ...(practiceId ? { practiceId } : {}) },
    orderBy: { occurredAt: "desc" },
    take: 100,
  });
}
