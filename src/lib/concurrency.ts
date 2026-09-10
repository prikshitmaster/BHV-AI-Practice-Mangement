/**
 * Optimistic concurrency — API02 (PRD §34).
 *
 * "Use optimistic version checks for drafts and configuration. If another user
 *  changes the record, present a comparison and reload / merge option; never
 *  silently last write wins for approvals, deadlines, allocations or signed
 *  material."
 *
 * Two halves, and the second is the one usually skipped. Refusing the stale
 * write is easy; giving the loser something to DO about it is what stops them
 * re-typing their change over the winner's, which is last-write-wins with
 * extra steps. So a conflict here always carries a comparison: the version the
 * caller held, the version that now exists, which fields differ, and who moved
 * them — enough for a screen to offer "reload" or "merge" honestly.
 *
 * T14 already did this inline for invoices and fee arrangements. This module
 * is that property made general, so a module added later gets it by using the
 * helper rather than by remembering the rule.
 */

import { prisma } from "@/lib/prisma";

/** What changed underneath the caller, in terms a screen can render. */
export type VersionComparison = {
  subjectType: string;
  subjectId: string;
  expectedVersion: number;
  currentVersion: number;
  /** Field-by-field: what the caller was about to write vs what is there now. */
  differences: Array<{ field: string; yours: unknown; theirs: unknown }>;
  /** Who moved it last, from the audit trail. Null if nothing was audited. */
  lastChange: {
    action: string;
    actorUserId: string | null;
    at: string;
    correlationId: string | null;
  } | null;
  /**
   * What the screen may offer. `merge` only when the two edits touched
   * disjoint fields — otherwise there is nothing to merge and offering it
   * would invite the user to clobber a change they never saw.
   */
  resolutions: Array<"reload" | "merge">;
};

export class VersionConflictError extends Error {
  readonly code = "VERSION_CONFLICT";
  readonly status = 409;
  readonly comparison: VersionComparison;

  constructor(comparison: VersionComparison, message?: string) {
    super(
      message ??
        `This ${comparison.subjectType} was changed by someone else (you had version ` +
          `${comparison.expectedVersion}, it is now version ${comparison.currentVersion}). ` +
          `Reload to see the current version.`,
    );
    this.name = "VersionConflictError";
    this.comparison = comparison;
  }
}

/** A record that is missing OR out of the caller's scope — never distinguished. */
export class SubjectNotFoundError extends Error {
  readonly code = "NOT_FOUND";
  readonly status = 404;

  constructor() {
    super("Not found");
    this.name = "SubjectNotFoundError";
  }
}

/**
 * The subset of a Prisma model delegate this helper needs. Structural rather
 * than generic over the client, so any versioned model can be passed without
 * this file importing all ninety-odd of them.
 */
export type VersionedDelegate = {
  updateMany(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<{ count: number }>;
  findFirst(args: {
    where: Record<string, unknown>;
  }): Promise<Record<string, unknown> | null>;
};

export type VersionedUpdate = {
  delegate: VersionedDelegate;
  subjectType: string;
  subjectId: string;
  /** Practice scope, always part of the WHERE — never left to the caller's UI. */
  scope: Record<string, unknown>;
  expectedVersion: number;
  data: Record<string, unknown>;
};

/**
 * A conditional update: the version is part of the WHERE, so the database —
 * not a read-then-write in application code — decides who wins. A zero-row
 * result is a conflict, and the only path from here is a thrown comparison.
 *
 * Deliberately NOT a read-check-write: between the read and the write another
 * transaction can commit, and the check would pass while the write clobbers.
 */
export async function updateWithVersion(u: VersionedUpdate): Promise<number> {
  const { count } = await u.delegate.updateMany({
    where: { ...u.scope, id: u.subjectId, version: u.expectedVersion },
    data: { ...u.data, version: { increment: 1 } },
  });

  if (count === 1) return u.expectedVersion + 1;

  throw await buildConflict(u);
}

/**
 * Reads the current row and the last audited change to explain the refusal.
 * Runs only on the losing path, so the happy path stays one statement.
 */
async function buildConflict(u: VersionedUpdate): Promise<Error> {
  const current = await u.delegate.findFirst({
    where: { ...u.scope, id: u.subjectId },
  });

  // Gone, or never in this practice. API01: the caller is not told which.
  if (!current) return new SubjectNotFoundError();

  const currentVersion = typeof current.version === "number" ? current.version : -1;

  const differences: VersionComparison["differences"] = [];
  for (const [field, yours] of Object.entries(u.data)) {
    // Skip the operator objects (`{ increment: 1 }`) — they describe a delta,
    // not a value, and rendering one in a comparison would be gibberish.
    if (yours !== null && typeof yours === "object" && !(yours instanceof Date)) continue;
    const theirs = current[field];
    if (!sameValue(yours, theirs)) differences.push({ field, yours, theirs });
  }

  const lastChange = await lastAuditedChange([u.subjectType], u.subjectId);

  // Merge is offered only when the other party touched fields this caller did
  // not. `differences` here lists exactly the fields this caller WOULD change
  // and where they disagree with the stored row, so an empty list means the
  // two edits do not collide and a merge is honest.
  const resolutions: VersionComparison["resolutions"] =
    differences.length === 0 ? ["reload", "merge"] : ["reload"];

  return new VersionConflictError({
    subjectType: u.subjectType,
    subjectId: u.subjectId,
    expectedVersion: u.expectedVersion,
    currentVersion,
    differences,
    lastChange,
    resolutions,
  });
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

/**
 * The audit trail records a target TYPE, and it is not always the same string
 * as the approval subject type: a filing is approved as `FILING` but audited
 * as the `Job` that produces it. So the lookup takes every name the record is
 * known by — getting this wrong silently returns "nobody changed it", which is
 * the least useful thing a conflict screen can say.
 */
async function lastAuditedChange(
  targetTypes: string[],
  subjectId: string,
): Promise<VersionComparison["lastChange"]> {
  const lastEvent = await prisma.event.findFirst({
    where: { targetType: { in: targetTypes }, targetId: subjectId },
    orderBy: { createdAt: "desc" },
    select: { action: true, actorUserId: true, createdAt: true, correlationId: true },
  });

  if (!lastEvent) return null;

  return {
    action: lastEvent.action,
    actorUserId: lastEvent.actorUserId,
    at: lastEvent.createdAt.toISOString(),
    correlationId: lastEvent.correlationId,
  };
}

/**
 * Builds the same comparison for a caller that discovered the conflict some
 * other way — a lifecycle guard that fired before the update, say. Keeps every
 * 409 in the system one shape.
 */
export async function versionConflict(params: {
  subjectType: string;
  subjectId: string;
  expectedVersion: number;
  currentVersion: number;
  /** Every name the audit trail may know this record by. Defaults to the subject type. */
  auditTargetTypes?: string[];
  message?: string;
}): Promise<VersionConflictError> {
  return new VersionConflictError(
    {
      subjectType: params.subjectType,
      subjectId: params.subjectId,
      expectedVersion: params.expectedVersion,
      currentVersion: params.currentVersion,
      differences: [],
      lastChange: await lastAuditedChange(
        params.auditTargetTypes ?? [params.subjectType],
        params.subjectId,
      ),
      resolutions: ["reload"],
    },
    params.message,
  );
}
