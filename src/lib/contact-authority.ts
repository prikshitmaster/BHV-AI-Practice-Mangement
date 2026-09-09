/**
 * Contact change authority — CLI01/CLI03 acceptance evidence (PRD §11).
 *
 *   "Reject an unauthorised email change; retain source evidence."
 *
 * Why this needs its own gate: a contact's email address is where statutory
 * correspondence, portal invitations and password resets go. Anyone who can
 * silently change it can redirect all three. So a change is a REQUEST, not an
 * edit — it is checked against who is asking, and the rejected attempts are
 * kept along with whatever evidence came with them.
 */

import type { FieldSource } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { recordEvent } from "@/lib/audit";
import { assertCan } from "@/lib/permissions";

export class UnauthorisedContactChangeError extends Error {
  readonly code = "UNAUTHORISED_CONTACT_CHANGE";
  readonly status = 403;
  constructor(
    message: string,
    readonly changeRequestId: string,
  ) {
    super(message);
    this.name = "UnauthorisedContactChangeError";
  }
}

/** Fields whose change requires explicit staff authority. */
const AUTHORITY_REQUIRED_FIELDS = new Set(["email", "phone"]);

export type ChangeRequester =
  | { kind: "STAFF"; userId: string; name: string }
  | { kind: "CONTACT"; contactId: string; name: string };

/**
 * Request a change to a contact field.
 *
 * A staff member with `client.write` in the owning practice can have it
 * applied. Anyone else — including the contact themselves, and including a
 * *different* contact at the same client — gets a recorded rejection, because
 * "the request came from the client" is not by itself authority to redirect
 * the client's correspondence.
 */
export async function requestContactChange(params: {
  practiceId: string;
  contactId: string;
  field: string;
  newValue: string;
  requester: ChangeRequester;
  source: FieldSource;
  sourceEvidence?: string;
}) {
  const contact = await prisma.contact.findUniqueOrThrow({
    where: { id: params.contactId },
    select: { id: true, email: true, phone: true, fullName: true, partyId: true },
  });

  // Confirm the contact actually belongs to a client of this practice —
  // otherwise this is a cross-practice write dressed up as an edit.
  const relationship = await prisma.clientRelationship.findFirst({
    where: { practiceId: params.practiceId, partyId: contact.partyId, archivedAt: null },
    select: { id: true },
  });
  if (!relationship) {
    throw new UnauthorisedContactChangeError(
      "This contact does not belong to a client of this practice.",
      "",
    );
  }

  const oldValue =
    params.field === "email" ? contact.email : params.field === "phone" ? contact.phone : null;

  const request = await prisma.contactChangeRequest.create({
    data: {
      practiceId: params.practiceId,
      contactId: params.contactId,
      field: params.field,
      oldValue,
      newValue: params.newValue,
      requestedByUserId: params.requester.kind === "STAFF" ? params.requester.userId : null,
      requestedByContactId: params.requester.kind === "CONTACT" ? params.requester.contactId : null,
      requestedByName: params.requester.name,
      source: params.source,
      // Retained whether the request succeeds or fails.
      sourceEvidence: params.sourceEvidence,
      status: "PENDING",
    },
  });

  const needsAuthority = AUTHORITY_REQUIRED_FIELDS.has(params.field);

  if (needsAuthority && params.requester.kind !== "STAFF") {
    const rejected = await rejectChange(
      request.id,
      "Requested by a client contact without staff authorisation. A change of " +
        "correspondence address must be authorised by the engagement team.",
      params.requester.name,
    );
    throw new UnauthorisedContactChangeError(
      "This change requires staff authorisation and has been recorded as rejected.",
      rejected.id,
    );
  }

  if (params.requester.kind === "STAFF") {
    try {
      await assertCan(params.requester.userId, params.practiceId, "client.write");
    } catch (e) {
      const rejected = await rejectChange(
        request.id,
        `Requester lacks client.write in this practice: ${(e as Error).message}`,
        params.requester.name,
      );
      throw new UnauthorisedContactChangeError(
        "You are not authorised to change this contact's details. The attempt has been recorded.",
        rejected.id,
      );
    }
  }

  return request;
}

async function rejectChange(requestId: string, reason: string, byName: string) {
  const rejected = await prisma.contactChangeRequest.update({
    where: { id: requestId },
    data: {
      status: "REJECTED",
      decisionReason: reason,
      decidedAt: new Date(),
      decidedByName: "system",
    },
  });

  await recordEvent({
    action: "CONTACT_CHANGE_REJECTED",
    targetType: "ContactChangeRequest",
    targetId: rejected.id,
    result: "FAILURE",
    practiceId: rejected.practiceId,
    reason,
    afterMeta: {
      field: rejected.field,
      requestedByName: byName,
      // The proposed value is kept as evidence: it shows where someone was
      // trying to redirect correspondence to.
      proposedValue: rejected.newValue,
      sourceEvidenceRetained: rejected.sourceEvidence !== null,
    },
  });

  return rejected;
}

/** Apply an approved change. The field's verification status resets. */
export async function approveContactChange(params: {
  requestId: string;
  approverUserId: string;
  approverName: string;
}) {
  const request = await prisma.contactChangeRequest.findUniqueOrThrow({
    where: { id: params.requestId },
  });

  if (request.status !== "PENDING") {
    throw new UnauthorisedContactChangeError(
      `This request is already ${request.status}.`,
      request.id,
    );
  }

  await assertCan(params.approverUserId, request.practiceId, "client.write");

  // Separation of duties: whoever raised it cannot also wave it through.
  // The request stays PENDING — refusing an approver must not destroy a
  // legitimate request, or an unauthorised approval attempt becomes a way to
  // kill someone else's work. It is audited and left for a valid approver.
  if (request.requestedByUserId && request.requestedByUserId === params.approverUserId) {
    await recordEvent({
      action: "CONTACT_CHANGE_SELF_APPROVAL_REFUSED",
      targetType: "ContactChangeRequest",
      targetId: request.id,
      result: "FAILURE",
      actorUserId: params.approverUserId,
      practiceId: request.practiceId,
      reason: "The requester cannot approve their own contact change",
    });

    throw new UnauthorisedContactChangeError(
      "You cannot approve your own contact change request. It remains pending for another approver.",
      request.id,
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const applied = await tx.contactChangeRequest.update({
      where: { id: request.id },
      data: {
        status: "APPROVED",
        decidedByUserId: params.approverUserId,
        decidedByName: params.approverName,
        decidedAt: new Date(),
      },
    });

    // A newly changed channel is UNVERIFIED again — approving the change does
    // not prove the new address reaches the client.
    if (request.field === "email") {
      await tx.contact.update({
        where: { id: request.contactId },
        data: { email: request.newValue, emailVerificationStatus: "UNVERIFIED" },
      });
    } else if (request.field === "phone") {
      await tx.contact.update({
        where: { id: request.contactId },
        data: { phone: request.newValue, phoneVerificationStatus: "UNVERIFIED" },
      });
    }

    return applied;
  });

  await recordEvent({
    action: "CONTACT_CHANGE_APPROVED",
    targetType: "ContactChangeRequest",
    targetId: updated.id,
    result: "SUCCESS",
    actorUserId: params.approverUserId,
    practiceId: updated.practiceId,
    beforeMeta: { field: updated.field, oldValue: updated.oldValue },
    afterMeta: { field: updated.field, newValue: updated.newValue, verificationReset: true },
  });

  return updated;
}
