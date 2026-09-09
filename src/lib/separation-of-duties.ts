/**
 * IAM04 — separation of duties (PRD §8).
 *
 * "An author cannot approve the same sensitive output by default. Require
 *  independent review for filings, invoices above configured limits, signoff
 *  and credential exports. For a sole reviewer situation, use a disclosed
 *  self review exception with reason and quality review follow up; legal
 *  prohibitions cannot be overridden."
 *
 * Two things this file is careful about:
 *   - Authorship is determined from the AUDIT TRAIL, not from a field someone
 *     can edit. Whoever created or last amended the subject is the author.
 *   - The self-review exception is a disclosure, not a bypass. It always
 *     leaves a quality-review obligation behind, and it cannot be applied to
 *     categories that are legally prohibited.
 */

import type { ApprovalSubjectType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

export class SeparationOfDutiesError extends Error {
  readonly code = "SEPARATION_OF_DUTIES";
  readonly status = 409;

  constructor(readonly reason: string) {
    super(reason);
    this.name = "SeparationOfDutiesError";
  }
}

/**
 * Categories where self-review may never be disclosed away. A filing carrying
 * a statutory signature is the author's own attestation; no internal
 * exception can make it independent.
 */
const NO_SELF_REVIEW_EVER: ApprovalSubjectType[] = ["FILING"];

/** Actions that count as authoring a subject. */
const AUTHORING_ACTIONS = [
  "CREATED",
  "UPDATED",
  "SUBMITTED_FOR_APPROVAL",
  "FILING_PREPARED",
  "INVOICE_DRAFTED",
];

/** Who authored this exact version, according to the audit trail? */
export async function findAuthors(
  subjectType: ApprovalSubjectType,
  subjectId: string,
): Promise<string[]> {
  const events = await prisma.event.findMany({
    where: {
      targetType: subjectType,
      targetId: subjectId,
      action: { in: AUTHORING_ACTIONS },
      result: "SUCCESS",
      actorUserId: { not: null },
    },
    select: { actorUserId: true },
  });

  return [...new Set(events.map((e) => e.actorUserId).filter((x): x is string => !!x))];
}

type ApprovalCheck = {
  practiceId: string;
  subjectType: ApprovalSubjectType;
  subjectId: string;
  subjectVersion: number;
  approverUserId: string;
  /** Value of the subject, where a threshold applies (invoices). */
  amount?: Prisma.Decimal | string | null;
};

/**
 * Throws unless this approver may approve this subject. Call BEFORE writing
 * an Approval row.
 */
export async function assertMayApprove(check: ApprovalCheck): Promise<void> {
  const authors = await findAuthors(check.subjectType, check.subjectId);
  const isAuthor = authors.includes(check.approverUserId);

  if (!isAuthor) return; // independent reviewer — nothing to disclose

  // From here on the approver IS the author.
  if (NO_SELF_REVIEW_EVER.includes(check.subjectType)) {
    throw new SeparationOfDutiesError(
      `The author of a ${check.subjectType} cannot approve it, and no self-review exception is permitted for this category.`,
    );
  }

  // IAM04: below the configured limit, an invoice does not require
  // independent review at all, so self-approval is not an exception.
  if (check.subjectType === "INVOICE") {
    const practice = await prisma.practice.findUniqueOrThrow({
      where: { id: check.practiceId },
      select: { invoiceApprovalThreshold: true },
    });

    const amount = new Prisma.Decimal(check.amount ?? 0);
    if (amount.lessThanOrEqualTo(practice.invoiceApprovalThreshold)) return;
  }

  // Otherwise a disclosed exception must already exist for this exact version.
  const exception = await prisma.selfReviewException.findFirst({
    where: {
      practiceId: check.practiceId,
      subjectType: check.subjectType,
      subjectId: check.subjectId,
      subjectVersion: check.subjectVersion,
    },
  });

  if (!exception) {
    throw new SeparationOfDutiesError(
      "The author of this output cannot approve it. Record a disclosed self-review exception with a reason, or route it to an independent reviewer.",
    );
  }
}

/**
 * Record a disclosed self-review exception. Always leaves a quality-review
 * obligation behind — that is what makes it a disclosure rather than a hole.
 */
export async function discloseSelfReview(params: {
  practiceId: string;
  subjectType: ApprovalSubjectType;
  subjectId: string;
  subjectVersion: number;
  reason: string;
  userId: string;
  userName: string;
}) {
  if (NO_SELF_REVIEW_EVER.includes(params.subjectType)) {
    throw new SeparationOfDutiesError(
      `Self-review cannot be disclosed for ${params.subjectType} — this is a legal prohibition, not a policy setting.`,
    );
  }

  if (!params.reason?.trim()) {
    throw new SeparationOfDutiesError("A self-review exception requires a stated reason.");
  }

  const exception = await prisma.selfReviewException.create({
    data: {
      practiceId: params.practiceId,
      subjectType: params.subjectType,
      subjectId: params.subjectId,
      subjectVersion: params.subjectVersion,
      reason: params.reason,
      disclosedByUserId: params.userId,
      disclosedByName: params.userName,
      qualityReviewRequired: true,
    },
  });

  await prisma.event.create({
    data: {
      practiceId: params.practiceId,
      actorUserId: params.userId,
      targetType: params.subjectType,
      targetId: params.subjectId,
      action: "SELF_REVIEW_EXCEPTION_DISCLOSED",
      result: "SUCCESS",
      reason: params.reason,
      afterMeta: { subjectVersion: params.subjectVersion, qualityReviewRequired: true },
    },
  });

  return exception;
}
