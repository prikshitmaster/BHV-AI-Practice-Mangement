/**
 * Engagements — ENG01-04, ENG06 (PRD §12). ENG05 (full independence linkage
 * across services) is R1; the independence BLOCK that gates activation is
 * here, because activation control is R0.
 *
 * The rule that shapes this file is ENG04:
 *
 *   "A scope, fee, period or practice change after acceptance creates a
 *    revision or supplemental engagement. Preserve the original."
 *
 * So an accepted engagement is effectively immutable. Adding litigation work
 * to a retainer does not edit the retainer — it supersedes it with a revision
 * that carries the combined scope, while the original row keeps the terms the
 * client actually accepted. And critically, the work already generated under
 * the original (the monthly GST jobs) is NOT regenerated: those jobs belong to
 * the engagement lineage, not to a particular revision.
 */

import { createHash } from "node:crypto";
import type { AcceptanceKind, EngagementChangeType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { recordEvent } from "@/lib/audit";
import { assertCan, resolveMembership } from "@/lib/permissions";
import { assertAcceptanceComplete } from "@/lib/client-registry";

export class EngagementError extends Error {
  readonly status = 409;
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "EngagementError";
  }
}

// ---------------------------------------------------------------- ENG01

export async function createServiceTemplate(params: {
  tenantId: string;
  code: string;
  version: number;
  name: string;
  category: string;
  applicabilityInputs?: unknown;
  documentChecklist?: unknown;
  steps?: unknown;
  roles?: unknown;
  reviewGates?: unknown;
  deliverables?: unknown;
  feeModel?: unknown;
  approvedByName?: string;
}) {
  return prisma.serviceTemplate.create({
    data: {
      tenantId: params.tenantId,
      code: params.code,
      version: params.version,
      name: params.name,
      category: params.category,
      applicabilityInputs: (params.applicabilityInputs ?? {}) as never,
      documentChecklist: (params.documentChecklist ?? []) as never,
      steps: (params.steps ?? []) as never,
      roles: (params.roles ?? {}) as never,
      reviewGates: (params.reviewGates ?? []) as never,
      deliverables: (params.deliverables ?? []) as never,
      feeModel: (params.feeModel ?? {}) as never,
      approvedByName: params.approvedByName,
      effectiveFrom: new Date(),
    },
  });
}

// ---------------------------------------------------------------- ENG02

export async function createEngagement(params: {
  userId: string;
  practiceId: string;
  clientRelationshipId: string;
  templateCode: string;
  templateVersion: number;
  kind: "ANNUAL_RETAINER" | "AD_HOC";
  periodStart: Date;
  periodEnd: Date;
  scope: string;
  exclusions?: string;
  feeBasis: string;
  billingEntityRegistrationId?: string;
  ownerUserId: string;
  reviewerUserId: string;
  plannedStartDate?: Date;
  plannedEndDate?: Date;
}) {
  await assertCan(params.userId, params.practiceId, "engagement.write");

  // CLI04 carried forward: no engagement before acceptance is complete.
  await assertAcceptanceComplete(params.clientRelationshipId);

  const template = await prisma.serviceTemplate.findFirstOrThrow({
    where: { code: params.templateCode, version: params.templateVersion, archivedAt: null },
  });

  // ENG02: an owner who reviews their own work defeats the review gate.
  if (params.ownerUserId === params.reviewerUserId) {
    throw new EngagementError(
      "The engagement owner cannot also be its reviewer.",
      "OWNER_IS_REVIEWER",
    );
  }

  const engagement = await prisma.engagement.create({
    data: {
      practiceId: params.practiceId,
      clientRelationshipId: params.clientRelationshipId,
      serviceCode: template.code,
      templateVersion: String(template.version),
      kind: params.kind,
      periodStart: params.periodStart,
      periodEnd: params.periodEnd,
      scope: params.scope,
      exclusions: params.exclusions,
      feeBasis: params.feeBasis,
      billingEntityRegistrationId: params.billingEntityRegistrationId,
      plannedStartDate: params.plannedStartDate,
      plannedEndDate: params.plannedEndDate,
      ownerUserId: params.ownerUserId,
      reviewerUserId: params.reviewerUserId,
      state: "DRAFT",
    },
  });

  await recordEvent({
    action: "ENGAGEMENT_CREATED",
    targetType: "Engagement",
    targetId: engagement.id,
    targetVersion: engagement.version,
    result: "SUCCESS",
    actorUserId: params.userId,
    practiceId: params.practiceId,
    afterMeta: { serviceCode: engagement.serviceCode, kind: engagement.kind },
  });

  return engagement;
}

