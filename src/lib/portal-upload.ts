/**
 * Portal upload — POR03 (PRD §17).
 *
 * The acceptance evidence is one sentence: "Interrupted upload resumes without
 * duplicate originals." Everything in this file exists to make that true under
 * the three ways a real client actually interrupts an upload:
 *
 *   1. The connection drops mid-transfer and the browser retries the parts it
 *      never got an acknowledgement for. Handled by
 *      `PortalUploadPart @@unique([uploadId, partNumber])` — a part that
 *      arrives twice updates one row and overwrites one object.
 *   2. The tab is closed and reopened, losing the upload id. Handled by
 *      `findResumable`, which recognises the same file arriving for the same
 *      item and hands back the upload already in progress instead of starting
 *      a second one.
 *   3. The client gives up and re-sends the whole file later. Handled by
 *      content addressing: identical bytes land on the same object key, and
 *      `completeUpload` recognises the digest is already filed for this item
 *      and records a dedup rather than creating a second version.
 *
 * A receipt from this module confirms INTAKE ONLY. POR03 is explicit that it
 * is "not correctness or completion of the audit", so nothing here moves an
 * item to ACCEPTED — that stays a staff decision.
 */

import { prisma } from "@/lib/prisma";
import { recordEvent } from "@/lib/audit";
import { assertPortalAccess, PortalAuthError } from "@/lib/portal-auth";
import {
  MAX_UPLOAD_BYTES,
  PERMITTED_MIME_TYPES,
  receiveUpload,
  IntakeError,
} from "@/lib/document-intake";
import { fileUpload } from "@/lib/documents";
import {
  deleteObject,
  getObject,
  portalUploadPartKey,
  putObject,
  sha256Hex,
} from "@/lib/object-store";

export class PortalUploadError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "PortalUploadError";
    this.code = code;
    this.status = status;
  }
}

/** An unfinished upload is not kept forever; staging bytes are not documents. */
export const UPLOAD_TTL_MS = 24 * 3600_000;

/** Large enough to be efficient, small enough that a retry is cheap on a phone. */
export const MAX_PART_BYTES = 5 * 1024 * 1024;

// ---------------------------------------------------------------- begin

export type BeginUploadResult = {
  uploadId: string;
  resumed: boolean;
  receivedBytes: number;
  expectedBytes: number;
  /** Parts already held, so a resuming client sends only what is missing. */
  receivedParts: number[];
  maxPartBytes: number;
  expiresAt: Date;
};

/**
 * Declare an upload before any bytes move.
 *
 * The resume identity has to be established here, not inferred later: a client
 * that reconnects must be able to ask "have you already got some of this?" and
 * get a truthful answer, and that is only possible if the file was named up
 * front.
 */
