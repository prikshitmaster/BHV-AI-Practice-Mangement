/**
 * IAM05 — user lifecycle, and IAM01 for background work (PRD §8).
 *
 * "Suspend leavers immediately, revoke sessions and transfer work."
 * "Revocation invalidates active sessions and queued exports before further
 *  disclosure. Background workers recheck membership when executing."
 *
 * Note the ordering inside suspendUser(): sessions and queued jobs are killed
 * in the SAME transaction that marks the user suspended. If suspension
 * committed first and revocation followed, a job could start in the gap.
 */

import { prisma } from "@/lib/prisma";
import { resolveMembership } from "@/lib/permissions";

export async function suspendUser(params: {
  userId: string;
  reason: string;
  actorUserId: string;
  actorName: string;
}) {
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: params.userId },
      data: {
        status: "SUSPENDED",
        suspendedAt: now,
        suspendedReason: params.reason,
      },
      select: { id: true, fullName: true },
    });

    // Kill live sessions.
    const sessions = await tx.session.updateMany({
      where: { userId: params.userId, revokedAt: null },
      data: { revokedAt: now, revokedReason: `User suspended: ${params.reason}` },
    });

    // Cancel queued work before it can disclose anything further. RUNNING is
    // included because the worker re-checks membership mid-flight and will
    // abort — see assertStillAuthorised below.
    const jobs = await tx.queuedJob.updateMany({
      where: {
        requestedByUserId: params.userId,
        state: { in: ["QUEUED", "RUNNING"] },
      },
      data: {
        state: "CANCELLED",
        cancelledReason: `Requester suspended: ${params.reason}`,
        finishedAt: now,
      },
    });

    // DOC04: signed document links are the same disclosure risk as a session.
    // Redemption re-checks live state and would refuse them anyway, but they
    // are killed here so the revocation is visible in the data and lands in
    // the SAME transaction as the suspension — no gap.
    const links = await tx.documentAccessToken.updateMany({
      where: { issuedToUserId: params.userId, revokedAt: null },
      data: { revokedAt: now, revokeReason: `User suspended: ${params.reason}` },
    });

    // Revoke practice memberships so no future authorisation succeeds.
    await tx.practiceMembership.updateMany({
      where: { userId: params.userId, revokedAt: null },
      data: { revokedAt: now },
    });

    return {
      user,
      revokedSessions: sessions.count,
      cancelledJobs: jobs.count,
      revokedDocumentLinks: links.count,
    };
  });

  await prisma.event.create({
    data: {
      actorUserId: params.actorUserId,
      targetType: "User",
      targetId: params.userId,
      action: "USER_SUSPENDED",
      result: "SUCCESS",
      reason: params.reason,
      afterMeta: {
        revokedSessions: result.revokedSessions,
        cancelledQueuedJobs: result.cancelledJobs,
        revokedDocumentLinks: result.revokedDocumentLinks,
        // Authorship is preserved: the account can no longer act, but every
        // approval and document it produced still names it.
        authorshipPreserved: true,
      },
    },
  });

  return result;
}

export async function inviteUser(params: {
  email: string;
  fullName: string;
  practiceId: string;
  role: Parameters<typeof prisma.practiceMembership.create>[0]["data"]["role"];
  sponsorUserId: string;
  invitedByUserId: string;
}) {
  const now = new Date();

  const user = await prisma.user.create({
    data: {
      email: params.email,
      fullName: params.fullName,
      status: "INVITED",
      invitedAt: now,
      invitedByUserId: params.invitedByUserId,
      sponsorUserId: params.sponsorUserId,
    },
  });

  const membership = await prisma.practiceMembership.create({
    data: {
      practiceId: params.practiceId,
      userId: user.id,
      role: params.role,
      effectiveFrom: now,
    },
  });

  await prisma.event.create({
    data: {
      practiceId: params.practiceId,
      actorUserId: params.invitedByUserId,
      targetType: "User",
      targetId: user.id,
      action: "USER_INVITED",
      result: "SUCCESS",
      afterMeta: { role: params.role, sponsorUserId: params.sponsorUserId },
    },
  });

  return { user, membership };
}

export class JobAuthorisationRevokedError extends Error {
  readonly code = "JOB_AUTHORISATION_REVOKED";
  constructor(reason: string) {
    super(reason);
    this.name = "JobAuthorisationRevokedError";
  }
}

/**
 * IAM01: called by a background worker at EXECUTION time, not enqueue time.
 *
 * The enqueue-time check is not enough on its own — a queued export can sit
 * for minutes after the requester is walked out of the building. This is the
 * second gate.
 */
export async function assertStillAuthorised(jobId: string): Promise<void> {
  const job = await prisma.queuedJob.findUniqueOrThrow({
    where: { id: jobId },
    select: {
      id: true,
      practiceId: true,
      requestedByUserId: true,
      state: true,
    },
  });

  if (job.state === "CANCELLED") {
    throw new JobAuthorisationRevokedError("Job was cancelled before execution");
  }

  const membership = await resolveMembership(job.requestedByUserId, job.practiceId);

  if (!membership) {
    await prisma.queuedJob.update({
      where: { id: job.id },
      data: {
        state: "CANCELLED",
        cancelledReason: "Requester no longer has a live membership at execution time",
        finishedAt: new Date(),
      },
    });

    await prisma.event.create({
      data: {
        practiceId: job.practiceId,
        actorUserId: job.requestedByUserId,
        targetType: "QueuedJob",
        targetId: job.id,
        action: "JOB_ABORTED_AUTHORISATION_REVOKED",
        result: "FAILURE",
        reason: "Membership re-check failed at execution time",
      },
    });

    throw new JobAuthorisationRevokedError(
      "Requester no longer has a live membership at execution time",
    );
  }
}