// ---------------------------------------------------------------- ENG03

/**
 * Generate an engagement letter from the pinned template, populated only from
 * facts already recorded against the client. Anything unverified is surfaced
 * rather than silently printed as though confirmed.
 */
export async function generateEngagementLetter(params: {
  userId: string;
  practiceId: string;
  engagementId: string;
}) {
  await assertCan(params.userId, params.practiceId, "engagement.write");

  const engagement = await prisma.engagement.findFirstOrThrow({
    where: { id: params.engagementId, practiceId: params.practiceId },
    include: {
      clientRelationship: {
        include: {
          party: { include: { identifiers: { where: { archivedAt: null } } } },
        },
      },
      practice: {
        include: {
          addresses: { where: { archivedAt: null }, take: 1 },
          signatories: { where: { archivedAt: null }, take: 1 },
        },
      },
    },
  });

  const identifiers = engagement.clientRelationship.party.identifiers;
  const unverified = identifiers
    .filter((i) => i.verificationStatus !== "VERIFIED")
    .map((i) => `${i.kind} (${i.verificationStatus})`);

  const body = {
    practiceName:
      engagement.practice.registeredDisplayName ?? engagement.practice.name,
    practiceAddress: engagement.practice.addresses[0]?.line1 ?? null,
    signatory: engagement.practice.signatories[0]?.personName ?? null,
    clientLegalName: engagement.clientRelationship.party.legalName,
    serviceCode: engagement.serviceCode,
    templateVersion: engagement.templateVersion,
    period: {
      from: engagement.periodStart.toISOString().slice(0, 10),
      to: engagement.periodEnd.toISOString().slice(0, 10),
    },
    scope: engagement.scope,
    exclusions: engagement.exclusions,
    feeBasis: engagement.feeBasis,
    // Stated on the face of the draft rather than hidden: a letter naming an
    // unverified GSTIN should not go out looking authoritative.
    unverifiedFacts: unverified,
  };

  const bodyHash = createHash("sha256").update(JSON.stringify(body)).digest("hex");

  const letter = await prisma.engagementLetter.create({
    data: {
      practiceId: params.practiceId,
      engagementId: engagement.id,
      templateCode: engagement.serviceCode,
      templateVersion: Number(engagement.templateVersion),
      bodySnapshot: body as never,
      bodyHash,
      reviewState: "DRAFT",
    },
  });

  await recordEvent({
    action: "ENGAGEMENT_LETTER_GENERATED",
    targetType: "EngagementLetter",
    targetId: letter.id,
    result: "SUCCESS",
    actorUserId: params.userId,
    practiceId: params.practiceId,
    afterMeta: { bodyHash, unverifiedFactCount: unverified.length },
  });

  return letter;
}

/** Route a draft to review. IAM04: the drafter cannot approve their own letter. */
export async function approveEngagementLetter(params: {
  letterId: string;
  approverUserId: string;
  approverName: string;
}) {
  const letter = await prisma.engagementLetter.findUniqueOrThrow({
    where: { id: params.letterId },
    include: { engagement: { select: { ownerUserId: true } } },
  });

  await assertCan(params.approverUserId, letter.practiceId, "engagement.accept");

  if (letter.engagement.ownerUserId === params.approverUserId) {
    throw new EngagementError(
      "The engagement owner cannot approve their own engagement letter.",
      "SELF_APPROVAL",
    );
  }

  return prisma.engagementLetter.update({
    where: { id: letter.id },
    data: {
      reviewState: "APPROVED",
      reviewedByUserId: params.approverUserId,
      reviewedByName: params.approverName,
      reviewedAt: new Date(),
    },
  });
}

