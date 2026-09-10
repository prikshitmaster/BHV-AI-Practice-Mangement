/**
 * Fee arrangements — FIN01 (PRD §25).
 *
 * The sentence that shapes this file:
 *
 *   "Store agreed tax treatment, currency, effective rate and approval;
 *    never infer rates from a staff timer alone."
 *
 * So a rate is something a human agreed and someone approved, and it lives on
 * the arrangement. A timer can say how many hours were spent; it has no
 * standing to say what an hour costs. `chargeableAmount()` will refuse to
 * price time against an arrangement that carries no agreed rate rather than
 * fall back to a default, because a plausible default is how an unagreed rate
 * reaches an invoice.
 *
 * The second rule is FIN01's "scope changes": a change does not edit the
 * arrangement, it supersedes it with a revision. Same shape as ENG04 in
 * engagements.ts, and for the same reason — work already billed under the old
 * terms must stay readable against the terms it was billed under.
 *
 * FIN03 (place of supply, SAC, reverse charge) is R1. What R0 stores is the
 * treatment the engagement letter agreed, as words, not a computed tax.
 */

import type { FeeBasis, FeeComponentKind } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { recordEvent } from "@/lib/audit";
import { assertCan } from "@/lib/permissions";

export class FeeError extends Error {
  readonly status = 409;
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "FeeError";
  }
}

/** Money is Prisma Decimal on the way out; a number is fine on the way in. */
function money(value: number): string {
  return value.toFixed(2);
}

// ---------------------------------------------------------------- FIN01

export async function createFeeArrangement(params: {
  userId: string;
  practiceId: string;
  engagementId: string;
  basis: FeeBasis;
  currency?: string;
  /** Required for FIXED, RECURRING and MILESTONE. */
  agreedAmount?: number;
  /** Required for TIME_BASED — with the unit it is a rate FOR. */
  agreedRateAmount?: number;
  agreedRateUnit?: string;
  recurrenceLabel?: string;
  taxTreatment: string;
  taxRatePercent?: number;
  effectiveFrom: Date;
  effectiveTo?: Date;
}) {
  await assertCan(params.userId, params.practiceId, "invoice.draft");

  // FIN01 "Tie charges to the engagement and owning practice." Reading the
  // engagement through the practice scope is what ties them: an engagement id
  // belonging to another practice simply is not found here.
  const engagement = await prisma.engagement.findFirst({
    where: { id: params.engagementId, practiceId: params.practiceId },
    select: { id: true, clientRelationshipId: true, state: true },
  });
  if (!engagement) {
    throw new FeeError(
      "No such engagement in this practice.",
      "ENGAGEMENT_NOT_FOUND",
    );
  }

  assertPricingIsAgreed(params);

  const arrangement = await prisma.feeArrangement.create({
    data: {
      practiceId: params.practiceId,
      clientRelationshipId: engagement.clientRelationshipId,
      engagementId: engagement.id,
      basis: params.basis,
      currency: params.currency ?? "INR",
      agreedAmount: params.agreedAmount === undefined ? null : money(params.agreedAmount),
      agreedRateAmount:
        params.agreedRateAmount === undefined ? null : money(params.agreedRateAmount),
      agreedRateUnit: params.agreedRateUnit ?? null,
      recurrenceLabel: params.recurrenceLabel ?? null,
      taxTreatment: params.taxTreatment,
      taxRatePercent: money(params.taxRatePercent ?? 0),
      effectiveFrom: params.effectiveFrom,
      effectiveTo: params.effectiveTo ?? null,
    },
  });

  await recordEvent({
    action: "FEE_ARRANGEMENT_CREATED",
    targetType: "FeeArrangement",
    targetId: arrangement.id,
    result: "SUCCESS",
    practiceId: params.practiceId,
    actorUserId: params.userId,
    afterMeta: { basis: params.basis, engagementId: engagement.id },
  });

  return arrangement;
}

/**
 * The FIN01 guard, stated once so every path shares it.
 *
 * Each basis has to carry the number it is priced by. A TIME_BASED
 * arrangement with no rate is the exact hole the requirement names — it is
 * the arrangement a timer would then be asked to fill.
 */
