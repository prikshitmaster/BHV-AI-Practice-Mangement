/**
 * Erasure review — PRV06 acceptance evidence (PRD §36).
 *
 * "An erasure request for an engagement under legal hold is reviewed and
 *  partially actioned where appropriate, with reasons."
 *
 * The verified rights-request workflow (identity checks, response evidence,
 * PRV03) is R1. What R0 needs is the decision itself, built so it cannot go
 * wrong in either direction:
 *
 *  - Not over-erasing. Every item is listed with what the system found — a
 *    live legal hold, a retention floor still running, audit evidence — and an
 *    item carrying such a finding cannot be ERASED whatever the reviewer
 *    chooses. The finding is recomputed at review AND at execution, because a
 *    hold can be placed in between.
 *  - Not under-actioning. A hold on the engagement does not freeze everything
 *    connected to it: a contact's personal phone number is not evidence of the
 *    engagement, and a request that is refused wholesale "because there is a
 *    hold" is exactly what the evidence says must not happen.
 *
 * Every item is decided, every decision has a reason, the requester cannot
 * review their own request, and documents go through the DOC06 pipeline
 * (request → independent approval → logged execution) rather than around it.
 * Contact details held by the other practice too are never erased from here:
 * this practice cannot decide for the other one, and says so without naming it.
 */

import type { ErasureDecision } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { recordEvent } from "@/lib/audit";
import { assertCan } from "@/lib/permissions";
import { versionConflict } from "@/lib/concurrency";
import { PrivacyError } from "@/lib/privacy-register";
import { activeHoldsForDocument } from "@/lib/retention";
import {
  approveDeletion,
  checkDeletionEligibility,
  executeDeletion,
  requestDeletion,
} from "@/lib/documents";

const AUDIT_TARGET = "audit-trail";

async function actorName(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } });
  return u?.fullName ?? "(unknown)";
}

type ListedItem = {
  kind: "DOCUMENT" | "CONTACT_PHONE" | "CONTACT_EMAIL" | "AUDIT_TRAIL";
  targetId: string;
  label: string;
  mustRetainReason: string | null;
};

/** Contact details are party-level; another practice's live use blocks us. */
async function contactUsedElsewhere(contactId: string, practiceId: string, now: Date) {
  const other = await prisma.contactAuthority.count({
    where: {
      contactId,
      practiceId: { not: practiceId },
      revokedAt: null,
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
    },
  });
  return other > 0;
}

/** What the system finds for each item right now. */
async function findings(
  practiceId: string,
  engagementId: string,
  contactId: string | null,
  now: Date,
): Promise<ListedItem[]> {
  const items: ListedItem[] = [];

  const docs = await prisma.document.findMany({
    where: { practiceId, engagementId, archivedAt: null },
    select: { id: true, title: true },
    orderBy: { createdAt: "asc" },
  });
  for (const doc of docs) {
    const holds = await activeHoldsForDocument(practiceId, doc.id);
    let reason: string | null = null;
    if (holds.length) {
      reason = `Under legal hold: ${holds.map((h) => h.reason).join("; ")}`;
    } else {
      const eligibility = await checkDeletionEligibility({ practiceId, documentId: doc.id, now });
      if (!eligibility.eligible) reason = eligibility.reason;
    }
    items.push({ kind: "DOCUMENT", targetId: doc.id, label: doc.title, mustRetainReason: reason });
  }

  if (contactId) {
    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
      select: { id: true, fullName: true, phone: true, email: true },
    });
    if (contact) {
      const elsewhere = await contactUsedElsewhere(contact.id, practiceId, now);
      const sharedReason = elsewhere
        ? "Also held for another engagement outside this practice — that practice must decide for its own records"
        : null;
      if (contact.phone) {
        items.push({
          kind: "CONTACT_PHONE",
          targetId: contact.id,
          label: `Phone number for ${contact.fullName}`,
          mustRetainReason: sharedReason,
        });
      }
      if (contact.email) {
        items.push({
          kind: "CONTACT_EMAIL",
          targetId: contact.id,
          label: `Email address for ${contact.fullName}`,
          mustRetainReason: sharedReason,
        });
      }
    }
  }

  items.push({
    kind: "AUDIT_TRAIL",
    targetId: AUDIT_TARGET,
    label: "Audit trail entries for this engagement",
    mustRetainReason:
      "Audit evidence is append-only and retained under the practice's legal duties (SEC04); it is not erasable on request",
  });
  return items;
}

