/**
 * Statutory calendar — DUE01-04, DUE06 (PRD §14). DUE05 (regulatory update
 * inbox) is R1.
 *
 * The section opens with the rule that shapes everything here: "Separate law,
 * internal planning, client submission and payment dates." A single "due date"
 * field is how an internal target quietly becomes the date everyone believes
 * is statutory — so the five dates are distinct columns, and only one of them
 * can be moved by an extension.
 *
 * Two further rules are load-bearing:
 *   DUE02  Unknown applicability is a REVIEW state, never "Not applicable".
 *          Marking an unknown obligation not-applicable silently deletes a
 *          deadline that may in fact apply.
 *   DUE04  A bounced reminder is never evidence that the client received it.
 */

import type {
  GoverningLaw,
  ObligationStatus,
  TaxpayerCategory,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { recordEvent } from "@/lib/audit";

export class CalendarError extends Error {
  readonly status = 409;
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "CalendarError";
  }
}

// ---------------------------------------------------------------- DUE01

export async function createObligationRule(params: {
  code: string;
  version: number;
  source: string;
  jurisdiction?: string;
  governingLaw: GoverningLaw;
  service?: string;
  taxpayerCategory?: TaxpayerCategory;
  relevantPeriod?: string;
  formVersion?: string;
  dueDateExpression?: string;
  authoritativeSource?: string;
  sourceDate?: Date;
  applicability?: Record<string, unknown>;
  effectiveFrom: Date;
}) {
  return prisma.obligationRule.create({
    data: {
      code: params.code,
      version: params.version,
      source: params.source,
      jurisdiction: params.jurisdiction ?? "IN",
      governingLaw: params.governingLaw,
      service: params.service,
      taxpayerCategory: params.taxpayerCategory,
      relevantPeriod: params.relevantPeriod,
      formVersion: params.formVersion,
      dueDateExpression: params.dueDateExpression,
      authoritativeSource: params.authoritativeSource,
      sourceDate: params.sourceDate,
      applicability: (params.applicability ?? {}) as never,
      status: "DRAFT",
      effectiveFrom: params.effectiveFrom,
    },
  });
}

/**
 * DUE01 lifecycle. A rule reaches ACTIVE only after a named CA has reviewed
 * it — an unreviewed rule driving live statutory dates is the hazard.
 */
export async function activateRule(params: {
  ruleId: string;
  approvingCaName: string;
}) {
  const rule = await prisma.obligationRule.findUniqueOrThrow({ where: { id: params.ruleId } });

  if (rule.status !== "REVIEWED") {
    throw new CalendarError(
      `A rule must be REVIEWED before activation (currently ${rule.status}).`,
      "NOT_REVIEWED",
    );
  }
  if (!params.approvingCaName?.trim()) {
    throw new CalendarError("Activation must name the approving CA.", "APPROVER_REQUIRED");
  }

  // Supersede the previous active version of the same code.
  await prisma.obligationRule.updateMany({
    where: { code: rule.code, status: "ACTIVE", id: { not: rule.id } },
    data: { status: "SUPERSEDED" },
  });

  return prisma.obligationRule.update({
    where: { id: rule.id },
    data: { status: "ACTIVE", approvingCaName: params.approvingCaName },
  });
}

export async function reviewRule(ruleId: string) {
  const rule = await prisma.obligationRule.findUniqueOrThrow({ where: { id: ruleId } });
  if (rule.status !== "DRAFT") {
    throw new CalendarError(`Only a DRAFT rule can be reviewed (currently ${rule.status}).`, "NOT_DRAFT");
  }
  return prisma.obligationRule.update({ where: { id: ruleId }, data: { status: "REVIEWED" } });
}

// ---------------------------------------------------------------- DUE02

/**
 * Create a deadline instance.
 *
 * If the applicable category or form cannot be determined, the obligation is
 * created in REVIEW_REQUIRED — visible and chaseable — rather than being
 * quietly marked NOT_APPLICABLE.
 */
