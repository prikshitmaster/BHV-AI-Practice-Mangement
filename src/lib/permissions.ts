/**
 * Authorisation engine — IAM01-05 (PRD §8).
 *
 * IAM01 is the governing rule: "Hiding a menu is not an access control."
 * Every decision here is made on the server against the STORED record scope.
 * A practiceId arriving in a request body is treated as a request, never as
 * evidence of authority.
 *
 * The default is DENY. A capability exists only if a role grants it, and
 * restricted areas (HR, credentials, fee rates, protected workpapers) stay
 * denied even for senior roles until an explicit PermissionGrant exists.
 */

import type { AssignmentScope, PracticeRole, RestrictedPermission } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { PracticeAccessError } from "@/lib/practice-scope";

export type Action =
  | "client.read"
  | "client.write"
  | "engagement.read"
  | "engagement.write"
  | "engagement.accept"
  | "job.read"
  | "job.write"
  | "document.read"
  | "document.upload"
  | "document.release"
  // DOC06: destroying a record is a senior gate of its own, deliberately not
  // folded into document.release — a reviewer who may send a report to a
  // client is not thereby entitled to approve its destruction.
  | "document.delete_approve"
  // COM01/COM03. Posting an internal note and sending to a client are
  // deliberately separate: an article records what they found, but does not
  // decide what leaves the firm under its letterhead.
  | "message.post_internal"
  | "message.send_client"
  // COM01: making an internal thread client-visible is a disclosure decision,
  // so it is a capability of its own rather than a side effect of being able
  // to write in the thread.
  | "thread.change_visibility"
  // COM03: confirming a NEW external address is a control, not an edit — and
  // it must not be held by everyone who can send.
  | "recipient.verify"
  | "invoice.read"
  | "invoice.draft"
  | "invoice.issue"
  | "invoice.approve"
  | "filing.prepare"
  | "filing.approve"
  | "export.run"
  | "export.credentials"
  | "user.invite"
  | "user.grant_access"
  | "hr.read"
  | "feerate.read"
  | "workpaper.protected.read"
  | "system.administer";

/**
 * IAM02 role presets. These are STARTING TEMPLATES — record-level
 * restrictions and separation of duties still apply on top (PRD §9).
 *
 * Read the two administrative rows carefully: IT_ADMIN can administer the
 * system but cannot approve a filing or issue an invoice, and no
 * professional role can administer the system. That separation is the point.
 */
const ROLE_CAPABILITIES: Record<PracticeRole, Action[]> = {
  GROUP_OWNER: [
    "client.read", "client.write",
    "engagement.read", "engagement.write", "engagement.accept",
    "job.read", "job.write",
    "document.read", "document.upload", "document.release", "document.delete_approve",
    "message.post_internal", "message.send_client", "thread.change_visibility",
    "recipient.verify",
    "invoice.read", "invoice.draft", "invoice.issue", "invoice.approve",
    "filing.prepare", "filing.approve",
    "export.run",
    "user.invite", "user.grant_access",
  ],
  PRACTICE_PARTNER: [
    "client.read", "client.write",
    "engagement.read", "engagement.write", "engagement.accept",
    "job.read", "job.write",
    "document.read", "document.upload", "document.release", "document.delete_approve",
    "message.post_internal", "message.send_client", "thread.change_visibility",
    "recipient.verify",
    "invoice.read", "invoice.draft", "invoice.issue", "invoice.approve",
    "filing.prepare", "filing.approve",
    "export.run",
    "user.invite", "user.grant_access",
  ],
  MANAGER: [
    "client.read", "client.write",
    "engagement.read", "engagement.write",
    "job.read", "job.write",
    "document.read", "document.upload", "document.release",
    "message.post_internal", "message.send_client", "thread.change_visibility",
    "recipient.verify",
    "invoice.read", "invoice.draft",
    "filing.prepare",
    "export.run",
  ],
  // DOC04 names this role directly: "A reviewer releases an exact version to
  // named portal contacts." Releasing is the reviewer's act, so the capability
  // sits here — but destroying a record does not (document.delete_approve).
  REVIEWER: [
    "client.read",
    "engagement.read",
    "job.read", "job.write",
    "document.read", "document.upload", "document.release",
    "message.post_internal", "message.send_client", "thread.change_visibility",
    "recipient.verify",
    "invoice.read",
    "filing.prepare", "filing.approve",
  ],
  // An article prepares work. They cannot approve a filing, issue an invoice,
  // or grant anyone access — the PRD names both explicitly. COM03 extends the
  // same logic to correspondence: they may record an internal note, but what
  // leaves the firm under its letterhead is not theirs to decide, and neither
  // is verifying a new external address.
  STAFF_ARTICLE: [
    "client.read",
    "engagement.read",
    "job.read", "job.write",
    "document.read", "document.upload",
    "message.post_internal",
    "filing.prepare",
  ],
  FINANCE: [
    "client.read",
    // Fee reminders and invoices are service communications finance genuinely
    // sends; disclosure decisions about professional threads are not theirs.
    "message.post_internal", "message.send_client",
    "invoice.read", "invoice.draft", "invoice.issue",
    "export.run",
  ],
  HR: [],
  IT_ADMIN: ["system.administer", "user.invite"],
  QUALITY_REVIEWER: [
    "client.read",
    "engagement.read",
    "job.read",
    "document.read",
    "message.post_internal",
    "invoice.read",
    "filing.approve",
  ],
  CLIENT_CONTACT: [],
};