export async function createErasureRequest(params: {
  actorUserId: string;
  practiceId: string;
  engagementId: string;
  contactId?: string | null;
  receivedVia: string;
  requestText: string;
  now?: Date;
}) {
  await assertCan(params.actorUserId, params.practiceId, "privacy.manage");
  const now = params.now ?? new Date();
  if (!params.receivedVia?.trim() || !params.requestText?.trim()) {
    throw new PrivacyError("Record how the request arrived and what it asks for", "FIELD_REQUIRED");
  }
  const engagement = await prisma.engagement.findFirst({
    where: { id: params.engagementId, practiceId: params.practiceId },
    select: { id: true, clientRelationshipId: true },
  });
  if (!engagement) throw new PrivacyError("Not found", "NOT_FOUND", 404);
  if (params.contactId) {
    // The contact must be connected to THIS practice's client.
    const linked = await prisma.contactAuthority.count({
      where: {
        contactId: params.contactId,
        practiceId: params.practiceId,
        clientRelationshipId: engagement.clientRelationshipId,
      },
    });
    if (!linked) throw new PrivacyError("Not found", "NOT_FOUND", 404);
  }

  const listed = await findings(params.practiceId, engagement.id, params.contactId ?? null, now);
  const name = await actorName(params.actorUserId);
  const request = await prisma.erasureRequest.create({
    data: {
      practiceId: params.practiceId,
      engagementId: engagement.id,
      contactId: params.contactId ?? null,
      receivedVia: params.receivedVia.trim(),
      requestText: params.requestText.trim(),
      requestedByUserId: params.actorUserId,
      requestedByName: name,
      items: {
        // practiceId comes from the parent through the composite relation.
        create: listed.map((i) => ({
          kind: i.kind,
          targetId: i.targetId,
          label: i.label,
          mustRetainReason: i.mustRetainReason,
        })),
      },
    },
    include: { items: true },
  });

  await recordEvent({
    action: "ERASURE_REQUEST_RECORDED",
    targetType: "ErasureRequest",
    targetId: request.id,
    result: "SUCCESS",
    actorUserId: params.actorUserId,
    practiceId: params.practiceId,
    targetVersion: request.version,
    afterMeta: {
      items: request.items.length,
      mustRetain: request.items.filter((i) => i.mustRetainReason).length,
    },
  });
  return request;
}

export type ItemDecisionInput = { itemId: string; decision: ErasureDecision; reason: string };

/**
 * The review. Every item must be decided, each with a reason; an ERASE on an
 * item the system must retain is refused and names the item. The findings are
 * recomputed here, so a hold placed since the request was logged still binds.
 */