export async function beginPortalUpload(params: {
  contactId: string;
  practiceId: string;
  clientRelationshipId: string;
  itemId?: string | null;
  filename: string;
  declaredMimeType: string;
  expectedBytes: number;
  /** Optional but strongly preferred — it is what proves the assembly intact. */
  expectedSha256?: string | null;
  sessionId?: string | null;
  now?: Date;
}): Promise<BeginUploadResult> {
  const now = params.now ?? new Date();

  // POR02/IAM01: the contact must hold a live UPLOAD-class authority for THIS
  // relationship. A 404 is thrown for anything else, so an entity the contact
  // may not act for is not confirmed to exist.
  await assertPortalAccess({
    contactId: params.contactId,
    practiceId: params.practiceId,
    clientRelationshipId: params.clientRelationshipId,
    requires: ["UPLOAD", "APPROVE", "SIGNATORY"],
    now,
  });

  if (!Number.isInteger(params.expectedBytes) || params.expectedBytes <= 0) {
    throw new PortalUploadError("Tell us the file size before uploading.", "BAD_SIZE");
  }
  if (params.expectedBytes > MAX_UPLOAD_BYTES) {
    throw new PortalUploadError(
      `That file is larger than the ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))} MB limit. ` +
        "Send it in parts, or ask the team for another route.",
      "FILE_TOO_LARGE",
      413,
    );
  }
  if (!(PERMITTED_MIME_TYPES as readonly string[]).includes(params.declaredMimeType)) {
    throw new PortalUploadError(
      "We can't accept that file type. PDF, images, Office documents, CSV and text are fine.",
      "MIME_NOT_PERMITTED",
      415,
    );
  }
  if (params.expectedSha256 && !/^[0-9a-f]{64}$/.test(params.expectedSha256)) {
    throw new PortalUploadError("Invalid checksum.", "BAD_DIGEST");
  }

  // The item, if named, must belong to the same practice AND the same
  // relationship. Without the second check a contact could attach a file to
  // another client's request item using an id they guessed.
  if (params.itemId) {
    const item = await prisma.clientRequestItem.findFirst({
      where: {
        id: params.itemId,
        practiceId: params.practiceId,
        request: { clientRelationshipId: params.clientRelationshipId },
      },
      select: { id: true },
    });
    if (!item) throw new PortalUploadError("Not found", "ITEM_NOT_FOUND", 404);
  }

  const existing = await findResumable({ ...params, now });
  if (existing) {
    const parts = await prisma.portalUploadPart.findMany({
      where: { uploadId: existing.id },
      select: { partNumber: true },
      orderBy: { partNumber: "asc" },
    });
    return {
      uploadId: existing.id,
      resumed: true,
      receivedBytes: existing.receivedBytes,
      expectedBytes: existing.expectedBytes,
      receivedParts: parts.map((p) => p.partNumber),
      maxPartBytes: MAX_PART_BYTES,
      expiresAt: existing.expiresAt,
    };
  }

  const upload = await prisma.portalUpload.create({
    data: {
      practiceId: params.practiceId,
      clientRelationshipId: params.clientRelationshipId,
      contactId: params.contactId,
      sessionId: params.sessionId ?? null,
      itemId: params.itemId ?? null,
      filename: params.filename,
      declaredMimeType: params.declaredMimeType,
      expectedBytes: params.expectedBytes,
      expectedSha256: params.expectedSha256 ?? null,
      expiresAt: new Date(now.getTime() + UPLOAD_TTL_MS),
    },
  });

  return {
    uploadId: upload.id,
    resumed: false,
    receivedBytes: 0,
    expectedBytes: upload.expectedBytes,
    receivedParts: [],
    maxPartBytes: MAX_PART_BYTES,
    expiresAt: upload.expiresAt,
  };
}

/**
 * Interruption case 2: the client lost its upload id.
 *
 * Matching is on what a client can honestly re-declare about the same file —
 * the same contact, entity, item, filename and exact size — plus the digest
 * when one was given. A different file cannot match, because a different file
 * has a different size or a different digest; and when the digest is present it
 * is decisive on its own.
 */
async function findResumable(params: {
  contactId: string;
  practiceId: string;
  clientRelationshipId: string;
  itemId?: string | null;
  filename: string;
  expectedBytes: number;
  expectedSha256?: string | null;
  now: Date;
}) {
  return prisma.portalUpload.findFirst({
    where: {
      practiceId: params.practiceId,
      clientRelationshipId: params.clientRelationshipId,
      contactId: params.contactId,
      itemId: params.itemId ?? null,
      filename: params.filename,
      expectedBytes: params.expectedBytes,
      ...(params.expectedSha256 ? { expectedSha256: params.expectedSha256 } : {}),
      state: "IN_PROGRESS",
      expiresAt: { gt: params.now },
    },
    orderBy: { createdAt: "desc" },
  });
}

// ---------------------------------------------------------------- append

export type UploadStatus = {
  uploadId: string;
  state: "IN_PROGRESS" | "COMPLETED" | "ABANDONED";
  receivedBytes: number;
  expectedBytes: number;
  receivedParts: number[];
  complete: boolean;
};

/**
 * Store one part. Idempotent by (uploadId, partNumber): a part that arrives
 * twice replaces itself, and `receivedBytes` is recomputed from the parts that
 * actually exist rather than being incremented — an increment would double-count
 * exactly the retry this endpoint is built to absorb.
 */