function assertPricingIsAgreed(params: {
  basis: FeeBasis;
  agreedAmount?: number;
  agreedRateAmount?: number;
  agreedRateUnit?: string;
}) {
  if (params.basis === "TIME_BASED") {
    if (params.agreedRateAmount === undefined || !params.agreedRateUnit) {
      throw new FeeError(
        "A time based fee needs an agreed rate and the unit it is charged by. " +
          "A rate cannot be inferred from recorded time.",
        "RATE_NOT_AGREED",
      );
    }
    if (params.agreedRateAmount <= 0) {
      throw new FeeError("An agreed rate must be greater than zero.", "RATE_NOT_AGREED");
    }
    return;
  }

  if (params.agreedAmount === undefined || params.agreedAmount <= 0) {
    throw new FeeError(
      `A ${params.basis} fee needs an agreed amount.`,
      "AMOUNT_NOT_AGREED",
    );
  }
}

/**
 * FIN01 approval. Freezes the agreed particulars (DAT02) so a later edit to
 * the engagement or the client cannot rewrite what was approved.
 */
export async function approveFeeArrangement(params: {
  userId: string;
  approverName: string;
  practiceId: string;
  arrangementId: string;
  expectedVersion: number;
}) {
  await assertCan(params.userId, params.practiceId, "invoice.approve");

  const arrangement = await prisma.feeArrangement.findFirst({
    where: { id: params.arrangementId, practiceId: params.practiceId },
  });
  if (!arrangement) {
    throw new FeeError("No such fee arrangement in this practice.", "NOT_FOUND");
  }
  if (arrangement.status !== "DRAFT") {
    throw new FeeError(
      `A fee arrangement can only be approved from DRAFT (this one is ${arrangement.status}).`,
      "NOT_DRAFT",
    );
  }

  // API02: no silent last-write-wins on an approval.
  const claimed = await prisma.feeArrangement.updateMany({
    where: { id: arrangement.id, practiceId: params.practiceId, version: params.expectedVersion },
    data: {
      status: "APPROVED",
      approvedByUserId: params.userId,
      approvedByName: params.approverName,
      approvedAt: new Date(),
      approvedSnapshot: {
        basis: arrangement.basis,
        currency: arrangement.currency,
        agreedAmount: arrangement.agreedAmount?.toString() ?? null,
        agreedRateAmount: arrangement.agreedRateAmount?.toString() ?? null,
        agreedRateUnit: arrangement.agreedRateUnit,
        recurrenceLabel: arrangement.recurrenceLabel,
        taxTreatment: arrangement.taxTreatment,
        taxRatePercent: arrangement.taxRatePercent.toString(),
        effectiveFrom: arrangement.effectiveFrom.toISOString(),
        approvedByName: params.approverName,
      } as never,
      version: { increment: 1 },
    },
  });

  if (claimed.count === 0) {
    throw new FeeError(
      `The fee arrangement has changed since it was loaded (expected version ${params.expectedVersion}).`,
      "VERSION_CONFLICT",
    );
  }

  await recordEvent({
    action: "FEE_ARRANGEMENT_APPROVED",
    targetType: "FeeArrangement",
    targetId: arrangement.id,
    targetVersion: params.expectedVersion,
    result: "SUCCESS",
    practiceId: params.practiceId,
    actorUserId: params.userId,
  });

  return prisma.feeArrangement.findFirstOrThrow({
    where: { id: arrangement.id, practiceId: params.practiceId },
  });
}

/**
 * FIN01 scope change. The approved arrangement is superseded, not edited —
 * "Preserve the original", the same rule ENG04 states for engagements.
 */