export async function reviewErasureRequest(params: {
  actorUserId: string;
  practiceId: string;
  requestId: string;
  expectedVersion: number;
  decisions: ItemDecisionInput[];
  now?: Date;
}) {
  await assertCan(params.actorUserId, params.practiceId, "privacy.manage");
  const now = params.now ?? new Date();
  const request = await prisma.erasureRequest.findFirst({
    where: { id: params.requestId, practiceId: params.practiceId },
    include: { items: true },
  });
  if (!request) throw new PrivacyError("Not found", "NOT_FOUND", 404);
  if (request.requestedByUserId === params.actorUserId) {
    throw new PrivacyError(
      "The person who logged an erasure request cannot also review it",
      "SELF_REVIEW_REFUSED",
      403,
    );
  }
  if (request.state !== "REQUESTED") {
    throw new PrivacyError("This request has already been reviewed", "ALREADY_REVIEWED", 409);
  }
  if (request.version !== params.expectedVersion) {
    throw await versionConflict({
      subjectType: "ErasureRequest",
      subjectId: request.id,
      expectedVersion: params.expectedVersion,
      currentVersion: request.version,
    });
  }

  const byId = new Map(params.decisions.map((d) => [d.itemId, d]));
  const undecided = request.items.filter((i) => !byId.has(i.id));
  if (undecided.length) {
    throw new PrivacyError(
      `Every item needs a decision — ${undecided.length} left undecided`,
      "ITEMS_UNDECIDED",
    );
  }
  for (const d of params.decisions) {
    if (!request.items.some((i) => i.id === d.itemId)) {
      throw new PrivacyError("A decision names an item not on this request", "UNKNOWN_ITEM");
    }
    if (!d.reason?.trim()) {
      throw new PrivacyError("Every decision needs a reason", "REASON_REQUIRED");
    }
  }

  // Recompute what must be retained NOW.
  const fresh = await findings(request.practiceId, request.engagementId, request.contactId, now);
  const freshReason = new Map(fresh.map((f) => [`${f.kind}:${f.targetId}`, f.mustRetainReason]));
  for (const item of request.items) {
    const must = freshReason.get(`${item.kind}:${item.targetId}`) ?? item.mustRetainReason;
    if (must && byId.get(item.id)!.decision === "ERASE") {
      throw new PrivacyError(
        `"${item.label}" cannot be erased: ${must}`,
        "MUST_RETAIN",
        409,
      );
    }
  }

  const name = await actorName(params.actorUserId);
  await prisma.$transaction(async (tx) => {
    const bumped = await tx.erasureRequest.updateMany({
      where: { id: request.id, version: params.expectedVersion, state: "REQUESTED" },
      data: {
        state: "REVIEWED",
        reviewedByUserId: params.actorUserId,
        reviewedByName: name,
        reviewedAt: now,
        version: { increment: 1 },
      },
    });
    if (bumped.count === 0) {
      throw await versionConflict({
        subjectType: "ErasureRequest",
        subjectId: request.id,
        expectedVersion: params.expectedVersion,
        currentVersion: params.expectedVersion + 1,
      });
    }
    for (const item of request.items) {
      const d = byId.get(item.id)!;
      const must = freshReason.get(`${item.kind}:${item.targetId}`) ?? item.mustRetainReason;
      await tx.erasureItem.update({
        where: { id: item.id },
        data: { decision: d.decision, reason: d.reason.trim(), mustRetainReason: must },
      });
    }
  });

  await recordEvent({
    action: "ERASURE_REQUEST_REVIEWED",
    targetType: "ErasureRequest",
    targetId: request.id,
    result: "SUCCESS",
    actorUserId: params.actorUserId,
    practiceId: params.practiceId,
    targetVersion: params.expectedVersion + 1,
    afterMeta: {
      erase: params.decisions.filter((d) => d.decision === "ERASE").length,
      retain: params.decisions.filter((d) => d.decision === "RETAIN").length,
    },
  });
  return prisma.erasureRequest.findUniqueOrThrow({ where: { id: request.id }, include: { items: true } });
}

/**
 * Carry out the ERASE decisions only. Documents go through DOC06 — requested
 * in the name of whoever logged the erasure request, approved and executed by
 * the reviewer — so the separation of duties there still holds. Contact
 * details are cleared and the fact of clearing is logged WITHOUT the value.
 */