/**
 * ENG03: typed consent, electronic acceptance and a legally effective
 * signature are recorded as DISTINCT kinds, and the signing method must suit
 * the document type. A statutory audit engagement is not accepted by someone
 * typing their name into a box.
 */
const SIGNATURE_REQUIRED_SERVICES = new Set(["AUDIT", "TAX_AUDIT", "CERTIFICATION"]);

export async function recordLetterAcceptance(params: {
  letterId: string;
  acceptanceKind: AcceptanceKind;
  signatoryName: string;
  signatoryCapacity: string;
  evidence: Record<string, unknown>;
}) {
  const letter = await prisma.engagementLetter.findUniqueOrThrow({
    where: { id: params.letterId },
    include: { engagement: { select: { id: true, serviceCode: true } } },
  });

  if (letter.reviewState !== "APPROVED" && letter.reviewState !== "SENT") {
    throw new EngagementError(
      "An engagement letter must be reviewed and approved before acceptance is recorded.",
      "LETTER_NOT_APPROVED",
    );
  }

  if (
    SIGNATURE_REQUIRED_SERVICES.has(letter.engagement.serviceCode) &&
    params.acceptanceKind !== "LEGALLY_EFFECTIVE_SIGNATURE"
  ) {
    throw new EngagementError(
      `A ${letter.engagement.serviceCode} engagement requires a legally effective signature; ` +
        `${params.acceptanceKind} is not an approved signing method for this document type.`,
      "SIGNING_METHOD_NOT_APPROVED",
    );
  }

  const updated = await prisma.engagementLetter.update({
    where: { id: letter.id },
    data: {
      acceptanceKind: params.acceptanceKind,
      acceptedAt: new Date(),
      signatoryName: params.signatoryName,
      signatoryCapacity: params.signatoryCapacity,
      acceptanceEvidence: params.evidence as never,
      sentAt: letter.sentAt ?? new Date(),
      reviewState: "SENT",
    },
  });

  // DAT02: freeze the accepted particulars onto the engagement.
  await prisma.engagement.update({
    where: { id: letter.engagementId },
    data: {
      state: "ACCEPTED",
      acceptedAt: new Date(),
      acceptedSnapshot: {
        letterId: letter.id,
        bodyHash: letter.bodyHash,
        acceptanceKind: params.acceptanceKind,
        signatoryName: params.signatoryName,
        signatoryCapacity: params.signatoryCapacity,
        body: letter.bodySnapshot,
      } as never,
      version: { increment: 1 },
    },
  });

  await recordEvent({
    action: "ENGAGEMENT_ACCEPTED",
    targetType: "Engagement",
    targetId: letter.engagementId,
    result: "SUCCESS",
    practiceId: letter.practiceId,
    afterMeta: {
      acceptanceKind: params.acceptanceKind,
      signatoryCapacity: params.signatoryCapacity,
    },
  });

  return updated;
}

// ---------------------------------------------------------------- ENG04

const REVIEWS_BY_CHANGE_TYPE: Record<
  EngagementChangeType,
  { fee: boolean; authority: boolean; clientArrangements: boolean }
> = {
  SCOPE: { fee: true, authority: true, clientArrangements: false },
  FEE: { fee: true, authority: false, clientArrangements: false },
  PERIOD: { fee: true, authority: false, clientArrangements: false },
  // Reassigning the responsible legal practice is a change of contracting
  // party, not a dropdown.
  PRACTICE: { fee: true, authority: true, clientArrangements: true },
};