export async function reviseFeeArrangement(params: {
  userId: string;
  practiceId: string;
  arrangementId: string;
  expectedVersion: number;
  changeReason: string;
  basis?: FeeBasis;
  agreedAmount?: number;
  agreedRateAmount?: number;
  agreedRateUnit?: string;
  taxTreatment?: string;
  taxRatePercent?: number;
  effectiveFrom: Date;
}) {
  await assertCan(params.userId, params.practiceId, "invoice.draft");

  const original = await prisma.feeArrangement.findFirst({
    where: { id: params.arrangementId, practiceId: params.practiceId },
  });
  if (!original) {
    throw new FeeError("No such fee arrangement in this practice.", "NOT_FOUND");
  }
  if (original.supersededAt) {
    throw new FeeError(
      "That fee arrangement has already been superseded; revise the current one.",
      "ALREADY_SUPERSEDED",
    );
  }

  const basis = params.basis ?? original.basis;
  const agreedAmount =
    params.agreedAmount ??
    (original.agreedAmount === null ? undefined : Number(original.agreedAmount));
  const agreedRateAmount =
    params.agreedRateAmount ??
    (original.agreedRateAmount === null ? undefined : Number(original.agreedRateAmount));
  const agreedRateUnit = params.agreedRateUnit ?? original.agreedRateUnit ?? undefined;

  // A revision is a fresh agreement and gets the same guard, not a lighter
  // one — otherwise "revise" becomes the way to create an unpriced fee.
  assertPricingIsAgreed({ basis, agreedAmount, agreedRateAmount, agreedRateUnit });

  const revision = await prisma.$transaction(async (tx) => {
    const claimed = await tx.feeArrangement.updateMany({
      where: {
        id: original.id,
        practiceId: params.practiceId,
        version: params.expectedVersion,
        supersededAt: null,
      },
      data: {
        status: "SUPERSEDED",
        supersededAt: new Date(),
        effectiveTo: params.effectiveFrom,
        version: { increment: 1 },
      },
    });
    if (claimed.count === 0) {
      throw new FeeError(
        `The fee arrangement has changed since it was loaded (expected version ${params.expectedVersion}).`,
        "VERSION_CONFLICT",
      );
    }

    return tx.feeArrangement.create({
      data: {
        practiceId: original.practiceId,
        clientRelationshipId: original.clientRelationshipId,
        engagementId: original.engagementId,
        basis,
        currency: original.currency,
        agreedAmount: agreedAmount === undefined ? null : money(agreedAmount),
        agreedRateAmount: agreedRateAmount === undefined ? null : money(agreedRateAmount),
        agreedRateUnit: agreedRateUnit ?? null,
        recurrenceLabel: original.recurrenceLabel,
        taxTreatment: params.taxTreatment ?? original.taxTreatment,
        taxRatePercent:
          params.taxRatePercent === undefined
            ? original.taxRatePercent
            : money(params.taxRatePercent),
        effectiveFrom: params.effectiveFrom,
        parentArrangementId: original.id,
        revisionNumber: original.revisionNumber + 1,
        changeReason: params.changeReason,
      },
    });
  });

  await recordEvent({
    action: "FEE_ARRANGEMENT_REVISED",
    targetType: "FeeArrangement",
    targetId: revision.id,
    result: "SUCCESS",
    practiceId: params.practiceId,
    actorUserId: params.userId,
    beforeMeta: { supersededId: original.id, revisionNumber: original.revisionNumber },
    afterMeta: { revisionNumber: revision.revisionNumber, reason: params.changeReason },
  });

  return revision;
}

// ---------------------------------------------- FIN01 components

/**
 * Milestones, reimbursable expenses, advances and scope-change charges.
 * Each is billable exactly once — `invoicedAt` is what enforces that, and
 * `takeBillableComponents` is the only thing that sets it.
 */
export async function addFeeComponent(params: {
  userId: string;
  practiceId: string;
  arrangementId: string;
  kind: FeeComponentKind;
  description: string;
  amount: number;
  dueOn?: Date;
}) {
  await assertCan(params.userId, params.practiceId, "invoice.draft");

  const arrangement = await prisma.feeArrangement.findFirst({
    where: { id: params.arrangementId, practiceId: params.practiceId },
    select: { id: true },
  });
  if (!arrangement) {
    throw new FeeError("No such fee arrangement in this practice.", "NOT_FOUND");
  }
  if (params.amount <= 0) {
    throw new FeeError("A fee component must carry a positive amount.", "INVALID_AMOUNT");
  }

  return prisma.feeComponent.create({
    data: {
      practiceId: params.practiceId,
      arrangementId: arrangement.id,
      kind: params.kind,
      description: params.description,
      amount: money(params.amount),
      dueOn: params.dueOn ?? null,
    },
  });
}