export async function actionErasureRequest(params: {
  actorUserId: string;
  practiceId: string;
  requestId: string;
  expectedVersion: number;
  now?: Date;
}) {
  await assertCan(params.actorUserId, params.practiceId, "privacy.manage");
  const now = params.now ?? new Date();
  const request = await prisma.erasureRequest.findFirst({
    where: { id: params.requestId, practiceId: params.practiceId },
    include: { items: true },
  });
  if (!request) throw new PrivacyError("Not found", "NOT_FOUND", 404);
  if (request.state !== "REVIEWED") {
    throw new PrivacyError("Only a reviewed request can be actioned", "NOT_REVIEWED", 409);
  }
  if (request.reviewedByUserId !== params.actorUserId) {
    throw new PrivacyError("The reviewer actions their own decisions", "NOT_THE_REVIEWER", 403);
  }
  if (request.version !== params.expectedVersion) {
    throw await versionConflict({
      subjectType: "ErasureRequest",
      subjectId: request.id,
      expectedVersion: params.expectedVersion,
      currentVersion: request.version,
    });
  }

  // Re-check at the last moment: a hold placed after review still binds.
  const fresh = await findings(request.practiceId, request.engagementId, request.contactId, now);
  const freshReason = new Map(fresh.map((f) => [`${f.kind}:${f.targetId}`, f.mustRetainReason]));

  let erased = 0;
  let retained = 0;
  const newlyBlocked: string[] = [];
  for (const item of request.items) {
    if (item.decision !== "ERASE") {
      retained++;
      continue;
    }
    const must = freshReason.get(`${item.kind}:${item.targetId}`);
    if (must) {
      newlyBlocked.push(item.label);
      retained++;
      await prisma.erasureItem.update({
        where: { id: item.id },
        data: { decision: "RETAIN", reason: `Not actioned — since review: ${must}`, mustRetainReason: must },
      });
      continue;
    }

    if (item.kind === "DOCUMENT") {
      const del = await requestDeletion({
        actorUserId: request.requestedByUserId,
        practiceId: params.practiceId,
        documentId: item.targetId,
        reason: `Erasure request ${request.id}: ${item.reason}`,
      });
      await approveDeletion({ actorUserId: params.actorUserId, practiceId: params.practiceId, requestId: del.id });
      await executeDeletion({ actorUserId: params.actorUserId, practiceId: params.practiceId, requestId: del.id });
      await prisma.erasureItem.update({
        where: { id: item.id },
        data: { actionedAt: now, deletionRequestId: del.id },
      });
    } else if (item.kind === "CONTACT_PHONE" || item.kind === "CONTACT_EMAIL") {
      const field = item.kind === "CONTACT_PHONE" ? "phone" : "email";
      await prisma.contact.update({
        where: { id: item.targetId },
        data:
          field === "phone"
            ? { phone: null, phoneVerificationStatus: "UNVERIFIED" }
            : { email: null, emailVerificationStatus: "UNVERIFIED" },
      });
      await recordEvent({
        action: "CONTACT_DETAIL_ERASED",
        targetType: "Contact",
        targetId: item.targetId,
        result: "SUCCESS",
        actorUserId: params.actorUserId,
        practiceId: params.practiceId,
        reason: item.reason,
        // The field name only — never the value that was erased.
        afterMeta: { field, erasureRequestId: request.id },
      });
      await prisma.erasureItem.update({ where: { id: item.id }, data: { actionedAt: now } });
    }
    erased++;
  }

  const state = erased === 0 ? "ALL_RETAINED" : retained === 0 ? "ACTIONED" : "PARTIALLY_ACTIONED";
  const summary =
    `${erased} item(s) erased, ${retained} retained with reasons` +
    (newlyBlocked.length ? `; ${newlyBlocked.length} became subject to retention after review` : "");
  await prisma.erasureRequest.update({
    where: { id: request.id },
    data: { state, actionedAt: now, outcomeSummary: summary, version: { increment: 1 } },
  });

  await recordEvent({
    action: "ERASURE_REQUEST_ACTIONED",
    targetType: "ErasureRequest",
    targetId: request.id,
    result: "SUCCESS",
    actorUserId: params.actorUserId,
    practiceId: params.practiceId,
    targetVersion: params.expectedVersion + 1,
    afterMeta: { state, erased, retained },
  });
  return prisma.erasureRequest.findUniqueOrThrow({ where: { id: request.id }, include: { items: true } });
}

export async function listErasureRequests(actorUserId: string, practiceId: string) {
  await assertCan(actorUserId, practiceId, "privacy.manage");
  return prisma.erasureRequest.findMany({
    where: { practiceId },
    orderBy: { requestedAt: "desc" },
    include: { items: true, engagement: { select: { serviceCode: true } } },
  });
}