export async function appendPortalUploadPart(params: {
  uploadId: string;
  contactId: string;
  partNumber: number;
  body: Buffer;
  now?: Date;
}): Promise<UploadStatus> {
  const now = params.now ?? new Date();
  const upload = await requireOwnUpload(params.uploadId, params.contactId, now);

  if (upload.state !== "IN_PROGRESS") {
    throw new PortalUploadError(
      "This upload is already finished. Start a new one to send another file.",
      "UPLOAD_NOT_IN_PROGRESS",
      409,
    );
  }
  if (!Number.isInteger(params.partNumber) || params.partNumber < 0) {
    throw new PortalUploadError("Invalid part number.", "BAD_PART_NUMBER");
  }
  if (params.body.byteLength === 0) {
    throw new PortalUploadError("That part was empty.", "EMPTY_PART");
  }
  if (params.body.byteLength > MAX_PART_BYTES) {
    throw new PortalUploadError(
      `Each part must be ${Math.floor(MAX_PART_BYTES / (1024 * 1024))} MB or smaller.`,
      "PART_TOO_LARGE",
      413,
    );
  }

  const practice = await prisma.practice.findUniqueOrThrow({
    where: { id: upload.practiceId },
    select: { documentNamespace: true },
  });

  const key = portalUploadPartKey(practice.documentNamespace, upload.id, params.partNumber);
  const digest = sha256Hex(params.body);

  // Bytes first, row second: a recorded part whose object is missing would
  // break assembly, whereas an object with no row is simply overwritten or
  // expires unread.
  await putObject({ key, body: params.body, contentType: "application/octet-stream" });

  await prisma.portalUploadPart.upsert({
    where: { uploadId_partNumber: { uploadId: upload.id, partNumber: params.partNumber } },
    create: {
      uploadId: upload.id,
      partNumber: params.partNumber,
      sizeBytes: params.body.byteLength,
      sha256: digest,
      objectKey: key,
    },
    update: { sizeBytes: params.body.byteLength, sha256: digest, objectKey: key },
  });

  const parts = await prisma.portalUploadPart.findMany({
    where: { uploadId: upload.id },
    select: { partNumber: true, sizeBytes: true },
    orderBy: { partNumber: "asc" },
  });
  const receivedBytes = parts.reduce((sum, p) => sum + p.sizeBytes, 0);

  if (receivedBytes > upload.expectedBytes) {
    throw new PortalUploadError(
      "That's more data than the file was declared to hold. Start the upload again.",
      "OVERSIZE",
      409,
    );
  }

  await prisma.portalUpload.update({
    where: { id: upload.id },
    data: { receivedBytes },
  });

  return {
    uploadId: upload.id,
    state: "IN_PROGRESS",
    receivedBytes,
    expectedBytes: upload.expectedBytes,
    receivedParts: parts.map((p) => p.partNumber),
    complete: receivedBytes === upload.expectedBytes,
  };
}

/** What a resuming client asks for before sending anything. */
export async function getPortalUploadStatus(params: {
  uploadId: string;
  contactId: string;
  now?: Date;
}): Promise<UploadStatus> {
  const now = params.now ?? new Date();
  const upload = await requireOwnUpload(params.uploadId, params.contactId, now, {
    allowFinished: true,
  });

  const parts = await prisma.portalUploadPart.findMany({
    where: { uploadId: upload.id },
    select: { partNumber: true },
    orderBy: { partNumber: "asc" },
  });

  return {
    uploadId: upload.id,
    state: upload.state,
    receivedBytes: upload.receivedBytes,
    expectedBytes: upload.expectedBytes,
    receivedParts: parts.map((p) => p.partNumber),
    complete: upload.receivedBytes === upload.expectedBytes,
  };
}

// -------------------------------------------------------------- complete

export type PortalReceipt = {
  uploadId: string;
  /** POR03: intake only. Never a statement about correctness or completion. */
  receiptMessage: string;
  documentVersionId: string;
  versionNo: number;
  sha256: string;
  /** True when identical content was already filed for this item. */
  duplicateOfExisting: boolean;
  itemStatus: string | null;
};