/** A milestone is billable once it has been reached, not before. */
export async function markMilestoneReached(params: {
  userId: string;
  practiceId: string;
  componentId: string;
}) {
  await assertCan(params.userId, params.practiceId, "invoice.draft");

  const claimed = await prisma.feeComponent.updateMany({
    where: {
      id: params.componentId,
      practiceId: params.practiceId,
      kind: "MILESTONE",
      reachedAt: null,
    },
    data: { reachedAt: new Date() },
  });
  if (claimed.count === 0) {
    throw new FeeError(
      "No unreached milestone with that id in this practice.",
      "MILESTONE_NOT_FOUND",
    );
  }
  return prisma.feeComponent.findFirstOrThrow({
    where: { id: params.componentId, practiceId: params.practiceId },
  });
}

/**
 * What may go on an invoice right now: reached milestones, expenses and
 * scope changes that have not been billed. An ADVANCE is excluded on purpose
 * — an advance is money received against future work (FIN04 handles it as an
 * allocation), not a charge to raise.
 */
export async function listBillableComponents(params: {
  practiceId: string;
  arrangementId: string;
}) {
  return prisma.feeComponent.findMany({
    where: {
      practiceId: params.practiceId,
      arrangementId: params.arrangementId,
      invoicedAt: null,
      kind: { in: ["MILESTONE", "REIMBURSABLE_EXPENSE", "SCOPE_CHANGE"] },
      OR: [{ kind: { not: "MILESTONE" } }, { reachedAt: { not: null } }],
    },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * FIN01 time based charging.
 *
 * Deliberately takes the arrangement, not a timer: the hours come from
 * whoever calls it, and the PRICE comes from the agreed rate or not at all.
 * There is no default rate here and no fallback branch — the absence of one
 * is the requirement.
 */
export async function chargeableAmount(params: {
  practiceId: string;
  arrangementId: string;
  units: number;
}): Promise<{ amount: number; rate: number; unit: string }> {
  const arrangement = await prisma.feeArrangement.findFirst({
    where: { id: params.arrangementId, practiceId: params.practiceId },
    select: {
      basis: true,
      status: true,
      agreedRateAmount: true,
      agreedRateUnit: true,
    },
  });
  if (!arrangement) {
    throw new FeeError("No such fee arrangement in this practice.", "NOT_FOUND");
  }
  if (arrangement.basis !== "TIME_BASED") {
    throw new FeeError(
      `Recorded time cannot be priced against a ${arrangement.basis} arrangement.`,
      "NOT_TIME_BASED",
    );
  }
  if (arrangement.status !== "APPROVED") {
    throw new FeeError(
      "Time can only be priced against an approved fee arrangement.",
      "RATE_NOT_APPROVED",
    );
  }
  if (arrangement.agreedRateAmount === null || !arrangement.agreedRateUnit) {
    throw new FeeError(
      "This arrangement carries no agreed rate, and a rate cannot be inferred from recorded time.",
      "RATE_NOT_AGREED",
    );
  }

  const rate = Number(arrangement.agreedRateAmount);
  return {
    amount: Number((rate * params.units).toFixed(2)),
    rate,
    unit: arrangement.agreedRateUnit,
  };
}

/** The arrangement currently in force for an engagement, if any. */
export async function currentArrangementFor(params: {
  practiceId: string;
  engagementId: string;
}) {
  return prisma.feeArrangement.findFirst({
    where: {
      practiceId: params.practiceId,
      engagementId: params.engagementId,
      supersededAt: null,
    },
    orderBy: { revisionNumber: "desc" },
  });
}
