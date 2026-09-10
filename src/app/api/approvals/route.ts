import { NextResponse } from "next/server";
import { badRequest, errorResponse, withApiContext } from "@/lib/api";
import { assertCsrf } from "@/lib/csrf";
import { requireUserId } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { assertPracticeAccess } from "@/lib/practice-scope";
import { assertCan } from "@/lib/permissions";
import { recordApproval, currentApprovalsFor } from "@/lib/approvals";
import type { ApprovalSubjectType, ApprovalDecision } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

const SUBJECT_TYPES: ApprovalSubjectType[] = [
  "ENGAGEMENT",
  "INVOICE",
  "OBLIGATION",
  "FILING",
  "DOCUMENT_VERSION",
];
const DECISIONS: ApprovalDecision[] = ["APPROVED", "REJECTED", "WITHDRAWN"];

/**
 * IAM03: approving is not one capability. Signing off a filing, approving an
 * invoice and accepting an engagement are different authorities held by
 * different roles, so the check is per subject type rather than a single
 * "may approve things" permission that would quietly merge them.
 */
const APPROVE_ACTION = {
  FILING: "filing.approve",
  OBLIGATION: "filing.approve",
  INVOICE: "invoice.approve",
  ENGAGEMENT: "engagement.accept",
  DOCUMENT_VERSION: "document.release",
} as const;

const READ_ACTION = {
  FILING: "job.read",
  OBLIGATION: "job.read",
  INVOICE: "invoice.read",
  ENGAGEMENT: "engagement.read",
  DOCUMENT_VERSION: "document.read",
} as const;

/**
 * API02 — record an approval against an exact version (PRD §34).
 *
 * The endpoint that was missing: approvals existed as a table and as a rule,
 * but nothing in the application wrote one. `expectedVersion` is required and
 * never defaulted — an approval that does not name what it approved is the
 * thing this requirement exists to prevent.
 */
export async function POST(request: Request) {
  return withApiContext(request, async () => {
    try {
      const userId = await requireUserId();
      await assertCsrf(request);

      const body = (await request.json()) as Record<string, unknown>;

      // API01: input validated server side, before anything is resolved.
      const practiceId = typeof body.practiceId === "string" ? body.practiceId : null;
      if (!practiceId) return badRequest("practiceId is required");

      const subjectType = SUBJECT_TYPES.find((t) => t === body.subjectType);
      if (!subjectType) {
        return badRequest(`subjectType must be one of ${SUBJECT_TYPES.join(", ")}`);
      }

      const subjectId = typeof body.subjectId === "string" ? body.subjectId : null;
      if (!subjectId) return badRequest("subjectId is required");

      if (typeof body.expectedVersion !== "number") {
        return badRequest("expectedVersion is required");
      }

      const decision = DECISIONS.find((x) => x === body.decision) ?? "APPROVED";

      // Deny by default, in this order: the practice must be reachable by this
      // user at all, and only then is the action checked.
      await assertPracticeAccess(userId, practiceId);
      await assertCan(userId, practiceId, APPROVE_ACTION[subjectType]);

      const actor = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { fullName: true },
      });

      const recorded = await recordApproval({
        practiceId,
        subjectType,
        subjectId,
        expectedVersion: body.expectedVersion,
        decision,
        approverUserId: userId,
        approverDisplayName: actor.fullName,
        authority: typeof body.authority === "string" ? body.authority : "REVIEWER",
        comments: typeof body.comments === "string" ? body.comments : undefined,
      });

      return NextResponse.json({
        ok: true,
        approvalId: recorded.approvalId,
        subjectVersion: recorded.subjectVersion,
        decision: recorded.decision,
        duplicate: recorded.duplicate,
      });
    } catch (e) {
      return errorResponse(e);
    }
  });
}

/** The approvals that still name the subject's present version (WRK02/API02). */
export async function GET(request: Request) {
  return withApiContext(request, async () => {
    try {
      const userId = await requireUserId();
      const url = new URL(request.url);

      const practiceId = url.searchParams.get("practiceId");
      const subjectId = url.searchParams.get("subjectId");
      const subjectType = SUBJECT_TYPES.find((t) => t === url.searchParams.get("subjectType"));

      if (!practiceId || !subjectId || !subjectType) {
        return badRequest("practiceId, subjectType and subjectId are required");
      }

      await assertPracticeAccess(userId, practiceId);
      await assertCan(userId, practiceId, READ_ACTION[subjectType]);

      // Throws SubjectNotFoundError — a 404 — when the subject is absent or
      // belongs to another practice. The caller is never told which.
      const approvals = await currentApprovalsFor({ practiceId, subjectType, subjectId });

      return NextResponse.json({
        approvals: approvals.map((a) => ({
          id: a.id,
          subjectVersion: a.subjectVersion,
          decision: a.decision,
          decidedAt: a.decidedAt,
          approvedBy: a.actorDisplayName,
          authority: a.authority,
        })),
      });
    } catch (e) {
      return errorResponse(e);
    }
  });
}