/**
 * Assemble, verify, and file once.
 *
 * The verification order matters: size, then digest, then DOC01 intake. A file
 * that fails any of them is not filed at all — DOC01 fails closed, and a
 * half-assembled document with a client receipt against it would be worse than
 * no upload.
 */
export async function completePortalUpload(params: {
  uploadId: string;
  contactId: string;
  now?: Date;
}): Promise<PortalReceipt> {
  const now = params.now ?? new Date();
  const upload = await requireOwnUpload(params.uploadId, params.contactId, now);

  if (upload.state === "COMPLETED") {
    // Completing twice is a retry, not an error, and must not file a second
    // version. The original receipt is returned.
    return existingReceipt(upload.id);
  }
  if (upload.state !== "IN_PROGRESS") {
    throw new PortalUploadError("This upload was cancelled.", "UPLOAD_ABANDONED", 409);
  }

  const parts = await prisma.portalUploadPart.findMany({
    where: { uploadId: upload.id },
    orderBy: { partNumber: "asc" },
  });
  if (parts.length === 0) {
    throw new PortalUploadError("No file data was received.", "NO_PARTS");
  }

  const buffers: Buffer[] = [];
  for (const part of parts) {
    const body = await getObject(part.objectKey);
    if (!body) {
      throw new PortalUploadError(
        "Part of that file is missing. Please upload it again.",
        "PART_MISSING",
        409,
      );
    }
    // Each part is re-verified against the digest recorded when it arrived, so
    // a corrupted or substituted staging object cannot be assembled into a
    // document that then carries a clean hash.
    if (sha256Hex(body) !== part.sha256) {
      throw new PortalUploadError(
        "Part of that file did not survive the transfer. Please upload it again.",
        "PART_CORRUPT",
        409,
      );
    }
    buffers.push(body);
  }

  const assembled = Buffer.concat(buffers);

  if (assembled.byteLength !== upload.expectedBytes) {
    throw new PortalUploadError(
      "The upload is incomplete. Please resume it and send the missing parts.",
      "INCOMPLETE",
      409,
    );
  }

  const digest = sha256Hex(assembled);
  if (upload.expectedSha256 && digest !== upload.expectedSha256) {
    throw new PortalUploadError(
      "That file did not arrive intact. Please upload it again.",
      "DIGEST_MISMATCH",
      409,
    );
  }

  // Interruption case 3: the same bytes have already been filed for this item.
  // Nothing new is created — the existing version IS the original, and a second
  // one would be the duplicate the acceptance evidence forbids.
  const alreadyFiled = await findFiledVersion({
    practiceId: upload.practiceId,
    clientRelationshipId: upload.clientRelationshipId,
    sha256: digest,
  });

  if (alreadyFiled) {
    await prisma.portalUpload.update({
      where: { id: upload.id },
      data: {
        state: "COMPLETED",
        completedAt: now,
        documentVersionId: alreadyFiled.id,
        deduplicatedFromVersionId: alreadyFiled.id,
        receivedBytes: assembled.byteLength,
      },
    });
    await discardParts(parts);

    await recordEvent({
      action: "PORTAL_UPLOAD_DEDUPLICATED",
      targetType: "PortalUpload",
      targetId: upload.id,
      result: "SUCCESS",
      practiceId: upload.practiceId,
      afterMeta: {
        contactId: upload.contactId,
        sha256: digest,
        existingVersionId: alreadyFiled.id,
        filename: upload.filename,
      },
    });

    const itemStatus = upload.itemId ? await recordItemResponse(upload, alreadyFiled.id, now) : null;

    return {
      uploadId: upload.id,
      receiptMessage: RECEIPT_MESSAGE,
      documentVersionId: alreadyFiled.id,
      versionNo: alreadyFiled.versionNo,
      sha256: digest,
      duplicateOfExisting: true,
      itemStatus,
    };
  }

  // DOC01 in full — type sniffing, archive checks, malware scan, quarantine on
  // failure. The portal gets no shortcut through it.
  let receipt;
  try {
    receipt = await receiveUpload({
      ctx: {
        actorUserId: null,
        uploadedByContactId: upload.contactId,
        practiceId: upload.practiceId,
        clientRelationshipId: upload.clientRelationshipId,
        clientRequestId: null,
        source: "PORTAL_UPLOAD",
      },
      body: assembled,
      filename: upload.filename,
      declaredMimeType: upload.declaredMimeType,
    });
  } catch (e) {
    if (e instanceof IntakeError) {
      await abandon(upload.id, `Intake refused: ${e.code}`, now);
      throw new PortalUploadError(
        "We couldn't accept that file. Please check it opens correctly and try again, " +
          "or contact the team.",
        "INTAKE_REFUSED",
        422,
      );
    }
    throw e;
  }

  if (receipt.outcome !== "ACCEPTED") {
    await abandon(upload.id, `Intake outcome ${receipt.outcome}: ${receipt.reason}`, now);
    // The client is told it was not accepted, and nothing about why in detail —
    // a quarantine reason describes our scanning, not their file.
    throw new PortalUploadError(
      "We couldn't accept that file. Please contact the team and we'll help.",
      "INTAKE_NOT_ACCEPTED",
      422,
    );
  }

  const { version } = await fileUpload({
    actorUserId: null,
    portalContact: {
      contactId: upload.contactId,
      clientRelationshipId: upload.clientRelationshipId,
    },
    practiceId: upload.practiceId,
    receipt,
    filename: upload.filename,
    clientRelationshipId: upload.clientRelationshipId,
    // DOC04: a client's own upload is client-supplied material, never a
    // working paper, and never an internal record by default.
    kind: "CLIENT_SUPPLIED",
    workingPaper: false,
  });

  await prisma.portalUpload.update({
    where: { id: upload.id },
    data: {
      state: "COMPLETED",
      completedAt: now,
      intakeId: receipt.intakeId,
      documentVersionId: version.id,
      receivedBytes: assembled.byteLength,
    },
  });
  await discardParts(parts);

  await recordEvent({
    action: "PORTAL_UPLOAD_COMPLETED",
    targetType: "PortalUpload",
    targetId: upload.id,
    result: "SUCCESS",
    practiceId: upload.practiceId,
    afterMeta: {
      contactId: upload.contactId,
      filename: upload.filename,
      sha256: digest,
      documentVersionId: version.id,
      itemId: upload.itemId,
    },
  });

  const itemStatus = upload.itemId ? await recordItemResponse(upload, version.id, now) : null;

  return {
    uploadId: upload.id,
    receiptMessage: RECEIPT_MESSAGE,
    documentVersionId: version.id,
    versionNo: version.versionNo,
    sha256: digest,
    duplicateOfExisting: false,
    itemStatus,
  };
}