export async function createObligationInstance(params: {
  practiceId: string;
  clientRelationshipId: string;
  engagementId?: string;
  ruleId: string;
  periodKey: string;
  statutoryDate?: Date;
  internalTargetDate?: Date;
  reviewTargetDate?: Date;
  clientDocumentCutoff?: Date;
  paymentDeadline?: Date;
  taxpayerCategory?: TaxpayerCategory | null;
  formVersion?: string | null;
  governingLaw?: GoverningLaw | null;
  assessmentYear?: string | null;
  taxYear?: string | null;
}) {
  const rule = await prisma.obligationRule.findUniqueOrThrow({ where: { id: params.ruleId } });

  const category = params.taxpayerCategory ?? rule.taxpayerCategory ?? null;
  const formVersion = params.formVersion ?? rule.formVersion ?? null;
  const statutoryDate = params.statutoryDate ?? null;

  // DUE02: unknown applicability is a review state, not "not applicable".
  const unknown = category === null || formVersion === null || statutoryDate === null;
  const status: ObligationStatus = unknown ? "REVIEW_REQUIRED" : "OPEN";

  const obligation = await prisma.obligation.create({
    data: {
      practiceId: params.practiceId,
      clientRelationshipId: params.clientRelationshipId,
      engagementId: params.engagementId,
      ruleId: rule.id,
      ruleVersion: rule.version,
      periodKey: params.periodKey,
      // A review-required instance still needs dates on the row; the rule's
      // effective date is used as a placeholder and the status says plainly
      // that it is not yet confirmed.
      originalStatutoryDate: statutoryDate ?? rule.effectiveFrom,
      currentStatutoryDate: statutoryDate ?? rule.effectiveFrom,
      internalTargetDate: params.internalTargetDate,
      reviewTargetDate: params.reviewTargetDate,
      clientDocumentCutoff: params.clientDocumentCutoff,
      paymentDeadline: params.paymentDeadline,
      taxpayerCategory: category,
      formVersion,
      // Stored independently — the filing date never selects the Act.
      governingLaw: params.governingLaw ?? rule.governingLaw,
      assessmentYear: params.assessmentYear ?? null,
      taxYear: params.taxYear ?? null,
      status,
    },
  });

  if (unknown) {
    await recordEvent({
      action: "OBLIGATION_REVIEW_REQUIRED",
      targetType: "Obligation",
      targetId: obligation.id,
      result: "SUCCESS",
      practiceId: params.practiceId,
      reason:
        "Applicability could not be determined " +
        `(category=${category ?? "unknown"}, form=${formVersion ?? "unknown"}, ` +
        `statutoryDate=${statutoryDate ? "known" : "unknown"})`,
    });
  }

  return obligation;
}

/**
 * DUE02: an unknown obligation may only leave REVIEW_REQUIRED when the missing
 * particulars are supplied — it cannot be dismissed as NOT_APPLICABLE without
 * a stated determination.
 */
export async function resolveReviewRequired(params: {
  obligationId: string;
  taxpayerCategory?: TaxpayerCategory;
  formVersion?: string;
  statutoryDate?: Date;
  notApplicableReason?: string;
  actorName: string;
  actorUserId?: string;
}) {
  const obligation = await prisma.obligation.findUniqueOrThrow({
    where: { id: params.obligationId },
  });

  if (obligation.status !== "REVIEW_REQUIRED") {
    throw new CalendarError("This obligation is not in Review required.", "NOT_IN_REVIEW");
  }

  if (params.notApplicableReason) {
    if (!params.notApplicableReason.trim()) {
      throw new CalendarError(
        "Marking an obligation not applicable requires a stated determination.",
        "REASON_REQUIRED",
      );
    }
    const updated = await prisma.obligation.update({
      where: { id: obligation.id },
      data: { status: "NOT_APPLICABLE", version: { increment: 1 } },
    });
    await prisma.obligationChange.create({
      data: {
        obligationId: obligation.id,
        changedByUserId: params.actorUserId,
        changedByName: params.actorName,
        reason: params.notApplicableReason,
        beforeMeta: { status: obligation.status } as never,
        afterMeta: { status: "NOT_APPLICABLE" } as never,
      },
    });
    return updated;
  }

  if (!params.taxpayerCategory || !params.formVersion || !params.statutoryDate) {
    throw new CalendarError(
      "Resolving a review requires the taxpayer category, form version and statutory date — " +
        "or an explicit not-applicable determination.",
      "INCOMPLETE_RESOLUTION",
    );
  }

  return prisma.obligation.update({
    where: { id: obligation.id },
    data: {
      taxpayerCategory: params.taxpayerCategory,
      formVersion: params.formVersion,
      originalStatutoryDate: params.statutoryDate,
      currentStatutoryDate: params.statutoryDate,
      status: "OPEN",
      version: { increment: 1 },
    },
  });
}