/**
 * Request a post-acceptance change. Creates the change record with the reviews
 * it triggers; the revision engagement is only created once it is approved.
 */
export async function requestEngagementChange(params: {
  userId: string;
  userName: string;
  practiceId: string;
  engagementId: string;
  changeType: EngagementChangeType;
  reason: string;
  proposed: {
    scope?: string;
    feeBasis?: string;
    periodStart?: Date;
    periodEnd?: Date;
    targetPracticeId?: string;
  };
  clientArrangementsEvidence?: string;
}) {
  await assertCan(params.userId, params.practiceId, "engagement.write");

  const engagement = await prisma.engagement.findFirstOrThrow({
    where: { id: params.engagementId, practiceId: params.practiceId },
  });

  if (engagement.state === "DRAFT" || engagement.state === "PENDING_ACCEPTANCE") {
    throw new EngagementError(
      "This engagement has not been accepted yet — edit it directly rather than raising a change.",
      "NOT_YET_ACCEPTED",
    );
  }
  if (engagement.supersededAt) {
    throw new EngagementError(
      "This engagement has already been superseded by a revision.",
      "ALREADY_SUPERSEDED",
    );
  }

  const reviews = REVIEWS_BY_CHANGE_TYPE[params.changeType];

  if (reviews.clientArrangements && !params.clientArrangementsEvidence) {
    throw new EngagementError(
      "Reassigning the responsible legal practice requires documented client arrangements and new authority.",
      "CLIENT_ARRANGEMENTS_REQUIRED",
    );
  }

  const change = await prisma.engagementChange.create({
    data: {
      practiceId: params.practiceId,
      engagementId: engagement.id,
      changeType: params.changeType,
      reason: params.reason,
      beforeSnapshot: {
        scope: engagement.scope,
        exclusions: engagement.exclusions,
        feeBasis: engagement.feeBasis,
        periodStart: engagement.periodStart.toISOString().slice(0, 10),
        periodEnd: engagement.periodEnd.toISOString().slice(0, 10),
        practiceId: engagement.practiceId,
      } as never,
      afterSnapshot: {
        scope: params.proposed.scope ?? engagement.scope,
        exclusions: engagement.exclusions,
        feeBasis: params.proposed.feeBasis ?? engagement.feeBasis,
        periodStart: (params.proposed.periodStart ?? engagement.periodStart)
          .toISOString()
          .slice(0, 10),
        periodEnd: (params.proposed.periodEnd ?? engagement.periodEnd)
          .toISOString()
          .slice(0, 10),
        practiceId: params.proposed.targetPracticeId ?? engagement.practiceId,
      } as never,
      requiresFeeReview: reviews.fee,
      requiresAuthorityReview: reviews.authority,
      requiresClientArrangements: reviews.clientArrangements,
      clientArrangementsEvidence: params.clientArrangementsEvidence,
      requestedByUserId: params.userId,
      requestedByName: params.userName,
      status: "PENDING_REVIEW",
    },
  });

  await recordEvent({
    action: "ENGAGEMENT_CHANGE_REQUESTED",
    targetType: "Engagement",
    targetId: engagement.id,
    targetVersion: engagement.version,
    result: "SUCCESS",
    actorUserId: params.userId,
    practiceId: params.practiceId,
    reason: params.reason,
    afterMeta: {
      changeType: params.changeType,
      requiresFeeReview: reviews.fee,
      requiresAuthorityReview: reviews.authority,
    },
  });

  return change;
}

/**
 * Approve a change and create the REVISION.
 *
 * The original engagement is preserved untouched apart from `supersededAt`,
 * and — deliberately — its jobs stay attached to it. Reissuing work for
 * periods already handled is the failure mode ENG04's acceptance evidence
 * calls out ("existing GST jobs are not recreated").
 */
