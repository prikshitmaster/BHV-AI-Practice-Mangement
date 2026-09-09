/**
 * Communication and client requests — COM01-04 (PRD §16).
 * COM05 (meetings) is R1; COM06 (WhatsApp and other channels) is R2.
 *
 * Four requirements drive the design, and each is enforced structurally rather
 * than by convention:
 *
 * COM01  A thread's visibility cannot change without previewing what is in it.
 *        The preview is a stored record carrying a digest of exactly what was
 *        shown; the digest is recomputed from live content at commit. A message
 *        added or altered between preview and commit therefore invalidates the
 *        preview instead of riding through it unseen.
 *
 * COM02  "One upload cannot close all requests." A response names ONE item, and
 *        reminders are suppressed per item — so there is no code path, correct
 *        or buggy, that clears a sibling item. Whether receipt alone stops the
 *        reminder or acceptance is required is the request's configured rule.
 *
 * COM03  What the sender confirmed and what actually leaves must be the same
 *        thing. The confirmation snapshot is hashed and the send is refused if
 *        the hash no longer matches. The sending identity is read from the
 *        practice that owns the SUBJECT, never from the caller — that is what
 *        stops a Company invoice going out under an Associates letterhead.
 *
 * COM04  Provider acceptance is not delivery, and delivery is not reading. The
 *        six states are logged separately and no transition promotes one into
 *        another. A duplicate key makes "one logical message" a database
 *        constraint rather than a worker-coordination hope.
 */