// ---------------------------------------------------------------- DUE03

/** Instances an extension WOULD affect. Nothing is written. */
export async function previewExtension(extensionId: string) {
  const ext = await prisma.statutoryExtension.findUniqueOrThrow({ where: { id: extensionId } });

  /**
   * The matching criteria, minus status. ObligationRule is shared across
   * tenants (its unique key is code+version, with no tenant), so the tenant
   * bound MUST come from the practice — otherwise a notification issued for
   * one firm would match, and count, another firm's obligations.
   */
  const matches = {
    practice: { tenantId: ext.tenantId },
    currentStatutoryDate: ext.originalDate,
    ...(ext.periodKey ? { periodKey: ext.periodKey } : {}),
    ...(ext.taxpayerCategory ? { taxpayerCategory: ext.taxpayerCategory } : {}),
    ...(ext.governingLaw ? { governingLaw: ext.governingLaw } : {}),
    ...(ext.formVersion ? { formVersion: ext.formVersion } : {}),
    rule: {
      jurisdiction: ext.jurisdiction,
      ...(ext.ruleCode ? { code: ext.ruleCode } : {}),
    },
  };

  const candidates = await prisma.obligation.findMany({
    where: {
      // Only OPEN work. Completed filings are never reopened automatically.
      status: { in: ["OPEN", "DUE_SOON", "OVERDUE", "WAITING"] },
      ...matches,
    },
    select: {
      id: true, practiceId: true, periodKey: true, taxpayerCategory: true,
      currentStatutoryDate: true, status: true, formVersion: true,
    },
  });

  // Shown alongside, so a reviewer can see what is deliberately untouched.
  // Same criteria as above, so the two counts are genuinely comparable.
  const excludedCompleted = await prisma.obligation.count({
    where: {
      status: { in: ["FILED", "SUBMITTED_AWAITING_ACK"] },
      ...matches,
    },
  });

  await prisma.statutoryExtension.update({
    where: { id: ext.id },
    data: { previewedAt: new Date(), status: ext.status === "DRAFT" ? "PREVIEWED" : ext.status },
  });

  return {
    extension: ext,
    affected: candidates,
    affectedCount: candidates.length,
    excludedBecauseCompleted: excludedCompleted,
  };
}

/**
 * Apply an extension. Only matching OPEN instances move, each revision keeps
 * the old value and the notification that authorised it, and historical
 * on-time metrics are left alone.
 */
export async function applyExtension(params: {
  extensionId: string;
  approvedByName: string;
  actorUserId?: string;
}) {
  const ext = await prisma.statutoryExtension.findUniqueOrThrow({
    where: { id: params.extensionId },
  });

  if (ext.status === "APPLIED") {
    throw new CalendarError("This extension has already been applied.", "ALREADY_APPLIED");
  }
  if (!ext.previewedAt) {
    throw new CalendarError(
      "An extension must be previewed before it is applied.",
      "PREVIEW_REQUIRED",
    );
  }
  if (!params.approvedByName?.trim()) {
    throw new CalendarError("Applying an extension must name the approver.", "APPROVER_REQUIRED");
  }

  const preview = await previewExtension(ext.id);

  for (const target of preview.affected) {
    const before = await prisma.obligation.findUniqueOrThrow({ where: { id: target.id } });

    await prisma.obligation.update({
      where: { id: target.id },
      data: {
        // ONLY the current statutory date moves. originalStatutoryDate is
        // never touched, so the audit trail shows both.
        currentStatutoryDate: ext.extendedDate,
        version: { increment: 1 },
      },
    });

    await prisma.obligationChange.create({
      data: {
        obligationId: target.id,
        changedByUserId: params.actorUserId,
        changedByName: params.approvedByName,
        reason: `Statutory extension ${ext.notificationReference}`,
        sourceReference: ext.authoritativeSource ?? ext.notificationReference,
        extensionId: ext.id,
        beforeMeta: {
          currentStatutoryDate: before.currentStatutoryDate.toISOString().slice(0, 10),
          originalStatutoryDate: before.originalStatutoryDate.toISOString().slice(0, 10),
        } as never,
        afterMeta: {
          currentStatutoryDate: ext.extendedDate.toISOString().slice(0, 10),
          originalStatutoryDate: before.originalStatutoryDate.toISOString().slice(0, 10),
        } as never,
      },
    });

    await recordEvent({
      action: "OBLIGATION_DATE_EXTENDED",
      targetType: "Obligation",
      targetId: target.id,
      targetVersion: before.version + 1,
      result: "SUCCESS",
      actorUserId: params.actorUserId,
      practiceId: target.practiceId,
      reason: `Extension ${ext.notificationReference}`,
      beforeMeta: { currentStatutoryDate: before.currentStatutoryDate.toISOString().slice(0, 10) },
      afterMeta: {
        currentStatutoryDate: ext.extendedDate.toISOString().slice(0, 10),
        originalStatutoryDatePreserved: before.originalStatutoryDate.toISOString().slice(0, 10),
      },
    });
  }

  return prisma.statutoryExtension.update({
    where: { id: ext.id },
    data: {
      status: "APPLIED",
      appliedAt: new Date(),
      appliedCount: preview.affected.length,
      approvedByName: params.approvedByName,
      approvedAt: new Date(),
    },
  });
}

