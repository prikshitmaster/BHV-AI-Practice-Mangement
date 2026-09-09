/**
 * Work model, state machine, recurrence and queues — WRK01-05 (PRD §13).
 * WRK06 (automation designer) is R1.
 *
 * Three requirements drive the design:
 *
 * WRK03  The duplicate-prevention key is practice + client relationship +
 *        stable template/obligation identity + period. The template VERSION is
 *        snapshot metadata and is deliberately NOT part of that key — if it
 *        were, editing a template would silently regenerate every open job.
 *
 * WRK02  Requesting changes after review must invalidate the earlier approval.
 *        Rather than mutating approval history (which DAT02 forbids), an
 *        approval is valid only while it matches the subject's CURRENT version;
 *        a change request bumps the version, so prior approvals go stale on
 *        their own.
 *
 * WRK04  A client delay pauses the internal SLA clock only. The statutory
 *        deadline on the Obligation is never moved, and escalation continues.
 */

import type { WorkState, WorkSubjectType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { recordEvent } from "@/lib/audit";

export class WorkError extends Error {
  readonly status = 409;
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "WorkError";
  }
}

// ---------------------------------------------------------------- WRK02

/**
 * Legal transitions. Anything not listed is refused server-side, so a board
 * drag cannot reach a state a form would not allow — "Dragging a card must
 * invoke the same server rules as the form and API."
 */
const TRANSITIONS: Record<WorkState, WorkState[]> = {
  DRAFT: ["READY", "CANCELLED"],
  READY: ["IN_PROGRESS", "WAITING_FOR_CLIENT", "WAITING_INTERNALLY", "CANCELLED"],
  IN_PROGRESS: [
    "WAITING_FOR_CLIENT",
    "WAITING_INTERNALLY",
    "IN_REVIEW",
    "READY",
    "CANCELLED",
  ],
  WAITING_FOR_CLIENT: ["IN_PROGRESS", "WAITING_INTERNALLY", "CANCELLED"],
  WAITING_INTERNALLY: ["IN_PROGRESS", "WAITING_FOR_CLIENT", "CANCELLED"],
  IN_REVIEW: ["CHANGES_REQUESTED", "APPROVED_FOR_ACTION", "CANCELLED"],
  // Changes requested sends the work back — it cannot jump straight to done.
  CHANGES_REQUESTED: ["IN_PROGRESS", "CANCELLED"],
  APPROVED_FOR_ACTION: ["SUBMITTED_DELIVERED", "CHANGES_REQUESTED", "CANCELLED"],
  SUBMITTED_DELIVERED: ["COMPLETED", "CHANGES_REQUESTED"],
  COMPLETED: ["REOPENED"],
  CANCELLED: ["REOPENED"],
  REOPENED: ["IN_PROGRESS", "READY", "CANCELLED"],
};