import { createHash } from "node:crypto";
import type {
  DigestMode,
  MessageChannel,
  MessageDirection,
  OutboundKind,
  OutboundState,
  RequestItemState,
  RequestResponseKind,
  ThreadVisibility,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { recordEvent } from "@/lib/audit";
import { assertCan } from "@/lib/permissions";

export class CommunicationError extends Error {
  readonly status: number;
  constructor(
    message: string,
    readonly code: string,
    status = 409,
  ) {
    super(message);
    this.name = "CommunicationError";
    this.status = status;
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

// ===========================================================================
// COM01 — Unified context
// ===========================================================================

export async function createThread(params: {
  practiceId: string;
  actorUserId: string;
  clientRelationshipId: string;
  engagementId?: string | null;
  jobId?: string | null;
  subject: string;
  visibility?: ThreadVisibility;
}) {
  await assertCan(params.actorUserId, params.practiceId, "message.post_internal");

  // The client relationship must belong to this practice. Reading it through
  // the practice-scoped filter rather than trusting the id is the ORG04 rule.
  const relationship = await prisma.clientRelationship.findFirst({
    where: { id: params.clientRelationshipId, practiceId: params.practiceId },
    select: { id: true },
  });
  if (!relationship) {
    throw new CommunicationError(
      "Client relationship not found in this practice",
      "RELATIONSHIP_NOT_FOUND",
      404,
    );
  }

  const thread = await prisma.messageThread.create({
    data: {
      practiceId: params.practiceId,
      clientRelationshipId: params.clientRelationshipId,
      engagementId: params.engagementId ?? null,
      jobId: params.jobId ?? null,
      subject: params.subject,
      visibility: params.visibility ?? "INTERNAL",
      createdByUserId: params.actorUserId,
    },
  });

  await recordEvent({
    action: "THREAD_CREATED",
    targetType: "MessageThread",
    targetId: thread.id,
    targetVersion: thread.version,
    result: "SUCCESS",
    actorUserId: params.actorUserId,
    practiceId: params.practiceId,
    afterMeta: { subject: params.subject, visibility: thread.visibility },
  });

  return thread;
}

export async function postMessage(params: {
  practiceId: string;
  threadId: string;
  direction: MessageDirection;
  channel: MessageChannel;
  visibility: ThreadVisibility;
  body: string;
  actorUserId?: string | null;
  authorContactId?: string | null;
  authorName?: string;
  externalReference?: string | null;
  attachedVersionIds?: string[];
}) {
  const thread = await prisma.messageThread.findFirst({
    where: { id: params.threadId, practiceId: params.practiceId, archivedAt: null },
    select: { id: true, visibility: true },
  });
  if (!thread) {
    throw new CommunicationError("Thread not found in this practice", "THREAD_NOT_FOUND", 404);
  }

  let authorName = params.authorName;

  if (params.actorUserId) {
    // Writing to the client and writing an internal note are different acts.
    const action =
      params.visibility === "CLIENT_VISIBLE" ? "message.send_client" : "message.post_internal";
    await assertCan(params.actorUserId, params.practiceId, action);

    if (!authorName) {
      const user = await prisma.user.findUnique({
        where: { id: params.actorUserId },
        select: { fullName: true },
      });
      authorName = user?.fullName ?? "Unknown user";
    }
  } else if (params.authorContactId) {
    // A client contact may only write into a thread their side can see.
    if (thread.visibility !== "CLIENT_VISIBLE") {
      throw new CommunicationError(
        "Thread is not visible to the client",
        "THREAD_NOT_CLIENT_VISIBLE",
        404,
      );
    }
    const contact = await prisma.contact.findFirst({
      where: {
        id: params.authorContactId,
        archivedAt: null,
        authorities: {
          some: {
            practiceId: params.practiceId,
            revokedAt: null,
            effectiveFrom: { lte: new Date() },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }],
          },
        },
      },
      select: { fullName: true },
    });
    if (!contact) {
      throw new CommunicationError(
        "Contact has no live authority in this practice",
        "CONTACT_NOT_AUTHORISED",
        404,
      );
    }
    authorName = authorName ?? contact.fullName;
  } else {
    // There is no anonymous author. An unattributable message in a client file
    // is worse than no message.
    throw new CommunicationError("A message must have an author", "NO_AUTHOR", 400);
  }

  const message = await prisma.message.create({
    data: {
      practiceId: params.practiceId,
      threadId: params.threadId,
      direction: params.direction,
      channel: params.channel,
      visibility: params.visibility,
      body: params.body,
      authorUserId: params.actorUserId ?? null,
      authorContactId: params.authorContactId ?? null,
      authorName: authorName!,
      externalReference: params.externalReference ?? null,
      attachedVersionIds: params.attachedVersionIds ?? [],
    },
  });

  await prisma.messageThread.update({
    where: { id: params.threadId },
    data: { updatedAt: new Date() },
  });

  return message;
}

/**
 * Canonical digest of a thread's content. Fields are read by name and joined in
 * a fixed order — never JSON.stringify, whose key order is not guaranteed and
 * which made a T11 manifest hash verify by luck of serialisation.
 */
function threadContentDigest(
  messages: {
    id: string;
    visibility: ThreadVisibility;
    body: string;
    attachedVersionIds: string[];
  }[],
): string {
  const canonical = messages
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(
      (m) =>
        `${m.id}|${m.visibility}|${sha256(m.body)}|${m.attachedVersionIds.slice().sort().join(",")}`,
    )
    .join("\n");
  return sha256(canonical);
}

/**
 * COM01 step one: show the user everything the change would expose, and record
 * that it was shown. Returns the preview id and the content the caller must
 * render — the digest alone is not a substitute for displaying it.
 */
export async function previewVisibilityChange(params: {
  practiceId: string;
  actorUserId: string;
  threadId: string;
  toVisibility: ThreadVisibility;
}) {
  await assertCan(params.actorUserId, params.practiceId, "thread.change_visibility");

  const thread = await prisma.messageThread.findFirst({
    where: { id: params.threadId, practiceId: params.practiceId, archivedAt: null },
    select: { id: true, visibility: true, version: true, subject: true },
  });
  if (!thread) {
    throw new CommunicationError("Thread not found in this practice", "THREAD_NOT_FOUND", 404);
  }
  if (thread.visibility === params.toVisibility) {
    throw new CommunicationError(
      "Thread already has that visibility",
      "NO_VISIBILITY_CHANGE",
      400,
    );
  }

  const messages = await prisma.message.findMany({
    where: { threadId: params.threadId, practiceId: params.practiceId },
    select: {
      id: true,
      visibility: true,
      body: true,
      attachedVersionIds: true,
      authorName: true,
      direction: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const digest = threadContentDigest(messages);

  const preview = await prisma.threadVisibilityChange.create({
    data: {
      practiceId: params.practiceId,
      threadId: params.threadId,
      fromVisibility: thread.visibility,
      toVisibility: params.toVisibility,
      contentDigest: digest,
      previewedCount: messages.length,
      previewedByUserId: params.actorUserId,
    },
  });

  return {
    previewId: preview.id,
    threadVersion: thread.version,
    contentDigest: digest,
    /**
     * What the client would gain sight of. Everything currently marked
     * INTERNAL is called out separately, because that is the material the
     * reviewer is actually being asked about.
     */
    messages,
    internalMessagesExposed: messages.filter((m) => m.visibility === "INTERNAL"),
    attachedVersionIds: [...new Set(messages.flatMap((m) => m.attachedVersionIds))],
  };
}

/**
 * COM01 step two. Refuses without a preview, with someone else's preview, with
 * a stale preview, or against a thread version that has moved (API02).
 */
export async function commitVisibilityChange(params: {
  practiceId: string;
  actorUserId: string;
  threadId: string;
  previewId: string;
  expectedVersion: number;
}) {
  await assertCan(params.actorUserId, params.practiceId, "thread.change_visibility");

  const preview = await prisma.threadVisibilityChange.findFirst({
    where: {
      id: params.previewId,
      threadId: params.threadId,
      practiceId: params.practiceId,
    },
  });
  if (!preview) {
    throw new CommunicationError(
      "Visibility cannot change without a preview of the thread's content",
      "PREVIEW_REQUIRED",
      400,
    );
  }
  if (preview.committedAt || preview.abandonedAt) {
    throw new CommunicationError("Preview has already been used", "PREVIEW_SPENT", 409);
  }
  // The person who looked is the person who decides. Handing a colleague a
  // preview id would defeat the point of previewing.
  if (preview.previewedByUserId !== params.actorUserId) {
    throw new CommunicationError(
      "The preview must be committed by the user who reviewed it",
      "PREVIEW_NOT_YOURS",
      403,
    );
  }

  const thread = await prisma.messageThread.findFirst({
    where: { id: params.threadId, practiceId: params.practiceId, archivedAt: null },
    select: { id: true, version: true, visibility: true },
  });
  if (!thread) {
    throw new CommunicationError("Thread not found in this practice", "THREAD_NOT_FOUND", 404);
  }
  if (thread.version !== params.expectedVersion) {
    throw new CommunicationError(
      `Thread has changed since it was loaded (expected version ${params.expectedVersion}, found ${thread.version})`,
      "VERSION_CONFLICT",
      409,
    );
  }

  const messages = await prisma.message.findMany({
    where: { threadId: params.threadId, practiceId: params.practiceId },
    select: { id: true, visibility: true, body: true, attachedVersionIds: true },
  });
  const liveDigest = threadContentDigest(messages);

  if (liveDigest !== preview.contentDigest) {
    const reason = "Thread content changed after the preview; re-preview before changing visibility";
    await prisma.threadVisibilityChange.update({
      where: { id: preview.id },
      data: { abandonedAt: new Date(), refusalReason: reason },
    });
    await recordEvent({
      action: "THREAD_VISIBILITY_CHANGE_REFUSED",
      targetType: "MessageThread",
      targetId: params.threadId,
      targetVersion: thread.version,
      result: "FAILURE",
      actorUserId: params.actorUserId,
      practiceId: params.practiceId,
      reason,
      beforeMeta: { previewedCount: preview.previewedCount },
      afterMeta: { liveCount: messages.length },
    });
    throw new CommunicationError(reason, "PREVIEW_STALE", 409);
  }

  const updated = await prisma.messageThread.update({
    where: { id: params.threadId },
    data: { visibility: preview.toVisibility, version: { increment: 1 } },
  });
  await prisma.threadVisibilityChange.update({
    where: { id: preview.id },
    data: { committedAt: new Date(), committedByUserId: params.actorUserId },
  });

  await recordEvent({
    action: "THREAD_VISIBILITY_CHANGED",
    targetType: "MessageThread",
    targetId: params.threadId,
    targetVersion: updated.version,
    result: "SUCCESS",
    actorUserId: params.actorUserId,
    practiceId: params.practiceId,
    beforeMeta: { visibility: preview.fromVisibility },
    afterMeta: {
      visibility: preview.toVisibility,
      previewedCount: preview.previewedCount,
      contentDigest: preview.contentDigest,
    },
  });

  return updated;
}

/**
 * What a client contact may read. Both gates apply: the thread must be
 * client-visible AND the individual message must be. Making a thread visible
 * does not retroactively declassify the internal notes inside it.
 */
export async function clientVisibleMessages(params: {
  practiceId: string;
  threadId: string;
  contactId: string;
}) {
  const now = new Date();
  const thread = await prisma.messageThread.findFirst({
    where: {
      id: params.threadId,
      practiceId: params.practiceId,
      archivedAt: null,
      visibility: "CLIENT_VISIBLE",
      clientRelationship: {
        contactAuthorities: {
          some: {
            contactId: params.contactId,
            revokedAt: null,
            effectiveFrom: { lte: now },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
          },
        },
      },
    },
    select: { id: true, subject: true },
  });
  if (!thread) return null;

  const messages = await prisma.message.findMany({
    where: {
      threadId: params.threadId,
      practiceId: params.practiceId,
      visibility: "CLIENT_VISIBLE",
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      body: true,
      authorName: true,
      direction: true,
      channel: true,
      attachedVersionIds: true,
      createdAt: true,
    },
  });

  return { thread, messages };
}

// ===========================================================================
// COM02 — Structured requests
// ===========================================================================

export type RequestItemInput = {
  documentType: string;
  description?: string | null;
  periodLabel?: string | null;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  dueDate?: Date | null;
  ownerUserId?: string | null;
};

export async function addRequestItems(params: {
  practiceId: string;
  actorUserId: string;
  requestId: string;
  items: RequestItemInput[];
}) {
  await assertCan(params.actorUserId, params.practiceId, "job.write");

  const request = await prisma.clientRequest.findFirst({
    where: { id: params.requestId, practiceId: params.practiceId },
    select: { id: true, items: { select: { sequence: true } } },
  });
  if (!request) {
    throw new CommunicationError("Request not found in this practice", "REQUEST_NOT_FOUND", 404);
  }
  if (params.items.length === 0) {
    throw new CommunicationError("A request must itemise what is wanted", "NO_ITEMS", 400);
  }

  const start = request.items.reduce((max, i) => Math.max(max, i.sequence), 0);

  return prisma.$transaction(
    params.items.map((item, index) =>
      prisma.clientRequestItem.create({
        data: {
          practiceId: params.practiceId,
          requestId: params.requestId,
          sequence: start + index + 1,
          documentType: item.documentType,
          description: item.description ?? null,
          periodLabel: item.periodLabel ?? null,
          periodStart: item.periodStart ?? null,
          periodEnd: item.periodEnd ?? null,
          dueDate: item.dueDate ?? null,
          ownerUserId: item.ownerUserId ?? null,
        },
      }),
    ),
  );
}

/**
 * A client (or staff member acting on their behalf) answers ONE item.
 *
 * The single-item scope is the whole point: the response carries an itemId and
 * nothing else, so no amount of later carelessness can make one upload satisfy
 * a sibling item. Under ON_RECEIPT the arrival stops that item's reminder;
 * under ON_ACCEPTANCE the reminder keeps running until staff accept it.
 */
export async function submitItemResponse(params: {
  practiceId: string;
  itemId: string;
  kind: RequestResponseKind;
  documentVersionId?: string | null;
  explanation?: string | null;
  respondedByContactId?: string | null;
  respondedByUserId?: string | null;
  expectedVersion?: number;
}) {
  const now = new Date();

  const item = await prisma.clientRequestItem.findFirst({
    where: { id: params.itemId, practiceId: params.practiceId },
    select: {
      id: true,
      version: true,
      state: true,
      requestId: true,
      request: { select: { closeRule: true, clientRelationshipId: true } },
    },
  });
  if (!item) {
    throw new CommunicationError("Request item not found", "ITEM_NOT_FOUND", 404);
  }
  if (params.expectedVersion !== undefined && item.version !== params.expectedVersion) {
    throw new CommunicationError(
      `Item has changed since it was loaded (expected ${params.expectedVersion}, found ${item.version})`,
      "VERSION_CONFLICT",
    );
  }
  if (item.state === "WAIVED") {
    throw new CommunicationError("Item has been waived", "ITEM_WAIVED", 409);
  }

  let respondedByName: string;

  if (params.respondedByContactId) {
    // A document response needs UPLOAD authority; a question or an explanation
    // of non-availability is something any authorised contact may give.
    const needsUpload = params.kind === "DOCUMENT";
    const contact = await prisma.contact.findFirst({
      where: {
        id: params.respondedByContactId,
        archivedAt: null,
        authorities: {
          some: {
            practiceId: params.practiceId,
            clientRelationshipId: item.request.clientRelationshipId,
            revokedAt: null,
            effectiveFrom: { lte: now },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
            ...(needsUpload ? { authority: { in: ["UPLOAD", "APPROVE", "SIGNATORY"] } } : {}),
          },
        },
      },
      select: { fullName: true },
    });
    if (!contact) {
      throw new CommunicationError(
        needsUpload
          ? "Contact does not hold live upload authority for this client"
          : "Contact has no live authority for this client",
        "CONTACT_NOT_AUTHORISED",
        404,
      );
    }
    respondedByName = contact.fullName;
  } else if (params.respondedByUserId) {
    await assertCan(params.respondedByUserId, params.practiceId, "document.upload");
    const user = await prisma.user.findUnique({
      where: { id: params.respondedByUserId },
      select: { fullName: true },
    });
    respondedByName = user?.fullName ?? "Unknown user";
  } else {
    throw new CommunicationError("A response must have a responder", "NO_RESPONDER", 400);
  }

  if (params.kind === "DOCUMENT" && !params.documentVersionId) {
    throw new CommunicationError(
      "A document response must name the version received",
      "NO_DOCUMENT_VERSION",
      400,
    );
  }
  if (params.kind !== "DOCUMENT" && !params.explanation) {
    throw new CommunicationError(
      "A non-document response must explain itself",
      "NO_EXPLANATION",
      400,
    );
  }

  const nextState: RequestItemState =
    params.kind === "DOCUMENT"
      ? "SUBMITTED"
      : params.kind === "NOT_AVAILABLE_EXPLANATION"
        ? "NOT_AVAILABLE"
        : params.kind === "QUESTION"
          ? "QUESTION_RAISED"
          : item.state;

  // Reminders stop on receipt only if the request says so, and only ever for
  // a DOCUMENT — a question raised is not a delivery.
  const stopsReminders = params.kind === "DOCUMENT" && item.request.closeRule === "ON_RECEIPT";

  const [response, updatedItem] = await prisma.$transaction([
    prisma.clientRequestItemResponse.create({
      data: {
        practiceId: params.practiceId,
        itemId: params.itemId,
        kind: params.kind,
        documentVersionId: params.documentVersionId ?? null,
        explanation: params.explanation ?? null,
        respondedByContactId: params.respondedByContactId ?? null,
        respondedByUserId: params.respondedByUserId ?? null,
        respondedByName,
      },
    }),
    prisma.clientRequestItem.update({
      where: { id: params.itemId },
      data: {
        state: nextState,
        stateChangedAt: now,
        remindersStoppedAt: stopsReminders ? now : undefined,
        version: { increment: 1 },
      },
    }),
  ]);

  await recordEvent({
    action: "REQUEST_ITEM_RESPONSE",
    targetType: "ClientRequestItem",
    targetId: params.itemId,
    targetVersion: updatedItem.version,
    result: "SUCCESS",
    practiceId: params.practiceId,
    actorUserId: params.respondedByUserId ?? null,
    afterMeta: {
      kind: params.kind,
      state: nextState,
      remindersStopped: stopsReminders,
      closeRule: item.request.closeRule,
    },
  });

  await recomputeRequestState(params.practiceId, item.requestId);

  return { response, item: updatedItem };
}

/** Staff accept a submitted item. Under ON_ACCEPTANCE this is what stops the reminder. */
export async function acceptItemResponse(params: {
  practiceId: string;
  actorUserId: string;
  responseId: string;
}) {
  await assertCan(params.actorUserId, params.practiceId, "job.write");
  const now = new Date();

  const response = await prisma.clientRequestItemResponse.findFirst({
    where: { id: params.responseId, practiceId: params.practiceId, supersededAt: null },
    select: {
      id: true,
      itemId: true,
      acceptedAt: true,
      rejectedAt: true,
      item: { select: { requestId: true } },
    },
  });
  if (!response) {
    throw new CommunicationError("Response not found", "RESPONSE_NOT_FOUND", 404);
  }
  if (response.acceptedAt || response.rejectedAt) {
    throw new CommunicationError("Response has already been decided", "ALREADY_DECIDED", 409);
  }

  const [, item] = await prisma.$transaction([
    prisma.clientRequestItemResponse.update({
      where: { id: params.responseId },
      data: { acceptedAt: now, acceptedByUserId: params.actorUserId },
    }),
    prisma.clientRequestItem.update({
      where: { id: response.itemId },
      data: {
        state: "ACCEPTED",
        stateChangedAt: now,
        remindersStoppedAt: now,
        version: { increment: 1 },
      },
    }),
  ]);

  await recordEvent({
    action: "REQUEST_ITEM_ACCEPTED",
    targetType: "ClientRequestItem",
    targetId: response.itemId,
    targetVersion: item.version,
    result: "SUCCESS",
    actorUserId: params.actorUserId,
    practiceId: params.practiceId,
  });

  await recomputeRequestState(params.practiceId, response.item.requestId);
  return item;
}

/**
 * Staff reject what was sent. The item goes back to OUTSTANDING and its
 * reminder RESTARTS — a wrong file is not a delivered file, and letting the
 * reminder stay off is how an item goes quietly missing before a deadline.
 */
export async function rejectItemResponse(params: {
  practiceId: string;
  actorUserId: string;
  responseId: string;
  reason: string;
}) {
  await assertCan(params.actorUserId, params.practiceId, "job.write");
  const now = new Date();

  const response = await prisma.clientRequestItemResponse.findFirst({
    where: { id: params.responseId, practiceId: params.practiceId, supersededAt: null },
    select: {
      id: true,
      itemId: true,
      acceptedAt: true,
      rejectedAt: true,
      item: { select: { requestId: true } },
    },
  });
  if (!response) {
    throw new CommunicationError("Response not found", "RESPONSE_NOT_FOUND", 404);
  }
  if (response.acceptedAt || response.rejectedAt) {
    throw new CommunicationError("Response has already been decided", "ALREADY_DECIDED", 409);
  }
  if (!params.reason.trim()) {
    throw new CommunicationError(
      "A rejection must say what was wrong with it",
      "NO_REASON",
      400,
    );
  }

  const [, item] = await prisma.$transaction([
    prisma.clientRequestItemResponse.update({
      where: { id: params.responseId },
      data: { rejectedAt: now, rejectionReason: params.reason, supersededAt: now },
    }),
    prisma.clientRequestItem.update({
      where: { id: response.itemId },
      data: {
        state: "OUTSTANDING",
        stateChangedAt: now,
        remindersStoppedAt: null,
        version: { increment: 1 },
      },
    }),
  ]);

  await recordEvent({
    action: "REQUEST_ITEM_REJECTED",
    targetType: "ClientRequestItem",
    targetId: response.itemId,
    targetVersion: item.version,
    result: "SUCCESS",
    actorUserId: params.actorUserId,
    practiceId: params.practiceId,
    reason: params.reason,
    afterMeta: { remindersRestarted: true },
  });

  await recomputeRequestState(params.practiceId, response.item.requestId);
  return item;
}

/** Items that should still generate reminders — the only list the engine reads. */
export async function outstandingItems(practiceId: string, requestId: string) {
  return prisma.clientRequestItem.findMany({
    where: { practiceId, requestId, remindersStoppedAt: null },
    orderBy: { sequence: "asc" },
  });
}

/**
 * The parent request's state is DERIVED from its items, never set directly.
 * A request cannot report itself closed while an item is still outstanding.
 */
export async function recomputeRequestState(practiceId: string, requestId: string) {
  const items = await prisma.clientRequestItem.findMany({
    where: { practiceId, requestId },
    select: { state: true, remindersStoppedAt: true },
  });
  if (items.length === 0) return null;

  const settled = items.filter((i) => i.remindersStoppedAt !== null).length;
  const anyResponse = items.some((i) => i.state !== "OUTSTANDING");

  const state =
    settled === items.length ? "RECEIVED" : settled > 0 || anyResponse ? "PARTIALLY_RECEIVED" : "SENT";

  return prisma.clientRequest.update({
    where: { id: requestId },
    data: {
      state,
      receivedAt: settled === items.length ? new Date() : null,
    },
  });
}

// ===========================================================================
// COM03 — Outbound safeguards
// ===========================================================================

export type PreviewRecipient = {
  contactId: string | null;
  address: string;
  name: string;
  role: string;
  authorityBasis: string;
  wasChangedRecipient: boolean;
};

/**
 * The confirmation snapshot, hashed. Canonical field order, sorted lists —
 * the same discipline as the audit chain and the DOC06 manifest.
 */
export function outboundPreviewHash(preview: {
  practiceId: string;
  sendingPracticeName: string;
  fromIdentity: string;
  replyToIdentity: string;
  renderedSubject: string;
  renderedBody: string;
  recipients: { address: string }[];
  attachedVersionIds: string[];
}): string {
  return sha256(
    [
      `practice:${preview.practiceId}`,
      `name:${preview.sendingPracticeName}`,
      `from:${preview.fromIdentity}`,
      `replyTo:${preview.replyToIdentity}`,
      `subject:${preview.renderedSubject}`,
      `body:${sha256(preview.renderedBody)}`,
      `to:${preview.recipients.map((r) => r.address.toLowerCase()).slice().sort().join(",")}`,
      `versions:${preview.attachedVersionIds.slice().sort().join(",")}`,
    ].join("\n"),
  );
}

/** Placeholders only. A stored template must not already contain client data. */
const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

/**
 * COM03: "Templates contain no client data until rendered within the
 * authorised scope." Rendering happens here, at send time, from values the
 * caller has already been authorised to read — and the result is written to
 * the OutboundMessage, never back onto the template.
 */
export function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(PLACEHOLDER, (_match, key: string) => {
    if (!(key in values)) {
      throw new CommunicationError(
        `Template placeholder {{${key}}} has no value in the authorised scope`,
        "UNRESOLVED_PLACEHOLDER",
        400,
      );
    }
    return values[key];
  });
}

/**
 * Builds the confirmation screen's content and its hash. Nothing is sent here.
 *
 * The sending identity is read from the Practice row, not from the caller. A
 * request body that says "send as B H Vyas & Company" is a request, never
 * evidence — the same rule practice-scope.ts applies to reads.
 */
export async function buildOutboundPreview(params: {
  practiceId: string;
  actorUserId: string;
  kind: OutboundKind;
  clientRelationshipId: string;
  threadId?: string | null;
  subject: string;
  body: string;
  templateId?: string | null;
  contactIds: string[];
  /** Addresses that differ from the contact's record, keyed by contact id. */
  overrideAddresses?: Record<string, string>;
  attachedVersionIds?: string[];
  portalLinkTokenIds?: string[];
}) {
  await assertCan(params.actorUserId, params.practiceId, "message.send_client");
  const now = new Date();

  const practice = await prisma.practice.findFirst({
    where: { id: params.practiceId, archivedAt: null },
    select: {
      id: true,
      name: true,
      registeredDisplayName: true,
      documentNamespace: true,
      readOnlyFrom: true,
    },
  });
  if (!practice) {
    throw new CommunicationError("Practice not found", "PRACTICE_NOT_FOUND", 404);
  }
  if (practice.readOnlyFrom && practice.readOnlyFrom <= now) {
    throw new CommunicationError(
      "A deactivated practice is read-only and cannot send correspondence",
      "PRACTICE_READ_ONLY",
    );
  }

  const relationship = await prisma.clientRelationship.findFirst({
    where: { id: params.clientRelationshipId, practiceId: params.practiceId, archivedAt: null },
    select: { id: true, confidentiality: true },
  });
  if (!relationship) {
    throw new CommunicationError(
      "Client relationship not found in this practice",
      "RELATIONSHIP_NOT_FOUND",
      404,
    );
  }

  const authorities = await prisma.contactAuthority.findMany({
    where: {
      contactId: { in: params.contactIds },
      clientRelationshipId: params.clientRelationshipId,
      practiceId: params.practiceId,
      revokedAt: null,
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
    },
    select: {
      contactId: true,
      authority: true,
      contact: { select: { fullName: true, email: true, emailVerificationStatus: true } },
    },
  });

  const recipients: PreviewRecipient[] = [];
  const unauthorised: string[] = [];
  const warnings: string[] = [];

  for (const contactId of params.contactIds) {
    const authority = authorities.find((a) => a.contactId === contactId);
    if (!authority) {
      unauthorised.push(contactId);
      continue;
    }
    const override = params.overrideAddresses?.[contactId];
    const onRecord = authority.contact.email;
    const address = override ?? onRecord;
    if (!address) {
      unauthorised.push(contactId);
      continue;
    }
    const changed =
      override !== undefined && override.toLowerCase() !== (onRecord ?? "").toLowerCase();

    if (!changed && authority.contact.emailVerificationStatus !== "VERIFIED") {
      warnings.push(`${authority.contact.fullName}: address on record is not verified`);
    }

    recipients.push({
      contactId,
      address,
      name: authority.contact.fullName,
      role: "TO",
      authorityBasis: `ContactAuthority:${authority.authority}`,
      wasChangedRecipient: changed,
    });
  }

  const attachedVersionIds = params.attachedVersionIds ?? [];
  const sensitive = await sensitiveAttachments(params.practiceId, attachedVersionIds);
  if (sensitive.length > 0) {
    warnings.push(
      `${sensitive.length} attachment(s) are classified above NORMAL — send a portal link instead`,
    );
  }

  const sendingPracticeName = practice.registeredDisplayName ?? practice.name;
  const fromIdentity = `${practice.documentNamespace}@practice.local`;

  const preview = {
    practiceId: params.practiceId,
    kind: params.kind,
    clientRelationshipId: params.clientRelationshipId,
    threadId: params.threadId ?? null,
    templateId: params.templateId ?? null,
    sendingPracticeName,
    fromIdentity,
    replyToIdentity: fromIdentity,
    renderedSubject: params.subject,
    renderedBody: params.body,
    recipients,
    attachedVersionIds,
    portalLinkTokenIds: params.portalLinkTokenIds ?? [],
  };

  return {
    ...preview,
    previewHash: outboundPreviewHash(preview),
    unauthorisedContactIds: unauthorised,
    sensitiveAttachmentVersionIds: sensitive,
    changedRecipients: recipients.filter((r) => r.wasChangedRecipient),
    warnings,
  };
}

/** Attached versions whose document is classified above NORMAL, or is a working paper. */
async function sensitiveAttachments(practiceId: string, versionIds: string[]): Promise<string[]> {
  if (versionIds.length === 0) return [];
  const versions = await prisma.documentVersion.findMany({
    where: { id: { in: versionIds }, practiceId },
    select: {
      id: true,
      document: { select: { classification: true, workingPaper: true } },
    },
  });
  return versions
    .filter((v) => v.document.classification !== "NORMAL" || v.document.workingPaper)
    .map((v) => v.id);
}

/**
 * COM03 verification of a changed external recipient. A separate act, by a
 * separate person: whoever proposed the new address cannot be the one who
 * confirms it, or the control is only a formality.
 */
export async function verifyRecipientAddress(params: {
  practiceId: string;
  actorUserId: string;
  verificationId: string;
  method: string;
  evidence: string;
}) {
  await assertCan(params.actorUserId, params.practiceId, "recipient.verify");

  const record = await prisma.recipientVerification.findFirst({
    where: { id: params.verificationId, practiceId: params.practiceId },
  });
  if (!record) {
    throw new CommunicationError("Verification not found", "VERIFICATION_NOT_FOUND", 404);
  }
  if (record.verifiedAt || record.refusedAt) {
    throw new CommunicationError("Verification already decided", "ALREADY_DECIDED", 409);
  }
  if (record.proposedByUserId === params.actorUserId) {
    const reason = "The user who proposed a new recipient address cannot verify it";
    await recordEvent({
      action: "RECIPIENT_VERIFICATION_REFUSED",
      targetType: "RecipientVerification",
      targetId: record.id,
      result: "FAILURE",
      actorUserId: params.actorUserId,
      practiceId: params.practiceId,
      reason,
    });
    throw new CommunicationError(reason, "SELF_VERIFICATION", 403);
  }

  const user = await prisma.user.findUnique({
    where: { id: params.actorUserId },
    select: { fullName: true },
  });

  const verified = await prisma.recipientVerification.update({
    where: { id: record.id },
    data: {
      verifiedAt: new Date(),
      verifiedByUserId: params.actorUserId,
      verifiedByName: user?.fullName ?? "Unknown user",
      verificationMethod: params.method,
      verificationEvidence: params.evidence,
    },
  });

  await recordEvent({
    action: "RECIPIENT_VERIFIED",
    targetType: "RecipientVerification",
    targetId: record.id,
    result: "SUCCESS",
    actorUserId: params.actorUserId,
    practiceId: params.practiceId,
    afterMeta: { address: verified.address, method: params.method },
  });

  return verified;
}

/**
 * COM03's subject-identity check, and the reason the acceptance evidence holds.
 *
 * A message about a record is sent from the practice that OWNS that record. The
 * caller's chosen practice is compared against the subject's, and a mismatch is
 * refused — so a staff member who belongs to both firms and has switched to
 * Associates cannot put a Company invoice in an Associates envelope.
 */
async function assertSubjectBelongsToPractice(params: {
  practiceId: string;
  actorUserId: string;
  kind: OutboundKind;
  subjectId?: string | null;
  clientRelationshipId: string;
}) {
  // A cross-practice send attempt is exactly the kind of event SEC04 exists to
  // capture, so every refusal here lands on the trail before it is thrown —
  // the attempt matters whether or not it succeeded.
  const refuse = async (message: string, code: string, status: number) => {
    await recordEvent({
      action: "OUTBOUND_SEND_REFUSED",
      targetType: "OutboundMessage",
      targetId: params.subjectId ?? params.clientRelationshipId,
      result: "FAILURE",
      actorUserId: params.actorUserId,
      practiceId: params.practiceId,
      reason: message,
      afterMeta: { kind: params.kind, code },
    });
    return new CommunicationError(message, code, status);
  };

  if (params.kind === "INVOICE") {
    if (!params.subjectId) {
      throw await refuse("An invoice message must name the invoice", "NO_SUBJECT", 400);
    }
    const invoice = await prisma.invoice.findUnique({
      where: { id: params.subjectId },
      select: { id: true, practiceId: true, clientRelationshipId: true },
    });
    if (!invoice) {
      throw await refuse("Invoice not found", "SUBJECT_NOT_FOUND", 404);
    }
    if (invoice.practiceId !== params.practiceId) {
      throw await refuse(
        "This invoice belongs to another practice and cannot be sent from this identity",
        "WRONG_PRACTICE_IDENTITY",
        403,
      );
    }
    // Same practice is not enough — the invoice must also be the one this
    // client actually owes, or a covering message could carry the wrong file.
    if (invoice.clientRelationshipId !== params.clientRelationshipId) {
      throw await refuse(
        "This invoice belongs to a different client of this practice",
        "WRONG_CLIENT",
        403,
      );
    }
  }

  if (params.kind === "DOCUMENT_RELEASE" && params.subjectId) {
    const version = await prisma.documentVersion.findUnique({
      where: { id: params.subjectId },
      select: { practiceId: true },
    });
    if (!version) {
      throw await refuse("Document version not found", "SUBJECT_NOT_FOUND", 404);
    }
    if (version.practiceId !== params.practiceId) {
      throw await refuse(
        "This document belongs to another practice and cannot be sent from this identity",
        "WRONG_PRACTICE_IDENTITY",
        403,
      );
    }
  }
}

export type SendResult = {
  message: Awaited<ReturnType<typeof prisma.outboundMessage.create>>;
  duplicateOf: string | null;
};

/**
 * Send. Refuses on every one of COM03's safeguards, and writes exactly one
 * logical message per COM04 dedup key.
 */
export async function sendOutbound(params: {
  practiceId: string;
  actorUserId: string;
  kind: OutboundKind;
  clientRelationshipId: string;
  subjectId?: string | null;
  threadId?: string | null;
  templateId?: string | null;
  subject: string;
  body: string;
  contactIds: string[];
  overrideAddresses?: Record<string, string>;
  attachedVersionIds?: string[];
  portalLinkTokenIds?: string[];
  /** The hash the user confirmed on the preview screen. */
  confirmedPreviewHash: string;
  dedupKey: string;
  scheduledFor?: Date | null;
}): Promise<SendResult> {
  const membership = await assertCan(params.actorUserId, params.practiceId, "message.send_client");

  await assertSubjectBelongsToPractice({
    practiceId: params.practiceId,
    actorUserId: params.actorUserId,
    kind: params.kind,
    subjectId: params.subjectId,
    clientRelationshipId: params.clientRelationshipId,
  });

  const preview = await buildOutboundPreview({
    practiceId: params.practiceId,
    actorUserId: params.actorUserId,
    kind: params.kind,
    clientRelationshipId: params.clientRelationshipId,
    threadId: params.threadId,
    subject: params.subject,
    body: params.body,
    templateId: params.templateId,
    contactIds: params.contactIds,
    overrideAddresses: params.overrideAddresses,
    attachedVersionIds: params.attachedVersionIds,
    portalLinkTokenIds: params.portalLinkTokenIds,
  });

  const refuse = async (message: string, code: string, status = 409) => {
    await recordEvent({
      action: "OUTBOUND_SEND_REFUSED",
      targetType: "OutboundMessage",
      targetId: params.dedupKey,
      result: "FAILURE",
      actorUserId: params.actorUserId,
      practiceId: params.practiceId,
      reason: message,
      afterMeta: { kind: params.kind, code },
    });
    return new CommunicationError(message, code, status);
  };

  // What was confirmed must be what goes out.
  if (preview.previewHash !== params.confirmedPreviewHash) {
    throw await refuse(
      "The message changed after it was reviewed; re-confirm the preview before sending",
      "PREVIEW_MISMATCH",
    );
  }

  if (preview.recipients.length === 0) {
    throw await refuse("No authorised recipient", "NO_RECIPIENTS", 400);
  }
  if (preview.unauthorisedContactIds.length > 0) {
    throw await refuse(
      `${preview.unauthorisedContactIds.length} recipient(s) hold no live authority for this client`,
      "RECIPIENT_NOT_AUTHORISED",
      403,
    );
  }

  // A changed external address must have cleared its own verification.
  for (const recipient of preview.changedRecipients) {
    const verification = await prisma.recipientVerification.findFirst({
      where: {
        practiceId: params.practiceId,
        contactId: recipient.contactId,
        address: recipient.address,
        verifiedAt: { not: null },
        refusedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { id: true },
    });
    if (!verification) {
      throw await refuse(
        `Recipient address ${recipient.address} differs from the record and has not been separately verified`,
        "RECIPIENT_UNVERIFIED",
        403,
      );
    }
  }

  // COM03: "Default to secure portal links instead of sensitive email
  // attachments." Sensitive material may still go out — but as a revocable
  // portal link, not as a copy the firm can never recall.
  if (preview.sensitiveAttachmentVersionIds.length > 0) {
    throw await refuse(
      "Attachments classified above NORMAL must be sent as portal links, not email attachments",
      "SENSITIVE_ATTACHMENT",
      403,
    );
  }

  const scheduled = await resolveSchedule({
    practiceId: params.practiceId,
    kind: params.kind,
    contactIds: preview.recipients.map((r) => r.contactId).filter((c): c is string => !!c),
    now: params.scheduledFor ?? new Date(),
  });

  try {
    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.outboundMessage.create({
        data: {
          practiceId: params.practiceId,
          threadId: params.threadId ?? null,
          clientRelationshipId: params.clientRelationshipId,
          kind: params.kind,
          sendingPracticeName: preview.sendingPracticeName,
          fromIdentity: preview.fromIdentity,
          replyToIdentity: preview.replyToIdentity,
          templateId: params.templateId ?? null,
          renderedSubject: preview.renderedSubject,
          renderedBody: preview.renderedBody,
          attachedVersionIds: preview.attachedVersionIds,
          portalLinkTokenIds: preview.portalLinkTokenIds,
          previewHash: preview.previewHash,
          previewConfirmedAt: new Date(),
          previewConfirmedByUserId: params.actorUserId,
          dedupKey: params.dedupKey,
          state: scheduled.state,
          stateDetail: scheduled.detail,
          scheduledFor: scheduled.scheduledFor,
          requestedByUserId: params.actorUserId,
        },
      });

      await tx.outboundRecipient.createMany({
        data: preview.recipients.map((r) => ({
          practiceId: params.practiceId,
          messageId: created.id,
          contactId: r.contactId,
          address: r.address,
          name: r.name,
          role: r.role,
          authorityBasis: r.authorityBasis,
          wasChangedRecipient: r.wasChangedRecipient,
        })),
      });

      return created;
    });

    await recordEvent({
      action: "OUTBOUND_QUEUED",
      targetType: "OutboundMessage",
      targetId: message.id,
      result: "SUCCESS",
      actorUserId: params.actorUserId,
      practiceId: params.practiceId,
      afterMeta: {
        kind: params.kind,
        sendingPracticeName: preview.sendingPracticeName,
        recipientCount: preview.recipients.length,
        state: message.state,
        role: membership.role,
      },
    });

    return { message, duplicateOf: null };
  } catch (error) {
    // COM04: the unique dedup key is what makes "two workers, one message"
    // true. The loser of the race returns the winner's row rather than
    // creating a second — and never reports a failure the caller might retry.
    if (isUniqueViolation(error)) {
      const existing = await prisma.outboundMessage.findUnique({
        where: { dedupKey: params.dedupKey },
      });
      if (existing) return { message: existing, duplicateOf: existing.id };
    }
    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "P2002"
  );
}

// ===========================================================================
// COM04 — Reminder engine
// ===========================================================================

/**
 * The duplicate key. Deliberately built from the EVENT and the RECIPIENT SET,
 * not from a timestamp or a worker id: two workers processing the same due
 * obligation must compute the identical string, or the unique constraint
 * protects nothing.
 */
export function buildReminderDedupKey(spec: {
  practiceId: string;
  kind: OutboundKind;
  subjectId: string;
  /** The occurrence being reminded about — a date, a period, an escalation level. */
  occurrence: string;
  recipientIds: string[];
}): string {
  return [
    spec.practiceId,
    spec.kind,
    spec.subjectId,
    spec.occurrence,
    spec.recipientIds.slice().sort().join("+"),
  ].join("|");
}

/** Minutes past local midnight, in the preference's timezone. */
function localMinuteOfDay(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

/** Quiet hours may wrap past midnight (22:00 -> 08:00), so both cases are explicit. */
export function inQuietHours(minute: number, from: number, to: number): boolean {
  return from <= to ? minute >= from && minute < to : minute >= from || minute < to;
}

function nextTimeAtLocalMinute(from: Date, targetMinute: number, timeZone: string): Date {
  // Walk forward in 15-minute steps to the first slot at or after the target.
  // Crude, but it is correct across DST boundaries precisely because it asks
  // Intl what the local time is rather than doing arithmetic on the offset.
  const step = 15 * 60 * 1000;
  let cursor = new Date(from.getTime());
  for (let i = 0; i < 4 * 24 * 2; i++) {
    cursor = new Date(cursor.getTime() + step);
    const minute = localMinuteOfDay(cursor, timeZone);
    if (minute >= targetMinute && minute < targetMinute + 15) return cursor;
  }
  return new Date(from.getTime() + 8 * 60 * 60 * 1000);
}

export type Schedule = {
  state: OutboundState;
  scheduledFor: Date | null;
  detail: string | null;
  digestMode: DigestMode;
};

/**
 * COM04 quiet hours and digest options. A recipient's preference defers a
 * message; it never silently drops one, and a kind the practice has explicitly
 * exempted (a statutory deadline, typically) passes through.
 */
export async function resolveSchedule(params: {
  practiceId: string;
  kind: OutboundKind;
  contactIds: string[];
  now?: Date;
}): Promise<Schedule> {
  const now = params.now ?? new Date();

  if (params.contactIds.length === 0) {
    return { state: "QUEUED", scheduledFor: now, detail: null, digestMode: "IMMEDIATE" };
  }

  const prefs = await prisma.notificationPreference.findMany({
    where: { practiceId: params.practiceId, contactId: { in: params.contactIds } },
  });
  if (prefs.length === 0) {
    return { state: "QUEUED", scheduledFor: now, detail: null, digestMode: "IMMEDIATE" };
  }

  // With several recipients, the most restrictive preference wins — it is the
  // one that would otherwise be violated.
  for (const pref of prefs) {
    if (pref.suppressedUntil && pref.suppressedUntil > now) {
      return {
        state: "SUPPRESSED",
        scheduledFor: pref.suppressedUntil,
        detail: `Recipient suppressed until ${pref.suppressedUntil.toISOString()}`,
        digestMode: pref.digestMode,
      };
    }
  }

  for (const pref of prefs) {
    if (pref.quietFromMinute === null || pref.quietToMinute === null) continue;
    if (pref.quietHoursOverrideKinds.includes(params.kind)) continue;

    const minute = localMinuteOfDay(now, pref.timeZone);
    if (inQuietHours(minute, pref.quietFromMinute, pref.quietToMinute)) {
      return {
        state: "HELD_QUIET_HOURS",
        scheduledFor: nextTimeAtLocalMinute(now, pref.quietToMinute, pref.timeZone),
        detail: "Held for recipient quiet hours",
        digestMode: pref.digestMode,
      };
    }
  }

  const digestMode = prefs.find((p) => p.digestMode !== "IMMEDIATE")?.digestMode ?? "IMMEDIATE";
  return { state: "QUEUED", scheduledFor: now, detail: null, digestMode };
}

/**
 * COM04: the provider took the message. That is ACCEPTANCE and nothing more —
 * it is not proof of delivery, of reading, or of filing, so it never sets
 * deliveredAt.
 */
export async function recordProviderAcceptance(params: {
  practiceId: string;
  messageId: string;
  providerReference: string;
}) {
  const message = await loadSendable(params.practiceId, params.messageId);

  const attemptNo = message.attemptCount + 1;
  const [updated] = await prisma.$transaction([
    prisma.outboundMessage.update({
      where: { id: params.messageId },
      data: {
        state: "SUBMITTED",
        submittedAt: new Date(),
        attemptCount: attemptNo,
        stateDetail: "Accepted by provider — not proof of delivery or reading",
      },
    }),
    prisma.deliveryAttempt.create({
      data: {
        practiceId: params.practiceId,
        messageId: params.messageId,
        attemptNo,
        state: "SUBMITTED",
        providerReference: params.providerReference,
      },
    }),
  ]);
  return updated;
}

/** Only an explicit delivery confirmation from the channel sets DELIVERED. */
export async function recordDeliveryConfirmation(params: {
  practiceId: string;
  messageId: string;
  providerReference?: string;
}) {
  const message = await loadSendable(params.practiceId, params.messageId);
  if (message.state !== "SUBMITTED") {
    throw new CommunicationError(
      "Only a submitted message can be confirmed delivered",
      "NOT_SUBMITTED",
    );
  }

  const [updated] = await prisma.$transaction([
    prisma.outboundMessage.update({
      where: { id: params.messageId },
      data: { state: "DELIVERED", deliveredAt: new Date(), stateDetail: null },
    }),
    prisma.deliveryAttempt.create({
      data: {
        practiceId: params.practiceId,
        messageId: params.messageId,
        attemptNo: message.attemptCount + 1,
        state: "DELIVERED",
        providerReference: params.providerReference ?? null,
      },
    }),
  ]);
  return updated;
}

/**
 * A failed attempt. Retries up to maxAttempts, then FAILED.
 *
 * A bounce is terminal on the first occurrence: retrying a hard bounce is not
 * persistence, it is noise, and the address needs a human. Marking the channel
 * unverified is the point — the next send has to face the question.
 */
export async function recordFailure(params: {
  practiceId: string;
  messageId: string;
  detail: string;
  isBounce?: boolean;
  bounceKind?: string;
}) {
  const message = await loadSendable(params.practiceId, params.messageId);
  const attemptNo = message.attemptCount + 1;
  const bounce = params.isBounce ?? false;
  const exhausted = attemptNo >= message.maxAttempts;

  const state: OutboundState = bounce || exhausted ? "FAILED" : "QUEUED";

  const [updated] = await prisma.$transaction([
    prisma.outboundMessage.update({
      where: { id: params.messageId },
      data: { state, attemptCount: attemptNo, stateDetail: params.detail },
    }),
    prisma.deliveryAttempt.create({
      data: {
        practiceId: params.practiceId,
        messageId: params.messageId,
        attemptNo,
        state: bounce || exhausted ? "FAILED" : "QUEUED",
        detail: params.detail,
        isBounce: bounce,
        bounceKind: params.bounceKind ?? null,
      },
    }),
  ]);

  if (bounce) {
    // The address stops being a verified channel the moment it bounces.
    const recipients = await prisma.outboundRecipient.findMany({
      where: { messageId: params.messageId, practiceId: params.practiceId },
      select: { contactId: true },
    });
    const contactIds = recipients.map((r) => r.contactId).filter((c): c is string => !!c);
    if (contactIds.length > 0) {
      await prisma.contact.updateMany({
        where: { id: { in: contactIds } },
        data: { emailVerificationStatus: "UNVERIFIED" },
      });
    }
    await recordEvent({
      action: "OUTBOUND_BOUNCED",
      targetType: "OutboundMessage",
      targetId: params.messageId,
      result: "FAILURE",
      practiceId: params.practiceId,
      reason: params.detail,
      afterMeta: { bounceKind: params.bounceKind ?? null, provesReceipt: false },
    });
  }

  return updated;
}

/**
 * The channel gave no answer. This is its own state, not an optimistic
 * DELIVERED and not a pessimistic FAILED — recording the uncertainty is the
 * only honest option, and it is what stops a silent send being read later as a
 * delivered one.
 */
export async function recordDeliveryUncertain(params: {
  practiceId: string;
  messageId: string;
  detail: string;
}) {
  const message = await loadSendable(params.practiceId, params.messageId);
  const attemptNo = message.attemptCount + 1;

  const [updated] = await prisma.$transaction([
    prisma.outboundMessage.update({
      where: { id: params.messageId },
      data: { state: "DELIVERY_UNCERTAIN", attemptCount: attemptNo, stateDetail: params.detail },
    }),
    prisma.deliveryAttempt.create({
      data: {
        practiceId: params.practiceId,
        messageId: params.messageId,
        attemptNo,
        state: "DELIVERY_UNCERTAIN",
        detail: params.detail,
      },
    }),
  ]);
  return updated;
}

/**
 * What a delivery record actually proves. Every caller that wants to claim the
 * client "was told" should read this rather than the state directly — the
 * distinction between acceptance, delivery and receipt is exactly what COM04
 * exists to keep visible.
 */
export async function deliveryEvidence(practiceId: string, messageId: string) {
  const message = await prisma.outboundMessage.findFirst({
    where: { id: messageId, practiceId },
    select: { state: true, submittedAt: true, deliveredAt: true },
  });
  if (!message) {
    throw new CommunicationError("Message not found", "MESSAGE_NOT_FOUND", 404);
  }
  const bounced = await prisma.deliveryAttempt.count({
    where: { messageId, practiceId, isBounce: true },
  });

  return {
    state: message.state,
    acceptedByProvider: message.submittedAt !== null,
    confirmedDeliveredByChannel: message.deliveredAt !== null,
    bounced: bounced > 0,
    // None of the above is a person confirming they read it. There is no
    // field here that could be mistaken for one.
    provesReceiptByRecipient: false,
    provesReading: false,
    provesFiling: false,
  };
}

async function loadSendable(practiceId: string, messageId: string) {
  const message = await prisma.outboundMessage.findFirst({
    where: { id: messageId, practiceId },
    select: { id: true, state: true, attemptCount: true, maxAttempts: true },
  });
  if (!message) {
    throw new CommunicationError("Message not found", "MESSAGE_NOT_FOUND", 404);
  }
  if (message.state === "DELIVERED") {
    throw new CommunicationError("Message is already delivered", "ALREADY_DELIVERED");
  }
  return message;
}

/**
 * Collapse a recipient's pending messages into one digest, per their
 * preference. The originals are marked SUPPRESSED with a pointer to the digest
 * — they are not deleted, so the record still shows what was owed and when.
 */
export async function buildDigest(params: {
  practiceId: string;
  contactId: string;
  now?: Date;
}) {
  const now = params.now ?? new Date();

  const pending = await prisma.outboundMessage.findMany({
    where: {
      practiceId: params.practiceId,
      state: { in: ["QUEUED", "HELD_QUIET_HOURS"] },
      kind: { not: "DIGEST" },
      recipients: { some: { contactId: params.contactId } },
    },
    orderBy: { createdAt: "asc" },
    include: { recipients: true },
  });
  if (pending.length < 2) return null;

  const first = pending[0];
  const dedupKey = buildReminderDedupKey({
    practiceId: params.practiceId,
    kind: "DIGEST",
    subjectId: params.contactId,
    occurrence: now.toISOString().slice(0, 10),
    recipientIds: [params.contactId],
  });

  const body = pending.map((m, i) => `${i + 1}. ${m.renderedSubject}`).join("\n");
  const recipient = first.recipients.find((r) => r.contactId === params.contactId)!;

  const previewInput = {
    practiceId: params.practiceId,
    sendingPracticeName: first.sendingPracticeName,
    fromIdentity: first.fromIdentity,
    replyToIdentity: first.replyToIdentity,
    renderedSubject: `${pending.length} outstanding items`,
    renderedBody: body,
    recipients: [{ address: recipient.address }],
    attachedVersionIds: [],
  };

  const digest = await prisma.outboundMessage.create({
    data: {
      practiceId: params.practiceId,
      clientRelationshipId: first.clientRelationshipId,
      kind: "DIGEST",
      sendingPracticeName: first.sendingPracticeName,
      fromIdentity: first.fromIdentity,
      replyToIdentity: first.replyToIdentity,
      renderedSubject: previewInput.renderedSubject,
      renderedBody: body,
      previewHash: outboundPreviewHash(previewInput),
      dedupKey,
      state: "QUEUED",
      scheduledFor: now,
    },
  });

  await prisma.outboundRecipient.create({
    data: {
      practiceId: params.practiceId,
      messageId: digest.id,
      contactId: params.contactId,
      address: recipient.address,
      name: recipient.name,
      role: "TO",
      authorityBasis: recipient.authorityBasis,
    },
  });

  await prisma.outboundMessage.updateMany({
    where: { id: { in: pending.map((m) => m.id) } },
    data: { state: "SUPPRESSED", stateDetail: `Folded into digest ${digest.id}` },
  });

  return digest;
}