export async function approveEngagementChange(params: {
  changeId: string;
  approverUserId: string;
  approverName: string;
}) {
  const change = await prisma.engagementChange.findUniqueOrThrow({
    where: { id: params.changeId },
    include: { engagement: true },
  });

  if (change.status !== "PENDING_REVIEW") {
    throw new EngagementError(`This change is already ${change.status}.`, "ALREADY_DECIDED");
  }

  await assertCan(params.approverUserId, change.practiceId, "engagement.accept");

  if (change.requestedByUserId === params.approverUserId) {
    throw new EngagementError(
      "The requester of a change cannot approve it.",
      "SELF_APPROVAL",
    );
  }

  const original = change.engagement;
  const after = change.afterSnapshot as Record<string, string>;

  const revision = await prisma.$transaction(async (tx) => {
    const created = await tx.engagement.create({
      data: {
        practiceId: original.practiceId,
        clientRelationshipId: original.clientRelationshipId,
        serviceCode: original.serviceCode,
        templateVersion: original.templateVersion,
        kind: original.kind,
        periodStart: new Date(after.periodStart),
        periodEnd: new Date(after.periodEnd),
        scope: after.scope,
        exclusions: original.exclusions,
        feeBasis: after.feeBasis,
        billingEntityRegistrationId: original.billingEntityRegistrationId,
        plannedStartDate: original.plannedStartDate,
        plannedEndDate: original.plannedEndDate,
        ownerUserId: original.ownerUserId,
        reviewerUserId: original.reviewerUserId,
        parentEngagementId: original.id,
        revisionNumber: original.revisionNumber + 1,
        // A revision is not accepted merely because the change was approved
        // internally — the client must accept the revised terms.
        state: "PENDING_ACCEPTANCE",
      },
    });

    // The original keeps its accepted particulars; only its supersession is
    // recorded. Its acceptedSnapshot is never rewritten (DAT02).
    await tx.engagement.update({
      where: { id: original.id },
      data: { supersededAt: new Date(), version: { increment: 1 } },
    });

    await tx.engagementChange.update({
      where: { id: change.id },
      data: {
        status: "APPROVED",
        approvedByUserId: params.approverUserId,
        approvedByName: params.approverName,
        approvedAt: new Date(),
        resultingEngagementId: created.id,
      },
    });

    // The reviews the change demanded become explicit blocks on the revision,
    // so it cannot quietly go active without them being cleared.
    const blocks = [];
    if (change.requiresFeeReview) {
      blocks.push({
        practiceId: created.practiceId,
        engagementId: created.id,
        kind: "FEE_APPROVAL" as const,
        reason: `Fee basis must be re-reviewed after a ${change.changeType} change`,
        raisedByName: "system",
      });
    }
    if (change.requiresAuthorityReview) {
      blocks.push({
        practiceId: created.practiceId,
        engagementId: created.id,
        kind: "AUTHORITY" as const,
        reason: `Authority to act must be re-confirmed after a ${change.changeType} change`,
        raisedByName: "system",
      });
    }
    if (blocks.length) await tx.engagementBlock.createMany({ data: blocks });

    return created;
  });

  await recordEvent({
    action: "ENGAGEMENT_CHANGE_APPROVED",
    targetType: "Engagement",
    targetId: original.id,
    targetVersion: original.version,
    result: "SUCCESS",
    actorUserId: params.approverUserId,
    practiceId: change.practiceId,
    afterMeta: {
      revisionEngagementId: revision.id,
      revisionNumber: revision.revisionNumber,
      originalPreserved: true,
      jobsRecreated: false,
    },
  });

  return revision;
}

// ------------------------------------------------- activation and blocks

export async function raiseBlock(params: {
  practiceId: string;
  engagementId: string;
  kind: "INDEPENDENCE" | "ACCEPTANCE" | "FEE_APPROVAL" | "AUTHORITY";
  reason: string;
  raisedByName: string;
}) {
  return prisma.engagementBlock.create({
    data: {
      practiceId: params.practiceId,
      engagementId: params.engagementId,
      kind: params.kind,
      reason: params.reason,
      raisedByName: params.raisedByName,
    },
  });
}