// ---------------------------------------------------------------- DUE04

/** Escalation ladder: days before the statutory date, and who is chased. */
const ESCALATION_LADDER = [
  { daysBefore: 14, level: 0, role: "STAFF_ARTICLE" as const },
  { daysBefore: 7, level: 1, role: "MANAGER" as const },
  { daysBefore: 2, level: 2, role: "PRACTICE_PARTNER" as const },
];

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * DUE06: "Missed scheduler runs produce catch up alerts without duplicates."
 * Each alert has a stable dedup key, so re-running after an outage backfills
 * without spamming.
 */
export async function generateAlerts(params: { practiceId: string; now?: Date }) {
  const now = params.now ?? new Date();

  const obligations = await prisma.obligation.findMany({
    where: {
      practiceId: params.practiceId,
      status: { in: ["OPEN", "DUE_SOON", "OVERDUE", "WAITING"] },
    },
    select: { id: true, currentStatutoryDate: true, status: true },
  });

  let created = 0;

  for (const o of obligations) {
    const msLeft = o.currentStatutoryDate.getTime() - now.getTime();
    const daysLeft = Math.floor(msLeft / 86_400_000);

    for (const step of ESCALATION_LADDER) {
      if (daysLeft > step.daysBefore) continue;

      const dedupKey = `${o.id}|DUE_SOON|${step.level}|${dayKey(o.currentStatutoryDate)}`;
      const result = await prisma.obligationAlert.createMany({
        data: [{
          practiceId: params.practiceId,
          obligationId: o.id,
          kind: daysLeft < 0 ? "OVERDUE" : "DUE_SOON",
          escalationLevel: step.level,
          responsibleRole: step.role,
          dueAt: o.currentStatutoryDate,
          dedupKey,
        }],
        skipDuplicates: true,
      });
      created += result.count;
    }

    if (daysLeft < 0 && o.status !== "OVERDUE") {
      await prisma.obligation.update({ where: { id: o.id }, data: { status: "OVERDUE" } });
    } else if (daysLeft >= 0 && daysLeft <= 14 && o.status === "OPEN") {
      await prisma.obligation.update({ where: { id: o.id }, data: { status: "DUE_SOON" } });
    }
  }

  return { created };
}

export async function recordAlertDelivery(params: {
  alertId: string;
  state: "SENT" | "DELIVERED" | "BOUNCED" | "FAILED";
  detail?: string;
}) {
  return prisma.obligationAlert.update({
    where: { id: params.alertId },
    data: {
      deliveryState: params.state,
      deliveryDetail: params.detail,
      sentAt: params.state === "SENT" ? new Date() : undefined,
    },
  });
}

/**
 * DUE04 acceptance evidence: "A bounced reminder never becomes evidence of
 * client receipt."
 *
 * Receipt requires BOTH successful delivery and an explicit acknowledgement.
 * A bounce is the opposite of evidence — it is proof the message did not land.
 */
export function isEvidenceOfReceipt(alert: {
  deliveryState: string;
  acknowledgedAt: Date | null;
}): boolean {
  if (alert.deliveryState === "BOUNCED" || alert.deliveryState === "FAILED") return false;
  if (alert.deliveryState !== "DELIVERED") return false;
  return alert.acknowledgedAt !== null;
}

