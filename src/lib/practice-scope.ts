/**
 * Server-side practice scope guard — ORG01/ORG04 (PRD §7) and IAM01 (§8).
 *
 * The rule this file exists to enforce: a combined view is a PERMISSION, not
 * the default consequence of two practices sharing a tenant. Access is denied
 * unless a live membership says otherwise.
 *
 * Every practice-scoped read or write must obtain its filter from here.
 * Nothing may pass a practiceId straight from a URL, request body, or search
 * parameter into a query — that is exactly the leak the ORG acceptance test
 * probes through URL, API, search, export, email job and object link.
 */

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export class PracticeAccessError extends Error {
  readonly code = "PRACTICE_ACCESS_DENIED";
  readonly status = 404;

  constructor(
    readonly userId: string,
    readonly requestedPracticeId: string,
  ) {
    // Deliberately vague: telling an Associates user that a Company practice
    // "exists but is forbidden" is itself a cross-practice disclosure. The
    // audit Event carries the real detail.
    super("Not found");
    this.name = "PracticeAccessError";
  }
}

/** A membership that is live right now — not future-dated, expired or revoked. */
function liveMembershipWhere(
  userId: string,
  now: Date,
): Prisma.PracticeMembershipWhereInput {
  return {
    userId,
    revokedAt: null,
    effectiveFrom: { lte: now },
    AND: [
      { OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
      { OR: [{ grantExpiresAt: null }, { grantExpiresAt: { gt: now } }] },
    ],
    // A deactivated practice is read-only, but a practice archived outright
    // grants nothing.
    practice: { archivedAt: null },
    user: { status: { in: ["ACTIVE", "INVITED"] } },
  };
}

/**
 * Every practice this user may currently act in. Empty array means no access
 * to anything — which callers must treat as "show nothing", never "show all".
 */
export async function getAccessiblePracticeIds(
  userId: string,
  now: Date = new Date(),
): Promise<string[]> {
  const memberships = await prisma.practiceMembership.findMany({
    where: liveMembershipWhere(userId, now),
    select: { practiceId: true },
    distinct: ["practiceId"],
  });
  return memberships.map((m) => m.practiceId);
}

/**
 * Assert this user may act in this specific practice. Throws
 * PracticeAccessError otherwise. Call this before ANY practice-scoped work.
 */
export async function assertPracticeAccess(
  userId: string,
  practiceId: string,
  now: Date = new Date(),
): Promise<void> {
  const membership = await prisma.practiceMembership.findFirst({
    where: { ...liveMembershipWhere(userId, now), practiceId },
    select: { id: true },
  });

  if (!membership) {
    await recordDeniedAccess(userId, practiceId);
    throw new PracticeAccessError(userId, practiceId);
  }
}

/**
 * The `where` fragment for a practice-scoped query. Using this instead of a
 * hand-written filter is what makes "deny by default" structural: with no
 * memberships the filter becomes `practiceId IN ()`, which matches nothing.
 */
export async function practiceScopeFilter(
  userId: string,
  requestedPracticeId?: string,
  now: Date = new Date(),
): Promise<{ practiceId: { in: string[] } }> {
  const allowed = await getAccessiblePracticeIds(userId, now);

  if (requestedPracticeId) {
    if (!allowed.includes(requestedPracticeId)) {
      await recordDeniedAccess(userId, requestedPracticeId);
      throw new PracticeAccessError(userId, requestedPracticeId);
    }
    return { practiceId: { in: [requestedPracticeId] } };
  }

  return { practiceId: { in: allowed } };
}

/** SEC03: denials are audit events in their own right. */
async function recordDeniedAccess(userId: string, practiceId: string) {
  try {
    await prisma.event.create({
      data: {
        practiceId: null, // the user has no standing in that practice
        actorUserId: userId,
        targetType: "Practice",
        targetId: practiceId,
        action: "PRACTICE_ACCESS_DENIED",
        result: "FAILURE",
        reason: "No live membership for the requested practice",
      },
    });
  } catch {
    // Audit failure must never mask the denial itself.
  }
}

/**
 * ORG05: resolve an active cross-practice grant, if one exists. Returns null
 * when there is none, when it has expired or been revoked, or when it was
 * granted against a DIFFERENT version of the subject — new versions never
 * inherit a share.
 */
export async function findActiveShare(params: {
  receivingPracticeId: string;
  subjectType: "DOCUMENT_VERSION" | "CONTACT_FIELD";
  subjectId: string;
  subjectVersion?: number;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  return prisma.crossPracticeShare.findFirst({
    where: {
      receivingPracticeId: params.receivingPracticeId,
      subjectType: params.subjectType,
      subjectId: params.subjectId,
      subjectVersion: params.subjectVersion ?? null,
      revokedAt: null,
      expiresAt: { gt: now },
    },
  });
}