/** Roles competent to clear an independence question. */
const INDEPENDENCE_RESOLVER_ROLES = new Set(["QUALITY_REVIEWER", "PRACTICE_PARTNER", "GROUP_OWNER"]);

/**
 * Resolve a block. An INDEPENDENCE block needs an ELIGIBLE reviewer: a
 * suitable role, and not the engagement's own owner — self-clearing an
 * independence threat is the threat.
 */
export async function resolveBlock(params: {
  blockId: string;
  resolverUserId: string;
  resolverName: string;
  resolution: string;
}) {
  const block = await prisma.engagementBlock.findUniqueOrThrow({
    where: { id: params.blockId },
    include: { engagement: { select: { ownerUserId: true, reviewerUserId: true } } },
  });

  if (block.resolvedAt) {
    throw new EngagementError("This block is already resolved.", "ALREADY_RESOLVED");
  }
  if (!params.resolution?.trim()) {
    throw new EngagementError("A resolution must state the professional conclusion.", "RESOLUTION_REQUIRED");
  }

  const membership = await resolveMembership(params.resolverUserId, block.practiceId);
  if (!membership) {
    throw new EngagementError("No live membership in this practice.", "NOT_A_MEMBER");
  }

  if (block.kind === "INDEPENDENCE") {
    if (block.engagement.ownerUserId === params.resolverUserId) {
      throw new EngagementError(
        "The engagement owner cannot resolve its own independence block. An eligible reviewer must.",
        "NOT_ELIGIBLE_REVIEWER",
      );
    }
    if (!INDEPENDENCE_RESOLVER_ROLES.has(membership.role)) {
      throw new EngagementError(
        `Role ${membership.role} is not eligible to resolve an independence block.`,
        "NOT_ELIGIBLE_REVIEWER",
      );
    }
  }

  const resolved = await prisma.engagementBlock.update({
    where: { id: block.id },
    data: {
      resolvedByUserId: params.resolverUserId,
      resolvedByName: params.resolverName,
      resolvedAt: new Date(),
      resolution: params.resolution,
    },
  });

  await recordEvent({
    action: "ENGAGEMENT_BLOCK_RESOLVED",
    targetType: "EngagementBlock",
    targetId: block.id,
    result: "SUCCESS",
    actorUserId: params.resolverUserId,
    practiceId: block.practiceId,
    reason: params.resolution,
    afterMeta: { kind: block.kind },
  });

  return resolved;
}

export async function activateEngagement(params: {
  userId: string;
  practiceId: string;
  engagementId: string;
}) {
  await assertCan(params.userId, params.practiceId, "engagement.write");

  const engagement = await prisma.engagement.findFirstOrThrow({
    where: { id: params.engagementId, practiceId: params.practiceId },
  });

  if (engagement.state !== "ACCEPTED") {
    throw new EngagementError(
      `An engagement must be ACCEPTED before activation (currently ${engagement.state}).`,
      "NOT_ACCEPTED",
    );
  }

  const openBlocks = await prisma.engagementBlock.findMany({
    where: { engagementId: engagement.id, resolvedAt: null },
    select: { kind: true, reason: true },
  });

  if (openBlocks.length > 0) {
    throw new EngagementError(
      `Activation is blocked: ${openBlocks.map((b) => `${b.kind} — ${b.reason}`).join("; ")}`,
      "BLOCKED",
    );
  }

  const activated = await prisma.engagement.update({
    where: { id: engagement.id },
    data: { state: "ACTIVE", version: { increment: 1 } },
  });

  await recordEvent({
    action: "ENGAGEMENT_ACTIVATED",
    targetType: "Engagement",
    targetId: engagement.id,
    targetVersion: activated.version,
    result: "SUCCESS",
    actorUserId: params.userId,
    practiceId: params.practiceId,
  });

  return activated;
}