export function canTransition(from: WorkState, to: WorkState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** States that mean a reviewer has signed off on the current version. */
const APPROVED_STATES: WorkState[] = ["APPROVED_FOR_ACTION", "SUBMITTED_DELIVERED", "COMPLETED"];

export async function transitionJob(params: {
  jobId: string;
  practiceId: string;
  toState: WorkState;
  actorUserId: string;
  actorName: string;
  reason?: string;
}) {
  const job = await prisma.job.findFirstOrThrow({
    where: { id: params.jobId, practiceId: params.practiceId },
  });

  if (!canTransition(job.state, params.toState)) {
    throw new WorkError(
      `Cannot move a job from ${job.state} to ${params.toState}.`,
      "ILLEGAL_TRANSITION",
    );
  }

  // Reopening and requesting changes both require a stated reason: they undo
  // a review decision someone else relied on.
  if (
    (params.toState === "REOPENED" || params.toState === "CHANGES_REQUESTED") &&
    !params.reason?.trim()
  ) {
    throw new WorkError(
      `Moving to ${params.toState} requires a reason.`,
      "REASON_REQUIRED",
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.job.update({
      where: { id: job.id },
      data: {
        state: params.toState,
        // Bumping the version is what invalidates any approval given against
        // the previous version (API02 / WRK02).
        version: { increment: 1 },
        reopenCount: params.toState === "REOPENED" ? { increment: 1 } : undefined,
        // completedAt is NOT cleared on reopen — the completion history must
        // survive. The transition log records the reopening separately.
        completedAt: params.toState === "COMPLETED" ? new Date() : undefined,
      },
    });

    await tx.workStateTransition.create({
      data: {
        practiceId: params.practiceId,
        subjectType: "JOB",
        subjectId: job.id,
        fromState: job.state,
        toState: params.toState,
        actorUserId: params.actorUserId,
        actorName: params.actorName,
        reason: params.reason,
        subjectVersion: next.version,
      },
    });

    return next;
  });

  await recordEvent({
    action: `JOB_${params.toState}`,
    targetType: "Job",
    targetId: job.id,
    targetVersion: updated.version,
    result: "SUCCESS",
    actorUserId: params.actorUserId,
    practiceId: params.practiceId,
    reason: params.reason,
    beforeMeta: { state: job.state, version: job.version },
    afterMeta: { state: updated.state, version: updated.version },
  });

  return updated;
}

/**
 * WRK02 acceptance evidence: "Request changes after review and verify the
 * previous approval is invalidated."
 *
 * An approval is current only while it names the subject's present version.
 */
export async function currentApprovals(subjectId: string, subjectVersion: number) {
  return prisma.approval.findMany({
    where: { subjectId, subjectVersion, decision: "APPROVED" },
  });
}

export async function staleApprovals(subjectId: string, subjectVersion: number) {
  return prisma.approval.findMany({
    where: { subjectId, subjectVersion: { not: subjectVersion }, decision: "APPROVED" },
  });
}

export async function isApprovedForAction(jobId: string): Promise<boolean> {
  const job = await prisma.job.findUniqueOrThrow({
    where: { id: jobId },
    select: { version: true, state: true },
  });
  if (!APPROVED_STATES.includes(job.state)) return false;

  const current = await currentApprovals(jobId, job.version);
  return current.length > 0;
}

// ---------------------------------------------------------------- WRK03

export type RecurrenceSpec = {
  practiceId: string;
  clientRelationshipId: string;
  engagementId: string;
  /** Stable identity — a template CODE or obligation id, never a version. */
  templateIdentity: string;
  templateVersion: number;
  periodKeys: string[];
  titleFor: (periodKey: string) => string;
  dueDateFor?: (periodKey: string) => Date | undefined;
  ownerUserId?: string;
  reviewerUserId?: string;
};

/** WRK03: the duplicate-prevention identity. Note the absence of the version. */
export function buildDedupKey(spec: {
  practiceId: string;
  clientRelationshipId: string;
  templateIdentity: string;
  periodKey: string;
}): string {
  return [
    spec.practiceId,
    spec.clientRelationshipId,
    spec.templateIdentity,
    spec.periodKey,
  ].join("|");
}

/** WRK03: "Preview bulk creation." Shows what would be made, and what exists. */
export async function previewRecurrence(spec: RecurrenceSpec) {
  const keys = spec.periodKeys.map((periodKey) => ({
    periodKey,
    dedupKey: buildDedupKey({
      practiceId: spec.practiceId,
      clientRelationshipId: spec.clientRelationshipId,
      templateIdentity: spec.templateIdentity,
      periodKey,
    }),
  }));

  const existing = await prisma.job.findMany({
    where: { practiceId: spec.practiceId, dedupKey: { in: keys.map((k) => k.dedupKey) } },
    select: { dedupKey: true, id: true, state: true, periodKey: true },
  });
  const existingByKey = new Map(existing.map((e) => [e.dedupKey, e]));

  return {
    toCreate: keys.filter((k) => !existingByKey.has(k.dedupKey)),
    alreadyExisting: keys
      .filter((k) => existingByKey.has(k.dedupKey))
      .map((k) => ({ ...k, existing: existingByKey.get(k.dedupKey)! })),
  };
}

/**
 * Generate recurring jobs. Idempotent by construction: the unique index on
 * (practiceId, dedupKey) is the real guarantee, and `skipDuplicates` means a
 * second run is a no-op rather than an error.
 */
export async function generateRecurringJobs(spec: RecurrenceSpec) {
  const preview = await previewRecurrence(spec);

  if (preview.toCreate.length === 0) {
    return { created: 0, skipped: preview.alreadyExisting.length, preview };
  }

  const result = await prisma.job.createMany({
    data: preview.toCreate.map((k) => ({
      practiceId: spec.practiceId,
      engagementId: spec.engagementId,
      title: spec.titleFor(k.periodKey),
      periodKey: k.periodKey,
      dedupKey: k.dedupKey,
      // Snapshot metadata — recorded, but not part of the identity above.
      templateVersionSnapshot: {
        templateIdentity: spec.templateIdentity,
        templateVersion: spec.templateVersion,
        generatedAt: new Date().toISOString(),
      } as never,
      dueDate: spec.dueDateFor?.(k.periodKey),
      ownerUserId: spec.ownerUserId,
      reviewerUserId: spec.reviewerUserId,
      state: "READY" as const,
    })),
    skipDuplicates: true,
  });

  return { created: result.count, skipped: preview.alreadyExisting.length, preview };
}

// ---------------------------------------------------------------- WRK04

/** A task is blocked while any predecessor is unfinished or evidence missing. */
export async function blockingReasons(taskId: string): Promise<string[]> {
  const deps = await prisma.taskDependency.findMany({
    where: { taskId },
    include: { dependsOnTask: { select: { id: true, title: true, state: true } } },
  });

  const reasons: string[] = [];

  for (const dep of deps) {
    if (dep.dependsOnTask.state !== "COMPLETED" && dep.dependsOnTask.state !== "CANCELLED") {
      reasons.push(
        `Waiting on "${dep.dependsOnTask.title}" (${dep.dependsOnTask.state})`,
      );
    }
    if (dep.requiredEvidenceLabel && !dep.evidenceDocumentId) {
      reasons.push(`Missing evidence: ${dep.requiredEvidenceLabel}`);
    }
  }

  return reasons;
}

export async function startTask(params: {
  taskId: string;
  practiceId: string;
  actorUserId: string;
  actorName: string;
}) {
  const blocked = await blockingReasons(params.taskId);
  if (blocked.length > 0) {
    throw new WorkError(`Task is blocked: ${blocked.join("; ")}`, "BLOCKED");
  }

  const task = await prisma.task.findFirstOrThrow({
    where: { id: params.taskId, practiceId: params.practiceId },
  });

  if (!canTransition(task.state, "IN_PROGRESS")) {
    throw new WorkError(
      `Cannot start a task in state ${task.state}.`,
      "ILLEGAL_TRANSITION",
    );
  }

  const updated = await prisma.task.update({
    where: { id: task.id },
    data: { state: "IN_PROGRESS", version: { increment: 1 } },
  });

  await prisma.workStateTransition.create({
    data: {
      practiceId: params.practiceId,
      subjectType: "TASK",
      subjectId: task.id,
      fromState: task.state,
      toState: "IN_PROGRESS",
      actorUserId: params.actorUserId,
      actorName: params.actorName,
      subjectVersion: updated.version,
    },
  });

  return updated;
}

/**
 * WRK04: pausing the internal clock for a client delay.
 *
 * Returns the statutory date alongside, unchanged, so a caller can see plainly
 * that pausing internal SLA has not moved the legal deadline.
 */
export async function pauseForClient(params: {
  clientRequestId: string;
  obligationId?: string;
}) {
  const request = await prisma.clientRequest.update({
    where: { id: params.clientRequestId },
    data: { state: "SENT", sentAt: new Date(), slaPausedAt: new Date() },
  });

  const obligation = params.obligationId
    ? await prisma.obligation.findUnique({
        where: { id: params.obligationId },
        select: { currentStatutoryDate: true, internalTargetDate: true, status: true },
      })
    : null;

  return {
    request,
    // Untouched. Escalation continues for legal risk even while the client
    // is pending.
    statutoryDateUnchanged: obligation?.currentStatutoryDate ?? null,
    escalationContinues: true,
  };
}

export async function resumeAfterClient(clientRequestId: string) {
  const request = await prisma.clientRequest.findUniqueOrThrow({
    where: { id: clientRequestId },
  });

  const pausedMs = request.slaPausedAt
    ? Date.now() - request.slaPausedAt.getTime()
    : 0;

  return prisma.clientRequest.update({
    where: { id: clientRequestId },
    data: {
      state: "RECEIVED",
      receivedAt: new Date(),
      slaPausedAt: null,
      slaPausedTotalMs: request.slaPausedTotalMs + pausedMs,
    },
  });
}

// ---------------------------------------------------------------- WRK05

export type QueueName =
  | "MY_WORK"
  | "TEAM_WORK"
  | "REVIEW_QUEUE"
  | "WAITING_FOR_CLIENT"
  | "OVERDUE";

const OPEN_STATES: WorkState[] = [
  "DRAFT", "READY", "IN_PROGRESS", "WAITING_FOR_CLIENT",
  "WAITING_INTERNALLY", "IN_REVIEW", "CHANGES_REQUESTED", "APPROVED_FOR_ACTION",
];

/**
 * The saved views from WRK05. Every one is bounded by `practiceIds`, which the
 * caller must obtain from the practice-scope guard — a queue is a very easy
 * place to accidentally return the whole tenant.
 */
export async function queue(params: {
  name: QueueName;
  userId: string;
  practiceIds: string[];
  teamId?: string | null;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const scope = { practiceId: { in: params.practiceIds } };

  switch (params.name) {
    case "MY_WORK":
      return prisma.job.findMany({
        where: { ...scope, ownerUserId: params.userId, state: { in: OPEN_STATES }, archivedAt: null },
        orderBy: [{ dueDate: "asc" }, { priority: "desc" }],
      });

    case "TEAM_WORK":
      return prisma.job.findMany({
        where: {
          ...scope,
          state: { in: OPEN_STATES },
          archivedAt: null,
          tasks: params.teamId ? { some: { practiceId: { in: params.practiceIds } } } : undefined,
        },
        orderBy: [{ dueDate: "asc" }],
      });

    case "REVIEW_QUEUE":
      return prisma.job.findMany({
        where: {
          ...scope,
          reviewerUserId: params.userId,
          state: { in: ["IN_REVIEW", "CHANGES_REQUESTED"] },
          archivedAt: null,
        },
        orderBy: [{ dueDate: "asc" }],
      });

    case "WAITING_FOR_CLIENT":
      return prisma.job.findMany({
        where: { ...scope, state: "WAITING_FOR_CLIENT", archivedAt: null },
        orderBy: [{ dueDate: "asc" }],
      });

    case "OVERDUE":
      return prisma.job.findMany({
        where: {
          ...scope,
          state: { in: OPEN_STATES },
          dueDate: { lt: now },
          archivedAt: null,
        },
        orderBy: [{ dueDate: "asc" }],
      });
  }
}

/** WRK05: reassignment carries the reason, the running timer and open approvals. */
export async function reassignJob(params: {
  jobId: string;
  practiceId: string;
  toUserId: string;
  reason: string;
  actorUserId: string;
  actorName: string;
}) {
  if (!params.reason?.trim()) {
    throw new WorkError("Reassignment requires a reason.", "REASON_REQUIRED");
  }

  const job = await prisma.job.findFirstOrThrow({
    where: { id: params.jobId, practiceId: params.practiceId },
  });

  const activeTimers = await prisma.timeEntry.findMany({
    where: { jobId: job.id, stoppedAt: null },
    select: { id: true, userId: true },
  });

  const pendingApprovals = await prisma.approval.count({
    where: { subjectType: "FILING", subjectId: job.id, decision: "APPROVED", subjectVersion: job.version },
  });

  const [updated, record] = await prisma.$transaction([
    prisma.job.update({
      where: { id: job.id },
      data: { ownerUserId: params.toUserId, version: { increment: 1 } },
    }),
    prisma.workReassignment.create({
      data: {
        practiceId: params.practiceId,
        subjectType: "JOB" as WorkSubjectType,
        subjectId: job.id,
        fromUserId: job.ownerUserId,
        toUserId: params.toUserId,
        reason: params.reason,
        actorUserId: params.actorUserId,
        actorName: params.actorName,
        activeTimerIds: activeTimers.map((t) => t.id),
        pendingApprovalsCount: pendingApprovals,
        notifiedAt: new Date(),
      },
    }),
  ]);

  // A timer left running under the previous owner would quietly bill the wrong
  // person, so it moves with the work rather than being abandoned.
  if (activeTimers.length > 0) {
    await prisma.timeEntry.updateMany({
      where: { id: { in: activeTimers.map((t) => t.id) } },
      data: { userId: params.toUserId },
    });
  }

  await recordEvent({
    action: "JOB_REASSIGNED",
    targetType: "Job",
    targetId: job.id,
    targetVersion: updated.version,
    result: "SUCCESS",
    actorUserId: params.actorUserId,
    practiceId: params.practiceId,
    reason: params.reason,
    afterMeta: {
      fromUserId: job.ownerUserId,
      toUserId: params.toUserId,
      activeTimersTransferred: activeTimers.length,
      pendingApprovals,
    },
  });

  return { job: updated, reassignment: record };
}

/**
 * WRK05: "Employee exit generates a handover list, not orphaned jobs."
 * Returns what must be rehomed, rather than silently nulling the owner.
 */
export async function handoverList(params: { userId: string; practiceIds: string[] }) {
  const scope = { practiceId: { in: params.practiceIds } };

  const [ownedJobs, reviewingJobs, assignedTasks, runningTimers, openRequests] =
    await Promise.all([
      prisma.job.findMany({
        where: { ...scope, ownerUserId: params.userId, state: { in: OPEN_STATES }, archivedAt: null },
        select: { id: true, title: true, state: true, dueDate: true, priority: true },
      }),
      prisma.job.findMany({
        where: { ...scope, reviewerUserId: params.userId, state: { in: OPEN_STATES }, archivedAt: null },
        select: { id: true, title: true, state: true },
      }),
      prisma.task.findMany({
        where: { ...scope, assigneeUserId: params.userId, state: { in: OPEN_STATES }, archivedAt: null },
        select: { id: true, title: true, state: true },
      }),
      prisma.timeEntry.findMany({
        where: { ...scope, userId: params.userId, stoppedAt: null },
        select: { id: true, jobId: true, startedAt: true },
      }),
      prisma.clientRequest.findMany({
        where: { ...scope, state: { in: ["OPEN", "SENT", "PARTIALLY_RECEIVED"] } },
        select: { id: true, title: true, state: true, dueDate: true },
      }),
    ]);

  return {
    ownedJobs,
    reviewingJobs,
    assignedTasks,
    runningTimers,
    openClientRequests: openRequests,
    totalItems:
      ownedJobs.length +
      reviewingJobs.length +
      assignedTasks.length +
      runningTimers.length,
    // Stated explicitly so a caller cannot mistake an empty handover for a
    // completed one.
    requiresRehoming:
      ownedJobs.length + reviewingJobs.length + assignedTasks.length > 0,
  };
}

// ---------------------------------------------------------------- WRK01

/**
 * WRK01: "Required steps can be completed only by the authorised role;
 * optional steps record Not applicable with reason."
 */
export async function completeChecklistItem(params: {
  itemId: string;
  practiceId: string;
  userId: string;
  userRole: string;
}) {
  const item = await prisma.checklistItem.findFirstOrThrow({
    where: { id: params.itemId, practiceId: params.practiceId },
  });

  if (item.isRequired && item.requiredRole && item.requiredRole !== params.userRole) {
    throw new WorkError(
      `This step must be completed by ${item.requiredRole}; you are ${params.userRole}.`,
      "ROLE_NOT_AUTHORISED",
    );
  }

  return prisma.checklistItem.update({
    where: { id: item.id },
    data: { isComplete: true, completedAt: new Date(), completedByUserId: params.userId },
  });
}

export async function markChecklistItemNotApplicable(params: {
  itemId: string;
  practiceId: string;
  reason: string;
}) {
  const item = await prisma.checklistItem.findFirstOrThrow({
    where: { id: params.itemId, practiceId: params.practiceId },
  });

  if (item.isRequired) {
    throw new WorkError(
      "A required step cannot be marked not applicable.",
      "REQUIRED_STEP",
    );
  }
  if (!params.reason?.trim()) {
    throw new WorkError(
      "Marking a step not applicable requires a reason.",
      "REASON_REQUIRED",
    );
  }

  return prisma.checklistItem.update({
    where: { id: item.id },
    data: { notApplicable: true, notApplicableReason: params.reason },
  });
}