/**
 * POR03, verbatim: "The receipt confirms intake only, not correctness or
 * completion of the audit." Kept as one constant so no screen can soften it
 * into something that sounds like acceptance.
 */
export const RECEIPT_MESSAGE =
  "Received. This confirms we have your file — it doesn't mean it has been " +
  "reviewed or that the work is complete. The team will check it and tell you " +
  "if anything needs correcting.";

// ----------------------------------------------------------------- helpers

async function requireOwnUpload(
  uploadId: string,
  contactId: string,
  now: Date,
  opts: { allowFinished?: boolean } = {},
) {
  const upload = await prisma.portalUpload.findUnique({ where: { id: uploadId } });

  // Someone else's upload and a non-existent upload are the same answer.
  if (!upload || upload.contactId !== contactId) {
    throw new PortalUploadError("Not found", "UPLOAD_NOT_FOUND", 404);
  }

  // Authority is re-checked here, not trusted from `begin`: a grant can be
  // revoked between starting an upload and finishing it.
  await assertPortalAccess({
    contactId,
    practiceId: upload.practiceId,
    clientRelationshipId: upload.clientRelationshipId,
    requires: ["UPLOAD", "APPROVE", "SIGNATORY"],
    now,
  });

  if (!opts.allowFinished && upload.state === "IN_PROGRESS" && upload.expiresAt <= now) {
    await abandon(upload.id, "Upload expired before completion", now);
    throw new PortalUploadError(
      "That upload timed out. Please start it again.",
      "UPLOAD_EXPIRED",
      409,
    );
  }

  return upload;
}