export async function acknowledgeAlert(params: {
  alertId: string;
  userId?: string;
  name: string;
}) {
  const alert = await prisma.obligationAlert.findUniqueOrThrow({ where: { id: params.alertId } });

  if (alert.deliveryState === "BOUNCED" || alert.deliveryState === "FAILED") {
    throw new CalendarError(
      "A reminder that bounced cannot be acknowledged as received.",
      "NOT_DELIVERED",
    );
  }

  return prisma.obligationAlert.update({
    where: { id: alert.id },
    data: {
      acknowledgedAt: new Date(),
      acknowledgedByUserId: params.userId,
      acknowledgedByName: params.name,
    },
  });
}

/**
 * DUE04: "Filing completion requires acknowledgement / reference evidence and
 * reviewer confirmation; marking a task Done is insufficient."
 */
export async function markFiled(params: {
  obligationId: string;
  practiceId: string;
  acknowledgementReference: string;
  filedAt: Date;
  reviewerUserId?: string;
  reviewerName: string;
  portalResponse?: Record<string, unknown>;
  sourceFileSha256?: string;
}) {
  if (!params.acknowledgementReference?.trim()) {
    throw new CalendarError(
      "Filing cannot be completed without an acknowledgement/reference number.",
      "ACKNOWLEDGEMENT_REQUIRED",
    );
  }
  if (!params.reviewerName?.trim()) {
    throw new CalendarError(
      "Filing completion requires reviewer confirmation.",
      "REVIEWER_REQUIRED",
    );
  }

  const obligation = await prisma.obligation.findFirstOrThrow({
    where: { id: params.obligationId, practiceId: params.practiceId },
  });

  const [evidence, updated] = await prisma.$transaction([
    prisma.filingEvidence.create({
      data: {
        practiceId: params.practiceId,
        obligationId: obligation.id,
        acknowledgementReference: params.acknowledgementReference,
        filedAt: params.filedAt,
        portalResponse: (params.portalResponse ?? {}) as never,
        sourceFileSha256: params.sourceFileSha256,
        reviewerUserId: params.reviewerUserId,
        reviewerName: params.reviewerName,
        reviewerConfirmedAt: new Date(),
      },
    }),
    prisma.obligation.update({
      where: { id: obligation.id },
      data: { status: "FILED", filedAt: params.filedAt, version: { increment: 1 } },
    }),
  ]);

  await recordEvent({
    action: "OBLIGATION_FILED",
    targetType: "Obligation",
    targetId: obligation.id,
    targetVersion: updated.version,
    result: "SUCCESS",
    actorUserId: params.reviewerUserId,
    practiceId: params.practiceId,
    afterMeta: {
      acknowledgementReference: params.acknowledgementReference,
      reviewerName: params.reviewerName,
    },
  });

  return { evidence, obligation: updated };
}

// ---------------------------------------------------------------- DUE06

/**
 * India-default holiday handling. Holidays may move an INTERNAL reminder;
 * a statutory date moves only when the rule itself permits it, which is why
 * this returns a shifted internal date and leaves the statutory one alone.
 */
export function shiftInternalReminderForHolidays(
  target: Date,
  holidays: string[],
): { original: string; shifted: string; movedBecauseOfHoliday: boolean } {
  const holidaySet = new Set(holidays);
  const d = new Date(target);
  const original = dayKey(d);

  // Walk backwards to the previous working day so the internal target lands
  // before, never after, the statutory date.
  let moved = false;
  for (let i = 0; i < 14; i++) {
    const key = dayKey(d);
    const isWeekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
    if (!holidaySet.has(key) && !isWeekend) break;
    d.setUTCDate(d.getUTCDate() - 1);
    moved = true;
  }

  return { original, shifted: dayKey(d), movedBecauseOfHoliday: moved };
}

/** Snapshot of both dates, for the audit view DUE03 requires. */
export async function dateHistory(obligationId: string) {
  const obligation = await prisma.obligation.findUniqueOrThrow({
    where: { id: obligationId },
    select: {
      originalStatutoryDate: true,
      currentStatutoryDate: true,
      internalTargetDate: true,
      reviewTargetDate: true,
      clientDocumentCutoff: true,
      paymentDeadline: true,
    },
  });

  const revisions = await prisma.obligationChange.findMany({
    where: { obligationId },
    orderBy: { createdAt: "asc" },
    select: {
      reason: true, sourceReference: true, changedByName: true,
      beforeMeta: true, afterMeta: true, createdAt: true,
    },
  });

  return { ...obligation, revisions };
}
