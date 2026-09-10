/**
 * Approvals — API02 (PRD §34), on top of IAM04 (PRD §8).
 *
 * PRD §34 acceptance evidence: "Two reviewers approve different versions
 * simultaneously: only the current version can be approved."
 *
 * Until now nothing in the application recorded an approval — `Approval` rows
 * were written directly by the T02 and T09 test scripts. That is exactly the
 * gap this requirement is about: an approval written without a version check
 * is an approval of whatever happens to be in the table when someone looks,
 * which is last-write-wins for the most consequential record in the system.
 *
 * Three properties, in order of importance:
 *
 *   1. An approval names an EXACT subject version. A reviewer who loaded
 *      version 2 and approves while version 3 exists is refused, with a
 *      comparison telling them what moved and who moved it.
 *   2. The version is read under a row lock held for the whole transaction, so
 *      a state transition committing mid-approval cannot slip between the
 *      check and the write.
 *   3. The approval and its outbox event commit together. Whatever the
 *      approval triggers — a notification, a filing job — cannot be lost, and
 *      cannot roll the approval back if it fails (API03).
 */

import type { ApprovalSubjectType, ApprovalDecision } from "@/generated/prisma/enums";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { recordEvent } from "@/lib/audit";
import { assertMayApprove } from "@/lib/separation-of-duties";
import { SubjectNotFoundError, VersionConflictError, versionConflict } from "@/lib/concurrency";
import { emitEvent } from "@/lib/outbox";

export class ApprovalError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "ApprovalError";
  }
}

/**
 * Where each approvable subject's version lives.
 *
 * Table and column names are constants in this map and never come from a
 * caller — they are interpolated into SQL for the row lock, which is only safe
 * because of that. `FILING` resolves to Job: a filing is approved as the job
 * that produces it, which is how T09 already records one.
 */
const SUBJECT_TABLES: Record<
  ApprovalSubjectType,
  { table: string; versionColumn: string }
> = {
  ENGAGEMENT: { table: "Engagement", versionColumn: "version" },
  INVOICE: { table: "Invoice", versionColumn: "version" },
  OBLIGATION: { table: "Obligation", versionColumn: "version" },
  FILING: { table: "Job", versionColumn: "version" },
  // A document version is immutable by construction (DOC02): version n+1 is a
  // new row, never an edit of n. Its "version" is therefore its own number.
  DOCUMENT_VERSION: { table: "DocumentVersion", versionColumn: "versionNo" },
};

/**
 * Reads the subject's current version FOR UPDATE, so the row stays locked for
 * the rest of the transaction. A plain read here would let a state transition
 * commit between the check and the Approval insert, producing an approval that
 * names a version that no longer exists — the precise failure API02 forbids.
 */
async function lockSubjectVersion(
  tx: Prisma.TransactionClient,
  subjectType: ApprovalSubjectType,
  subjectId: string,
  practiceId: string,
): Promise<number> {
  const spec = SUBJECT_TABLES[subjectType];

  const rows = await tx.$queryRaw<{ version: number }[]>(
    Prisma.sql`
      SELECT ${Prisma.raw(`"${spec.versionColumn}"`)} AS "version"
        FROM ${Prisma.raw(`"${spec.table}"`)}
       WHERE "id" = ${subjectId}
         AND "practiceId" = ${practiceId}
       FOR UPDATE
    `,
  );

  // Absent, or in another practice. API01: the caller is never told which.
  if (rows.length === 0) throw new SubjectNotFoundError();

  return Number(rows[0].version);
}

export type RecordApprovalParams = {
  practiceId: string;
  subjectType: ApprovalSubjectType;
  subjectId: string;
  /** The version the reviewer actually looked at. Never defaulted. */
  expectedVersion: number;
  decision: ApprovalDecision;
  approverUserId: string;
  approverDisplayName: string;
  authority: string;
  comments?: string;
  /** FIN02: invoice value, for the IAM04 approval threshold. */
  amount?: Prisma.Decimal | string | null;
  /** Evidence carried onto the approval, where the subject is a filed artefact. */
  sourceFileSha256?: string;
  externalReference?: string;
};

export type RecordedApproval = {
  approvalId: string;
  subjectVersion: number;
  decision: ApprovalDecision;
  /** True when this call matched an approval already recorded (a double click). */
  duplicate: boolean;
  outboxEventId: string;
};

/**
 * Records one approval decision against one exact subject version.
 *
 * Refuses, rather than overwrites, when the subject has moved. Refuses when
 * the approver authored the subject and IAM04 has no disclosed exception for
 * it. Both refusals happen before anything is written.
 */