async function findFiledVersion(params: {
  practiceId: string;
  clientRelationshipId: string;
  sha256: string;
}) {
  return prisma.documentVersion.findFirst({
    where: {
      practiceId: params.practiceId,
      sha256: params.sha256,
      document: {
        clientRelationshipId: params.clientRelationshipId,
        archivedAt: null,
      },
    },
    select: { id: true, versionNo: true },
    orderBy: { versionNo: "desc" },
  });
}

/**
 * Move the request item to SUBMITTED and record the response.
 *
 * Deliberately NOT to ACCEPTED. POR03 separates receipt from acceptance, and
 * COM02's close rule already distinguishes "we have it" from "it is usable" —
 * letting a client's own upload mark an item accepted would collapse exactly
 * that distinction, at a statutory deadline.
 */
async function recordItemResponse(
  upload: { id: string; itemId: string | null; practiceId: string; contactId: string },
  documentVersionId: string,
  now: Date,
): Promise<string | null> {
  if (!upload.itemId) return null;

  const contact = await prisma.contact.findUnique({
    where: { id: upload.contactId },
    select: { fullName: true },
  });

  const item = await prisma.clientRequestItem.findFirst({
    where: { id: upload.itemId, practiceId: upload.practiceId },
    select: { id: true, state: true, version: true },
  });
  if (!item) return null;

  await prisma.$transaction(async (tx) => {
    await tx.clientRequestItemResponse.create({
      data: {
        practiceId: upload.practiceId,
        itemId: item.id,
        kind: "DOCUMENT",
        documentVersionId,
        respondedByContactId: upload.contactId,
        respondedByName: contact?.fullName ?? "Client contact",
      },
    });

    // API02 optimistic check: a staff decision made while this upload was in
    // flight must not be silently overwritten by the client's own submission.
    const moved = await tx.clientRequestItem.updateMany({
      where: { id: item.id, practiceId: upload.practiceId, version: item.version },
      data: {
        state: "SUBMITTED",
        stateChangedAt: now,
        version: { increment: 1 },
      },
    });
    if (moved.count !== 1) {
      throw new PortalUploadError(
        "The team updated this request while your file was uploading. " +
          "Your file is safely received — please refresh to see the latest status.",
        "ITEM_VERSION_CONFLICT",
        409,
      );
    }
  });

  return "SUBMITTED";
}

async function existingReceipt(uploadId: string): Promise<PortalReceipt> {
  const upload = await prisma.portalUpload.findUniqueOrThrow({
    where: { id: uploadId },
    select: {
      id: true,
      documentVersionId: true,
      deduplicatedFromVersionId: true,
      itemId: true,
    },
  });
  const version = upload.documentVersionId
    ? await prisma.documentVersion.findUnique({
        where: { id: upload.documentVersionId },
        select: { versionNo: true, sha256: true },
      })
    : null;

  return {
    uploadId: upload.id,
    receiptMessage: RECEIPT_MESSAGE,
    documentVersionId: upload.documentVersionId ?? "",
    versionNo: version?.versionNo ?? 0,
    sha256: version?.sha256 ?? "",
    duplicateOfExisting: upload.deduplicatedFromVersionId !== null,
    itemStatus: upload.itemId ? "SUBMITTED" : null,
  };
}

async function abandon(uploadId: string, reason: string, now: Date) {
  await prisma.portalUpload.update({
    where: { id: uploadId },
    data: { state: "ABANDONED", abandonedAt: now, abandonReason: reason },
  });
}

/**
 * Staging bytes are deleted once assembled. A failure to delete must not fail
 * the upload — the document is already filed by this point, and the parts
 * expire regardless.
 */
async function discardParts(parts: { id: string; objectKey: string }[]) {
  for (const part of parts) {
    try {
      await deleteObject(part.objectKey);
    } catch {
      // Left for expiry.
    }
  }
  await prisma.portalUploadPart.deleteMany({
    where: { id: { in: parts.map((p) => p.id) } },
  });
}

export { PortalAuthError };