/** IAM03: actions that require an explicit extra grant on top of the role. */
const RESTRICTED_ACTIONS: Partial<Record<Action, RestrictedPermission>> = {
  "hr.read": "HR_RECORDS",
  "feerate.read": "FEE_RATES",
  "workpaper.protected.read": "PROTECTED_WORKPAPERS",
  "export.credentials": "CREDENTIAL_EXPORT",
};

/** How wide a scope each level implies, for comparison. */
const SCOPE_RANK: Record<AssignmentScope, number> = {
  OWN_WORK: 0,
  ASSIGNED_ENGAGEMENTS: 1,
  TEAM: 2,
  BRANCH: 3,
  PRACTICE: 4,
  COMBINED: 5,
};

export class PermissionDeniedError extends Error {
  readonly code = "PERMISSION_DENIED";
  readonly status = 403;

  constructor(
    readonly userId: string,
    readonly action: Action,
    readonly why: string,
  ) {
    super(`Permission denied: ${action}`);
    this.name = "PermissionDeniedError";
  }
}

export type ResolvedMembership = {
  membershipId: string;
  practiceId: string;
  role: PracticeRole;
  assignmentScope: AssignmentScope;
  teamId: string | null;
  branchId: string | null;
  grants: RestrictedPermission[];
};

/**
 * Resolve a user's live membership in one practice, with its restricted
 * grants. Returns null if there is no live membership — callers must treat
 * that as denial, never as "unscoped".
 */
export async function resolveMembership(
  userId: string,
  practiceId: string,
  now: Date = new Date(),
): Promise<ResolvedMembership | null> {
  const membership = await prisma.practiceMembership.findFirst({
    where: {
      userId,
      practiceId,
      revokedAt: null,
      effectiveFrom: { lte: now },
      AND: [
        { OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
        { OR: [{ grantExpiresAt: null }, { grantExpiresAt: { gt: now } }] },
      ],
      practice: { archivedAt: null },
      user: { status: { in: ["ACTIVE", "INVITED"] }, suspendedAt: null },
    },
    select: {
      id: true,
      practiceId: true,
      role: true,
      assignmentScope: true,
      teamId: true,
      branchId: true,
      permissionGrants: {
        where: {
          revokedAt: null,
          effectiveFrom: { lte: now },
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        select: { permission: true },
      },
    },
  });

  if (!membership) return null;

  return {
    membershipId: membership.id,
    practiceId: membership.practiceId,
    role: membership.role,
    assignmentScope: membership.assignmentScope,
    teamId: membership.teamId,
    branchId: membership.branchId,
    grants: membership.permissionGrants.map((g) => g.permission),
  };
}

/** Does this membership permit this action at all? (IAM01/IAM02/IAM03) */
export function can(membership: ResolvedMembership, action: Action): boolean {
  const restricted = RESTRICTED_ACTIONS[action];
  if (restricted) {
    // IAM03: restricted areas need the explicit grant, whatever the role.
    return membership.grants.includes(restricted);
  }
  return ROLE_CAPABILITIES[membership.role].includes(action);
}

/**
 * Assert a user may perform an action in a practice. Throws
 * PracticeAccessError (404) when they have no standing in the practice at
 * all, and PermissionDeniedError (403) when they are a member but the role
 * does not carry the action — the distinction is safe because membership is
 * already established in the second case.
 */
export async function assertCan(
  userId: string,
  practiceId: string,
  action: Action,
  now: Date = new Date(),
): Promise<ResolvedMembership> {
  const membership = await resolveMembership(userId, practiceId, now);

  if (!membership) {
    await audit(userId, null, action, "No live membership");
    throw new PracticeAccessError(userId, practiceId);
  }

  if (!can(membership, action)) {
    const why = RESTRICTED_ACTIONS[action]
      ? `Requires explicit ${RESTRICTED_ACTIONS[action]} grant`
      : `Role ${membership.role} does not carry ${action}`;
    await audit(userId, practiceId, action, why);
    throw new PermissionDeniedError(userId, action, why);
  }

  return membership;
}

/**
 * IAM03 assignment scope: does this membership reach a specific record?
 * A MANAGER in both firms with TEAM scope sees only their own team's work —
 * the role is not a licence to the whole practice.
 */
export function reachesRecord(
  membership: ResolvedMembership,
  record: {
    ownerUserId?: string | null;
    assignedUserIds?: string[];
    teamId?: string | null;
    branchId?: string | null;
  },
  userId: string,
): boolean {
  const rank = SCOPE_RANK[membership.assignmentScope];

  if (rank >= SCOPE_RANK.PRACTICE) return true;
  if (rank >= SCOPE_RANK.BRANCH && record.branchId && record.branchId === membership.branchId) {
    return true;
  }
  if (rank >= SCOPE_RANK.TEAM && record.teamId && record.teamId === membership.teamId) {
    return true;
  }
  if (rank >= SCOPE_RANK.ASSIGNED_ENGAGEMENTS && record.assignedUserIds?.includes(userId)) {
    return true;
  }
  return record.ownerUserId === userId;
}

async function audit(
  userId: string,
  practiceId: string | null,
  action: Action,
  reason: string,
) {
  try {
    await prisma.event.create({
      data: {
        practiceId,
        actorUserId: userId,
        targetType: "Permission",
        targetId: action,
        action: "PERMISSION_DENIED",
        result: "FAILURE",
        reason,
      },
    });
  } catch {
    // Never let audit failure mask the denial.
  }
}