// ---------------------------------------------------------------- ENG06

/**
 * ENG06: "Close only when required work, reviews and release evidence are
 * complete, or record an authorised termination reason."
 *
 * COMPLETION is gated on the work actually being finished. The other three
 * kinds are terminations and require a named authoriser and a reason — they
 * are not a way to make incomplete work disappear.
 */
export async function closeEngagement(params: {
  userId: string;
  userName: string;
  practiceId: string;
  engagementId: string;
  closureKind: "COMPLETION" | "WITHDRAWAL" | "CANCELLATION" | "NOT_APPLICABLE";
  reason: string;
}) {
  await assertCan(params.userId, params.practiceId, "engagement.write");

  const engagement = await prisma.engagement.findFirstOrThrow({
    where: { id: params.engagementId, practiceId: params.practiceId },
    include: { jobs: { select: { id: true, state: true } } },
  });

  if (!params.reason?.trim()) {
    throw new EngagementError("A closure reason is required.", "REASON_REQUIRED");
  }

  if (params.closureKind === "COMPLETION") {
    const unfinished = engagement.jobs.filter(
      (j) => j.state !== "COMPLETED" && j.state !== "CANCELLED",
    );
    if (unfinished.length > 0) {
      throw new EngagementError(
        `Cannot close as COMPLETION: ${unfinished.length} job(s) are still open. ` +
          `Record a withdrawal or cancellation with an authorised reason instead.`,
        "WORK_INCOMPLETE",
      );
    }
  }

  const closed = await prisma.engagement.update({
    where: { id: engagement.id },
    data: {
      state: params.closureKind === "COMPLETION" ? "CLOSED" : "TERMINATED",
      closureKind: params.closureKind,
      closureReason: params.reason,
      closureAuthorisedByName: params.userName,
      closedAt: new Date(),
      version: { increment: 1 },
    },
  });

  await recordEvent({
    action: "ENGAGEMENT_CLOSED",
    targetType: "Engagement",
    targetId: engagement.id,
    targetVersion: closed.version,
    result: "SUCCESS",
    actorUserId: params.userId,
    practiceId: params.practiceId,
    reason: params.reason,
    afterMeta: { closureKind: params.closureKind },
  });

  return closed;
}

/**
 * ENG06: "Keep outstanding fees and retained documents traceable after service
 * closure." Closing an engagement must never hide an unpaid invoice.
 */
export async function closureTraceability(engagementId: string, practiceId: string) {
  const [invoices, documents] = await Promise.all([
    prisma.invoice.findMany({
      where: { engagementId, practiceId, status: "ISSUED" },
      select: { id: true, sequenceNumber: true, total: true, issuedAt: true },
    }),
    prisma.document.findMany({
      where: { engagementId, practiceId, archivedAt: null },
      select: { id: true, title: true, retentionUntil: true, legalHold: true },
    }),
  ]);

  const allocations = await prisma.receiptAllocation.findMany({
    where: { practiceId, invoice: { engagementId } },
    select: { invoiceId: true, amount: true },
  });

  const paidByInvoice = new Map<string, number>();
  for (const a of allocations) {
    paidByInvoice.set(a.invoiceId, (paidByInvoice.get(a.invoiceId) ?? 0) + Number(a.amount));
  }

  const outstanding = invoices
    .map((i) => ({
      invoiceId: i.id,
      sequenceNumber: i.sequenceNumber,
      total: Number(i.total),
      allocated: paidByInvoice.get(i.id) ?? 0,
      outstanding: Number(i.total) - (paidByInvoice.get(i.id) ?? 0),
    }))
    .filter((i) => i.outstanding > 0);

  return {
    outstandingInvoices: outstanding,
    outstandingTotal: outstanding.reduce((s, i) => s + i.outstanding, 0),
    retainedDocuments: documents,
  };
}