export async function recordApproval(
  params: RecordApprovalParams,
): Promise<RecordedApproval> {
  if (!Number.isInteger(params.expectedVersion) || params.expectedVersion < 0) {
    throw new ApprovalError(
      "The version being approved must be stated.",
      "EXPECTED_VERSION_REQUIRED",
    );
  }

  // IAM04 runs outside the transaction: it only reads the audit trail and the
  // exception register, and failing it must not leave a lock held.
  await assertMayApprove({
    practiceId: params.practiceId,
    subjectType: params.subjectType,
    subjectId: params.subjectId,
    subjectVersion: params.expectedVersion,
    approverUserId: params.approverUserId,
    amount: params.amount ?? null,
  });

  const outcome = await prisma.$transaction(async (tx) => {
    const currentVersion = await lockSubjectVersion(
      tx,
      params.subjectType,
      params.subjectId,
      params.practiceId,
    );

    if (currentVersion !== params.expectedVersion) {
      throw await versionConflict({
        subjectType: params.subjectType,
        subjectId: params.subjectId,
        // The audit trail knows a filing as its Job, not as `FILING` — without
        // both names the comparison cannot say who moved the record.
        auditTargetTypes: [params.subjectType, SUBJECT_TABLES[params.subjectType].table],
        expectedVersion: params.expectedVersion,
        currentVersion,
        message:
          `This ${params.subjectType.toLowerCase().replace("_", " ")} changed while you were ` +
          `reviewing it (you saw version ${params.expectedVersion}, it is now version ` +
          `${currentVersion}). Reload and review the current version before approving.`,
      });
    }

    // A second click from the same reviewer on the same version is the same
    // decision, not a second one. Recorded once, reported as a duplicate.
    const existing = await tx.approval.findFirst({
      where: {
        practiceId: params.practiceId,
        subjectType: params.subjectType,
        subjectId: params.subjectId,
        subjectVersion: currentVersion,
        actorUserId: params.approverUserId,
        decision: params.decision,
      },
      select: { id: true },
    });

    if (existing) {
      const event = await emitEvent(tx, {
        eventType: params.decision === "APPROVED" ? "APPROVAL_RECORDED" : "APPROVAL_WITHDRAWN",
        subjectType: params.subjectType,
        subjectId: params.subjectId,
        subjectVersion: currentVersion,
        practiceId: params.practiceId,
        actionKey: approvalActionKey(params, currentVersion),
        payload: { approvalId: existing.id, decision: params.decision },
      });
      return {
        approvalId: existing.id,
        subjectVersion: currentVersion,
        duplicate: true,
        outboxEventId: event.id,
      };
    }

    const approval = await tx.approval.create({
      data: {
        practiceId: params.practiceId,
        subjectType: params.subjectType,
        subjectId: params.subjectId,
        subjectVersion: currentVersion,
        actorUserId: params.approverUserId,
        // DAT02/DAT03: the name is kept so a purged account still leaves an
        // identifiable approval.
        actorDisplayName: params.approverDisplayName,
        authority: params.authority,
        decision: params.decision,
        comments: params.comments ?? null,
        sourceFileSha256: params.sourceFileSha256 ?? null,
        externalReference: params.externalReference ?? null,
      },
      select: { id: true },
    });

    // API03: same transaction. If the notification cannot be sent later, the
    // approval still stands and the event is retried — the approval is never
    // left in an unknown state because a side effect failed.
    const event = await emitEvent(tx, {
      eventType: params.decision === "APPROVED" ? "APPROVAL_RECORDED" : "APPROVAL_WITHDRAWN",
      subjectType: params.subjectType,
      subjectId: params.subjectId,
      subjectVersion: currentVersion,
      practiceId: params.practiceId,
      actionKey: approvalActionKey(params, currentVersion),
      payload: {
        approvalId: approval.id,
        decision: params.decision,
        approverUserId: params.approverUserId,
        authority: params.authority,
      },
    });

    return {
      approvalId: approval.id,
      subjectVersion: currentVersion,
      duplicate: false,
      outboxEventId: event.id,
    };
  });

  // SEC04: APPROVAL_RECORDED is on the sensitive list. Written after commit so
  // an audit failure cannot destroy the approval it is describing; the outbox
  // row inside the transaction is the durable record either way.
  await recordEvent({
    action: "APPROVAL_RECORDED",
    targetType: params.subjectType,
    targetId: params.subjectId,
    targetVersion: outcome.subjectVersion,
    result: "SUCCESS",
    actorUserId: params.approverUserId,
    practiceId: params.practiceId,
    reason: params.comments ?? null,
    afterMeta: {
      decision: params.decision,
      authority: params.authority,
      duplicate: outcome.duplicate,
    },
  });

  return { ...outcome, decision: params.decision };
}

/**
 * The identity of the INTENT: this reviewer, this decision, on this exact
 * version of this subject. Two clicks produce the same key; a decision on a
 * later version does not.
 */
function approvalActionKey(params: RecordApprovalParams, version: number): string {
  return [
    "approval",
    params.practiceId,
    params.subjectType,
    params.subjectId,
    version,
    params.approverUserId,
    params.decision,
  ].join(":");
}

/** WRK02/API02: approvals that still name the subject's present version. */
export async function currentApprovalsFor(params: {
  practiceId: string;
  subjectType: ApprovalSubjectType;
  subjectId: string;
}) {
  const spec = SUBJECT_TABLES[params.subjectType];

  const rows = await prisma.$queryRaw<{ version: number }[]>(
    Prisma.sql`
      SELECT ${Prisma.raw(`"${spec.versionColumn}"`)} AS "version"
        FROM ${Prisma.raw(`"${spec.table}"`)}
       WHERE "id" = ${params.subjectId}
         AND "practiceId" = ${params.practiceId}
    `,
  );

  if (rows.length === 0) throw new SubjectNotFoundError();

  return prisma.approval.findMany({
    where: {
      practiceId: params.practiceId,
      subjectType: params.subjectType,
      subjectId: params.subjectId,
      subjectVersion: Number(rows[0].version),
      decision: "APPROVED",
    },
    orderBy: { decidedAt: "desc" },
  });
}

export { VersionConflictError };
