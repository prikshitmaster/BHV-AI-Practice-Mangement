/**
 * Document custody — DOC02, DOC03, DOC04 and DOC06 (PRD §15).
 * DOC05 (physical register) is R1 and is not built here.
 *
 * "A file must retain its provenance, version, access scope and professional
 *  context."
 *
 * The rules that shape this module, in the order they bite:
 *
 *  DOC02  Nothing overwrites an original. Not an edit, not an OCR pass, not a
 *         format conversion, not an integration retrying a failed upload.
 *         Each of those produces a NEW version that names what it came from.
 *
 *  DOC03  Search authorises BEFORE it answers. A count, a snippet or an
 *         autocomplete suggestion drawn from records the user cannot open is
 *         still a disclosure — "0 results" and "3 results you may not open"
 *         are different answers, and only the first is safe.
 *
 *  DOC04  A release names an EXACT version and NAMED contacts. Links expire,
 *         re-authorise on every use, and stop working the moment the holder's
 *         access changes. Internal working papers are never automatically
 *         client deliverables.
 *
 *  DOC06  Finalising a set produces a manifest of versions and hashes.
 *         Deletion needs three separate gates — eligibility, approval, logged
 *         execution — and retained backups keep their own expiry.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type {
  ConfidentialityClass,
  DerivationKind,
  DocumentKind,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { recordEvent } from "@/lib/audit";
import { assertCan, can, resolveMembership } from "@/lib/permissions";
import { PracticeAccessError, getAccessiblePracticeIds } from "@/lib/practice-scope";
import { deleteObject, documentObjectKey } from "@/lib/object-store";
import type { IntakeReceipt } from "@/lib/document-intake";

export class DocumentError extends Error {
  readonly status: number;
  constructor(
    message: string,
    readonly code: string,
    status = 409,
  ) {
    super(message);
    this.name = "DocumentError";
    this.status = status;
  }
}

// ===========================================================================
// DOC02 — versioning
// ===========================================================================

export type FileUploadParams = {
  actorUserId: string;
  practiceId: string;
  receipt: IntakeReceipt;
  filename: string;
  title?: string;
  /** Adds a version to this document. Omit to match on filename or start one. */
  documentId?: string;
  clientRelationshipId?: string | null;
  engagementId?: string | null;
  obligationId?: string | null;
  kind?: DocumentKind;
  workingPaper?: boolean;
  documentType?: string | null;
  periodLabel?: string | null;
  classification?: ConfidentialityClass;
};

/**
 * File an accepted upload as a version.
 *
 * The acceptance evidence is "upload the same filename twice and preserve both
 * versions" — so the filename is a way of FINDING the document, never a key
 * that gets overwritten. A second upload of `bank-statement.pdf` becomes
 * version 2 of the same document, and version 1 is still there, still
 * byte-addressable by its own hash.
 */
export async function fileUpload(params: FileUploadParams) {
  const { receipt } = params;

  if (receipt.outcome !== "ACCEPTED" || !receipt.storedObjectKey || !receipt.sha256) {
    throw new DocumentError(
      "Only an accepted upload can be filed as a document version",
      "INTAKE_NOT_ACCEPTED",
      400,
    );
  }

  await assertCan(params.actorUserId, params.practiceId, "document.upload");

  const document = params.documentId
    ? await requireDocument(params.practiceId, params.documentId)
    : ((await findByFilename(params)) ?? (await createDocument(params)));

  if (document.lockedAt) {
    // DOC06: a finalised set is evidence of what was filed. New material goes
    // to a new document, not into a locked one.
    throw new DocumentError(
      "This document belongs to a finalised set and cannot take new versions",
      "DOCUMENT_LOCKED",
    );
  }

  const version = await prisma.$transaction(async (tx) => {
    const last = await tx.documentVersion.findFirst({
      where: { documentId: document.id, practiceId: params.practiceId },
      orderBy: { versionNo: "desc" },
      select: { id: true, versionNo: true, status: true },
    });

    if (last) {
      await tx.documentVersion.update({
        where: { id: last.id },
        // The previous version is marked superseded. It is NOT edited, moved
        // or deleted — DAT02 — and its bytes stay on their own hash key.
        data: { supersededAt: new Date(), status: "SUPERSEDED" },
      });
    }

    return tx.documentVersion.create({
      data: {
        practiceId: params.practiceId,
        documentId: document.id,
        versionNo: (last?.versionNo ?? 0) + 1,
        storageObjectId: receipt.storedObjectKey!,
        sha256: receipt.sha256!,
        mimeType: receipt.detectedMimeType ?? "application/octet-stream",
        declaredMimeType: receipt.detectedMimeType,
        sizeBytes: BigInt(receipt.sizeBytes),
        source: "STAFF_UPLOAD",
        scanVerdict: "CLEAN",
        filename: params.filename,
        status: "DRAFT",
        derivation: "ORIGINAL",
        preparedByUserId: params.actorUserId,
      },
    });
  });

  await prisma.documentIntake.update({
    where: { id: receipt.intakeId },
    data: { documentId: document.id, documentVersionId: version.id },
  });

  await recordEvent({
    action: "DOCUMENT_VERSION_CREATED",
    targetType: "DocumentVersion",
    targetId: version.id,
    targetVersion: version.versionNo,
    result: "SUCCESS",
    actorUserId: params.actorUserId,
    practiceId: params.practiceId,
    afterMeta: {
      documentId: document.id,
      filename: params.filename,
      sha256: receipt.sha256,
      versionNo: version.versionNo,
    },
  });

  return { document, version };
}

async function findByFilename(params: FileUploadParams) {
  const match = await prisma.documentVersion.findFirst({
    where: {
      practiceId: params.practiceId,
      filename: params.filename,
      document: {
        archivedAt: null,
        clientRelationshipId: params.clientRelationshipId ?? null,
        engagementId: params.engagementId ?? null,
      },
    },
    orderBy: { versionNo: "desc" },
    select: { document: true },
  });
  return match?.document ?? null;
}

async function createDocument(params: FileUploadParams) {
  return prisma.document.create({
    data: {
      practiceId: params.practiceId,
      clientRelationshipId: params.clientRelationshipId ?? null,
      engagementId: params.engagementId ?? null,
      obligationId: params.obligationId ?? null,
      title: params.title ?? params.filename,
      kind: params.kind ?? "INTERNAL",
      workingPaper: params.workingPaper ?? false,
      documentType: params.documentType ?? null,
      periodLabel: params.periodLabel ?? null,
      classification: params.classification ?? "NORMAL",
    },
  });
}

async function requireDocument(practiceId: string, documentId: string) {
  const document = await prisma.document.findFirst({
    where: { id: documentId, practiceId },
  });
  // Unknown and out-of-scope are the same answer.
  if (!document) throw new DocumentError("Not found", "DOCUMENT_NOT_FOUND", 404);
  return document;
}

/**
 * DOC02: "Capture preparer, reviewer and status."
 *
 * IAM04 separation of duties applies — the person who prepared a version
 * cannot be the one who approves it. Reviewing your own work is precisely the
 * control the PRD asks for elsewhere, and a document approval is no exception.
 */
export async function approveVersion(params: {
  actorUserId: string;
  practiceId: string;
  versionId: string;
  note?: string;
}) {
  await assertCan(params.actorUserId, params.practiceId, "document.release");

  const version = await prisma.documentVersion.findFirst({
    where: { id: params.versionId, practiceId: params.practiceId },
  });
  if (!version) throw new DocumentError("Not found", "VERSION_NOT_FOUND", 404);

  if (version.preparedByUserId === params.actorUserId) {
    await recordEvent({
      action: "DOCUMENT_APPROVAL_REFUSED",
      targetType: "DocumentVersion",
      targetId: version.id,
      targetVersion: version.versionNo,
      result: "FAILURE",
      actorUserId: params.actorUserId,
      practiceId: params.practiceId,
      reason: "Preparer cannot approve their own version (IAM04)",
    });
    throw new DocumentError(
      "The preparer of a version cannot approve it",
      "SELF_APPROVAL_REFUSED",
      403,
    );
  }

  if (version.status === "SUPERSEDED") {
    throw new DocumentError(
      "This version has been superseded — approve the current version instead",
      "VERSION_SUPERSEDED",
    );
  }

  const actor = await prisma.user.findUnique({
    where: { id: params.actorUserId },
    select: { fullName: true },
  });

  const updated = await prisma.documentVersion.update({
    where: { id: version.id },
    data: {
      status: "APPROVED",
      reviewedByUserId: params.actorUserId,
      reviewedAt: new Date(),
      approvedByUserId: params.actorUserId,
      // DAT02: the approver's name at the time, so a later rename or
      // deactivation cannot rewrite who signed off.
      approvedByUserName: actor?.fullName ?? "(unknown)",
      approvedAt: new Date(),
    },
  });

  await recordEvent({
    action: "APPROVAL_RECORDED",
    targetType: "DocumentVersion",
    targetId: version.id,
    targetVersion: version.versionNo,
    result: "SUCCESS",
    actorUserId: params.actorUserId,
    practiceId: params.practiceId,
    reason: params.note ?? null,
  });

  return updated;
}

/**
 * DOC02: "Never overwrite an approved original through an edit, OCR process,
 * conversion or integration retry."
 *
 * Every one of those produces a derivative version that names its source and
 * how it was produced. The source row is not touched, which is why a redacted
 * copy can never be mistaken for the evidence it was made from.
 */
export async function createDerivative(params: {
  actorUserId: string;
  practiceId: string;
  sourceVersionId: string;
  derivation: Exclude<DerivationKind, "ORIGINAL">;
  storageObjectId: string;
  sha256: string;
  mimeType: string;
  sizeBytes: number;
  filename?: string;
}) {
  await assertCan(params.actorUserId, params.practiceId, "document.upload");

  const source = await prisma.documentVersion.findFirst({
    where: { id: params.sourceVersionId, practiceId: params.practiceId },
  });
  if (!source) throw new DocumentError("Not found", "VERSION_NOT_FOUND", 404);

  if (params.sha256 === source.sha256) {
    // A derivative identical to its source means the process did nothing —
    // most importantly, a "redaction" that removed nothing.
    throw new DocumentError(
      "The derivative is byte-identical to its source; no transformation occurred",
      "DERIVATIVE_UNCHANGED",
    );
  }

  const derivative = await prisma.$transaction(async (tx) => {
    const last = await tx.documentVersion.findFirst({
      where: { documentId: source.documentId, practiceId: params.practiceId },
      orderBy: { versionNo: "desc" },
      select: { versionNo: true },
    });

    return tx.documentVersion.create({
      data: {
        practiceId: params.practiceId,
        documentId: source.documentId,
        versionNo: (last?.versionNo ?? 0) + 1,
        storageObjectId: params.storageObjectId,
        sha256: params.sha256,
        mimeType: params.mimeType,
        sizeBytes: BigInt(params.sizeBytes),
        source: "SYSTEM_GENERATED",
        scanVerdict: "CLEAN",
        filename: params.filename ?? source.filename,
        status: "DRAFT",
        derivation: params.derivation,
        derivedFromVersionId: source.id,
        preparedByUserId: params.actorUserId,
      },
    });
  });

  await recordEvent({
    action: "DOCUMENT_DERIVATIVE_CREATED",
    targetType: "DocumentVersion",
    targetId: derivative.id,
    targetVersion: derivative.versionNo,
    result: "SUCCESS",
    actorUserId: params.actorUserId,
    practiceId: params.practiceId,
    afterMeta: {
      derivedFrom: source.id,
      derivedFromVersionNo: source.versionNo,
      derivation: params.derivation,
    },
  });

  return derivative;
}

/**
 * The section's closing rule: "Redaction produces a derivative with a review
 * record; visual black rectangles alone do not prove sensitive content has
 * been removed. Test hidden text, metadata, attachments and OCR layers before
 * external release."
 *
 * So the review record has four explicit checks, and a redaction that has not
 * had all four confirmed cannot be released (see `releaseVersion`).
 */
export async function recordRedactionReview(params: {
  actorUserId: string;
  practiceId: string;
  versionId: string;
  method: string;
  checkedHiddenText: boolean;
  checkedMetadata: boolean;
  checkedAttachments: boolean;
  checkedOcrLayer: boolean;
  conclusion: string;
}) {
  const version = await prisma.documentVersion.findFirst({
    where: { id: params.versionId, practiceId: params.practiceId },
  });
  if (!version) throw new DocumentError("Not found", "VERSION_NOT_FOUND", 404);

  if (version.derivation !== "REDACTION" || !version.derivedFromVersionId) {
    throw new DocumentError(
      "A redaction review belongs on a redaction derivative, not on an original",
      "NOT_A_REDACTION",
    );
  }

  const actor = await prisma.user.findUnique({
    where: { id: params.actorUserId },
    select: { fullName: true },
  });

  return prisma.redactionReview.create({
    data: {
      practiceId: params.practiceId,
      documentVersionId: version.id,
      sourceVersionId: version.derivedFromVersionId,
      method: params.method,
      checkedHiddenText: params.checkedHiddenText,
      checkedMetadata: params.checkedMetadata,
      checkedAttachments: params.checkedAttachments,
      checkedOcrLayer: params.checkedOcrLayer,
      reviewedByUserId: params.actorUserId,
      reviewedByUserName: actor?.fullName ?? "(unknown)",
      conclusion: params.conclusion,
    },
  });
}

// ===========================================================================
// DOC03 — classification and search
// ===========================================================================

/**
 * "OCR and AI classifications are draft metadata with source references and
 *  correction history."
 *
 * A suggestion never writes itself onto the document. It lands here as DRAFT
 * with where it came from, and a human decides.
 */
export async function suggestClassification(params: {
  practiceId: string;
  documentVersionId: string;
  field: string;
  value: string;
  confidence?: number;
  producedBy: string;
  modelVersion?: string;
  sourceReference?: string;
}) {
  return prisma.documentClassification.create({
    data: {
      practiceId: params.practiceId,
      documentVersionId: params.documentVersionId,
      field: params.field,
      value: params.value,
      confidence: params.confidence ?? null,
      producedBy: params.producedBy,
      modelVersion: params.modelVersion ?? null,
      sourceReference: params.sourceReference ?? null,
      status: "DRAFT",
    },
  });
}

/**
 * Confirm or correct a draft classification. A correction does not edit the
 * draft — it writes a new row pointing back at what it replaced, so the
 * correction history the PRD asks for is the record itself.
 *
 * Only a CONFIRMED value reaches the Document. That is the difference between
 * a machine suggesting a document type and a machine setting one.
 */
export async function decideClassification(params: {
  actorUserId: string;
  practiceId: string;
  classificationId: string;
  decision: "CONFIRM" | "REJECT" | "CORRECT";
  correctedValue?: string;
  reason?: string;
}) {
  const draft = await prisma.documentClassification.findFirst({
    where: { id: params.classificationId, practiceId: params.practiceId },
    include: { documentVersion: { select: { documentId: true } } },
  });
  if (!draft) throw new DocumentError("Not found", "CLASSIFICATION_NOT_FOUND", 404);
  if (draft.status !== "DRAFT") {
    throw new DocumentError("This classification has already been decided", "ALREADY_DECIDED");
  }

  await assertCan(params.actorUserId, params.practiceId, "document.upload");

  const actor = await prisma.user.findUnique({
    where: { id: params.actorUserId },
    select: { fullName: true },
  });
  const now = new Date();

  if (params.decision === "CORRECT" && !params.correctedValue) {
    throw new DocumentError("A correction must supply the corrected value", "NO_CORRECTION");
  }

  const decided = await prisma.documentClassification.update({
    where: { id: draft.id },
    data: {
      status: params.decision === "CONFIRM" ? "CONFIRMED" : params.decision === "REJECT" ? "REJECTED" : "CORRECTED",
      decidedByUserId: params.actorUserId,
      decidedByUserName: actor?.fullName ?? "(unknown)",
      decidedAt: now,
      correctionReason: params.reason ?? null,
    },
  });

  let effective = decided;

  if (params.decision === "CORRECT") {
    effective = await prisma.documentClassification.create({
      data: {
        practiceId: params.practiceId,
        documentVersionId: draft.documentVersionId,
        field: draft.field,
        value: params.correctedValue!,
        producedBy: "HUMAN",
        sourceReference: draft.sourceReference,
        status: "CONFIRMED",
        supersedesId: draft.id,
        decidedByUserId: params.actorUserId,
        decidedByUserName: actor?.fullName ?? "(unknown)",
        decidedAt: now,
        correctionReason: params.reason ?? null,
      },
    });
  }

  if (effective.status === "CONFIRMED") {
    await applyConfirmedClassification(
      params.practiceId,
      draft.documentVersion.documentId,
      effective.field,
      effective.value,
    );
  }

  return effective;
}

async function applyConfirmedClassification(
  practiceId: string,
  documentId: string,
  field: string,
  value: string,
) {
  const data: Record<string, unknown> = {};
  if (field === "documentType") data.documentType = value;
  else if (field === "period") data.periodLabel = value;
  else if (field === "sensitivity" && isConfidentiality(value)) data.classification = value;
  else return; // An unrecognised field stays metadata; it never writes blind.

  await prisma.document.updateMany({
    where: { id: documentId, practiceId },
    data: { ...data, version: { increment: 1 } },
  });
}

function isConfidentiality(v: string): v is ConfidentialityClass {
  return v === "NORMAL" || v === "RESTRICTED" || v === "HIGHLY_RESTRICTED";
}

export type DocumentSearchResult = {
  documentId: string;
  practiceId: string;
  title: string;
  documentType: string | null;
  periodLabel: string | null;
  kind: DocumentKind;
  classification: ConfidentialityClass;
  latestVersionNo: number | null;
  snippet: string | null;
};

/**
 * DOC03: "Search respects record and field permissions before returning
 *  snippets, counts or suggestions."
 *
 * Everything returned here — results, the count, and the autocomplete
 * suggestions — comes out of the SAME authorised query. There is no
 * "search everything then filter the list", because a total that counts
 * records the user cannot open has already disclosed them.
 */
export async function searchDocuments(params: {
  actorUserId: string;
  query: string;
  practiceId?: string;
  limit?: number;
}): Promise<{ results: DocumentSearchResult[]; totalCount: number; suggestions: string[] }> {
  const allowed = await getAccessiblePracticeIds(params.actorUserId);
  const scoped = params.practiceId ? [params.practiceId] : allowed;

  if (params.practiceId && !allowed.includes(params.practiceId)) {
    throw new PracticeAccessError(params.actorUserId, params.practiceId);
  }
  // No memberships means no results and a count of zero — never "everything".
  if (scoped.length === 0) return { results: [], totalCount: 0, suggestions: [] };

  // IAM03: protected working papers stay invisible without the explicit grant,
  // per practice — a grant in one firm does not reveal the other's papers.
  const visibleIn: string[] = [];
  const protectedIn: string[] = [];
  for (const practiceId of scoped) {
    const membership = await resolveMembership(params.actorUserId, practiceId);
    if (!membership || !can(membership, "document.read")) continue;
    visibleIn.push(practiceId);
    if (can(membership, "workpaper.protected.read")) protectedIn.push(practiceId);
  }
  if (visibleIn.length === 0) return { results: [], totalCount: 0, suggestions: [] };

  const where = {
    archivedAt: null,
    OR: [
      { practiceId: { in: protectedIn } },
      {
        practiceId: { in: visibleIn.filter((p) => !protectedIn.includes(p)) },
        classification: { not: "HIGHLY_RESTRICTED" as ConfidentialityClass },
        workingPaper: false,
      },
    ],
    AND: [
      {
        OR: [
          { title: { contains: params.query, mode: "insensitive" as const } },
          { documentType: { contains: params.query, mode: "insensitive" as const } },
          { periodLabel: { contains: params.query, mode: "insensitive" as const } },
          { versions: { some: { filename: { contains: params.query, mode: "insensitive" as const } } } },
        ],
      },
    ],
  };

  const [rows, totalCount] = await Promise.all([
    prisma.document.findMany({
      where,
      take: params.limit ?? 25,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true, practiceId: true, title: true, documentType: true,
        periodLabel: true, kind: true, classification: true,
        versions: { orderBy: { versionNo: "desc" }, take: 1, select: { versionNo: true, filename: true } },
      },
    }),
    prisma.document.count({ where }),
  ]);

  return {
    results: rows.map((r) => ({
      documentId: r.id,
      practiceId: r.practiceId,
      title: r.title,
      documentType: r.documentType,
      periodLabel: r.periodLabel,
      kind: r.kind,
      classification: r.classification,
      latestVersionNo: r.versions[0]?.versionNo ?? null,
      // The "snippet" is metadata the user is already cleared to see. Document
      // BODIES are never indexed into a search response.
      snippet: r.versions[0]?.filename ?? null,
    })),
    totalCount,
    suggestions: [...new Set(rows.map((r) => r.title))].slice(0, 10),
  };
}

// ===========================================================================
// DOC04 — release and sharing
// ===========================================================================

/**
 * "A reviewer releases an exact version to named portal contacts."
 *
 * Four refusals live here, and each corresponds to a way a client ends up
 * holding something nobody meant to send:
 *   - a version that has not been approved,
 *   - an internal working paper,
 *   - a redaction whose hidden layers were never checked,
 *   - a contact with no live authority on this relationship.
 */
export async function releaseVersion(params: {
  actorUserId: string;
  practiceId: string;
  versionId: string;
  contactIds: string[];
  expiresAt?: Date | null;
  reason?: string;
}) {
  await assertCan(params.actorUserId, params.practiceId, "document.release");

  const version = await prisma.documentVersion.findFirst({
    where: { id: params.versionId, practiceId: params.practiceId },
    include: { document: true, redactionReview: true },
  });
  if (!version) throw new DocumentError("Not found", "VERSION_NOT_FOUND", 404);

  if (version.status !== "APPROVED") {
    throw new DocumentError(
      "Only an approved version can be released to a client",
      "VERSION_NOT_APPROVED",
    );
  }

  // DOC04: "Internal audit working papers are not automatically client
  // deliverables." Releasing one requires reclassifying it deliberately, which
  // is a decision someone makes and the audit trail records.
  if (version.document.workingPaper || version.document.kind === "INTERNAL") {
    throw new DocumentError(
      "Internal working papers are not client deliverables — reclassify the document as a deliverable first",
      "NOT_A_DELIVERABLE",
      403,
    );
  }

  if (version.derivation === "REDACTION") {
    const r = version.redactionReview;
    const complete =
      r && r.checkedHiddenText && r.checkedMetadata && r.checkedAttachments && r.checkedOcrLayer;
    if (!complete) {
      throw new DocumentError(
        "A redacted document cannot be released until hidden text, metadata, attachments and OCR layers have been checked",
        "REDACTION_UNVERIFIED",
      );
    }
  }

  if (params.contactIds.length === 0) {
    throw new DocumentError("A release must name at least one contact", "NO_RECIPIENTS", 400);
  }
  if (!version.document.clientRelationshipId) {
    throw new DocumentError(
      "A document with no client relationship cannot be released to a client contact",
      "NO_CLIENT_RELATIONSHIP",
    );
  }

  const now = new Date();
  const authorised = await prisma.contactAuthority.findMany({
    where: {
      contactId: { in: params.contactIds },
      clientRelationshipId: version.document.clientRelationshipId,
      practiceId: params.practiceId,
      revokedAt: null,
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
    },
    select: { contactId: true, contact: { select: { fullName: true } } },
  });

  const authorisedIds = new Set(authorised.map((a) => a.contactId));
  const unauthorised = params.contactIds.filter((id) => !authorisedIds.has(id));
  if (unauthorised.length > 0) {
    await recordEvent({
      action: "DOCUMENT_RELEASE_REFUSED",
      targetType: "DocumentVersion",
      targetId: version.id,
      targetVersion: version.versionNo,
      result: "FAILURE",
      actorUserId: params.actorUserId,
      practiceId: params.practiceId,
      reason: "One or more recipients have no live authority on this client relationship",
      afterMeta: { unauthorisedCount: unauthorised.length },
    });
    throw new DocumentError(
      "One or more recipients are not authorised contacts for this client",
      "RECIPIENT_NOT_AUTHORISED",
      403,
    );
  }

  const actor = await prisma.user.findUnique({
    where: { id: params.actorUserId },
    select: { fullName: true },
  });

  const release = await prisma.documentRelease.create({
    data: {
      practiceId: params.practiceId,
      documentId: version.documentId,
      documentVersionId: version.id,
      releasedByUserId: params.actorUserId,
      releasedByUserName: actor?.fullName ?? "(unknown)",
      reason: params.reason ?? null,
      expiresAt: params.expiresAt ?? null,
      recipients: {
        create: authorised.map((a) => ({
          practiceId: params.practiceId,
          contactId: a.contactId,
          clientRelationshipId: version.document.clientRelationshipId!,
          contactNameAtRelease: a.contact.fullName,
        })),
      },
    },
    include: { recipients: true },
  });

  await recordEvent({
    action: "DOCUMENT_RELEASED",
    targetType: "DocumentVersion",
    targetId: version.id,
    // SEC04 "exact version": the release is pinned to this number, and a later
    // version does not inherit it.
    targetVersion: version.versionNo,
    result: "SUCCESS",
    actorUserId: params.actorUserId,
    practiceId: params.practiceId,
    reason: params.reason ?? null,
    afterMeta: {
      releaseId: release.id,
      recipientCount: release.recipients.length,
      expiresAt: params.expiresAt?.toISOString() ?? null,
    },
  });

  return release;
}

const TOKEN_TTL_MS = 15 * 60 * 1000;

/**
 * Mint an access link. The plaintext token is returned ONCE and only its hash
 * is stored, the same way session and invitation tokens are handled in
 * `auth.ts` — a leaked database row must not be a working link.
 */
export async function issueAccessToken(params: {
  practiceId: string;
  documentVersionId: string;
  releaseId?: string | null;
  issuedToUserId?: string | null;
  issuedToContactId?: string | null;
  issuedByUserId?: string | null;
  purpose: string;
  ttlMs?: number;
  maxUses?: number;
}): Promise<{ token: string; tokenId: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + (params.ttlMs ?? TOKEN_TTL_MS));

  const row = await prisma.documentAccessToken.create({
    data: {
      practiceId: params.practiceId,
      documentVersionId: params.documentVersionId,
      releaseId: params.releaseId ?? null,
      tokenHash: hashToken(token),
      issuedToUserId: params.issuedToUserId ?? null,
      issuedToContactId: params.issuedToContactId ?? null,
      issuedByUserId: params.issuedByUserId ?? null,
      purpose: params.purpose,
      expiresAt,
      maxUses: params.maxUses ?? null,
    },
  });

  await recordEvent({
    action: "OBJECT_LINK_ISSUED",
    targetType: "DocumentVersion",
    targetId: params.documentVersionId,
    result: "SUCCESS",
    actorUserId: params.issuedByUserId ?? null,
    practiceId: params.practiceId,
    afterMeta: { tokenId: row.id, purpose: params.purpose, expiresAt: expiresAt.toISOString() },
  });

  return { token, tokenId: row.id, expiresAt };
}

export type RedeemedLink = {
  documentVersionId: string;
  storageObjectId: string;
  mimeType: string;
  filename: string;
  versionNo: number;
};

/**
 * DOC04: "Links expire, require authorised access and revoke on permission
 *  change."
 *
 * This is where that last clause is paid for. Every redemption re-checks live
 * state — the token, the release, the holder's account, their membership or
 * contact authority, and the file's own scan verdict. Suspending a user or
 * revoking a contact's authority therefore breaks their existing link on the
 * very next use, with no revocation sweep needed and no window where a link
 * minted a minute ago still works.
 */
export async function redeemAccessToken(params: {
  token: string;
  now?: Date;
}): Promise<RedeemedLink> {
  const now = params.now ?? new Date();

  const row = await prisma.documentAccessToken.findUnique({
    where: { tokenHash: hashToken(params.token) },
    include: {
      documentVersion: { include: { document: true } },
      release: { include: { recipients: true } },
    },
  });

  // Every failure below is the same 404. Distinguishing "expired" from
  // "revoked" from "never existed" tells a holder which links are real.
  const deny = async (why: string, tokenId?: string) => {
    await recordEvent({
      action: "OBJECT_LINK_DENIED",
      targetType: "DocumentAccessToken",
      targetId: tokenId ?? "unknown",
      result: "FAILURE",
      practiceId: row?.practiceId ?? null,
      actorUserId: row?.issuedToUserId ?? null,
      reason: why,
    });
    return new DocumentError("Not found", "LINK_INVALID", 404);
  };

  if (!row) throw await deny("No such access token");
  if (row.revokedAt) throw await deny("Token revoked", row.id);
  if (row.expiresAt <= now) throw await deny("Token expired", row.id);
  if (row.maxUses !== null && row.usedCount >= row.maxUses) {
    throw await deny("Token use limit reached", row.id);
  }

  if (row.release) {
    if (row.release.revokedAt) throw await deny("Release revoked", row.id);
    if (row.release.expiresAt && row.release.expiresAt <= now) {
      throw await deny("Release expired", row.id);
    }
  }

  // Live re-authorisation of the holder.
  if (row.issuedToUserId) {
    const user = await prisma.user.findUnique({
      where: { id: row.issuedToUserId },
      select: { status: true, suspendedAt: true },
    });
    if (!user || user.status !== "ACTIVE" || user.suspendedAt) {
      throw await deny("Holder's account is no longer active", row.id);
    }
    const membership = await resolveMembership(row.issuedToUserId, row.practiceId, now);
    if (!membership || !can(membership, "document.read")) {
      throw await deny("Holder no longer has document access in this practice", row.id);
    }
  } else if (row.issuedToContactId) {
    const named = row.release?.recipients.some((r) => r.contactId === row.issuedToContactId);
    if (!named) throw await deny("Contact is not a named recipient of this release", row.id);

    const authority = await prisma.contactAuthority.findFirst({
      where: {
        contactId: row.issuedToContactId,
        practiceId: row.practiceId,
        revokedAt: null,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
      select: { id: true },
    });
    if (!authority) throw await deny("Contact authority has been revoked", row.id);
  } else {
    throw await deny("Token is not bound to a holder", row.id);
  }

  const version = row.documentVersion;
  if (version.document.archivedAt) throw await deny("Document withdrawn", row.id);
  if (version.scanVerdict !== "CLEAN") throw await deny("File is not cleared for release", row.id);

  await prisma.documentAccessToken.update({
    where: { id: row.id },
    data: { usedCount: { increment: 1 }, lastUsedAt: now },
  });

  await recordEvent({
    action: "OBJECT_LINK_REDEEMED",
    targetType: "DocumentVersion",
    targetId: version.id,
    targetVersion: version.versionNo,
    result: "SUCCESS",
    actorUserId: row.issuedToUserId,
    practiceId: row.practiceId,
    afterMeta: { tokenId: row.id, contactId: row.issuedToContactId },
  });

  return {
    documentVersionId: version.id,
    storageObjectId: version.storageObjectId,
    mimeType: version.mimeType,
    filename: version.filename,
    versionNo: version.versionNo,
  };
}

export async function revokeRelease(params: {
  actorUserId: string;
  practiceId: string;
  releaseId: string;
  reason: string;
}) {
  const release = await prisma.documentRelease.findFirst({
    where: { id: params.releaseId, practiceId: params.practiceId },
  });
  if (!release) throw new DocumentError("Not found", "RELEASE_NOT_FOUND", 404);

  const now = new Date();
  await prisma.$transaction([
    prisma.documentRelease.update({
      where: { id: release.id },
      data: { revokedAt: now, revokedByUserId: params.actorUserId, revokeReason: params.reason },
    }),
    // Defence in depth: redemption would refuse these anyway once the release
    // is revoked, but leaving live tokens attached to a revoked release is an
    // invitation to a future code path that forgets to check.
    prisma.documentAccessToken.updateMany({
      where: { releaseId: release.id, revokedAt: null },
      data: { revokedAt: now, revokeReason: params.reason },
    }),
  ]);

  await recordEvent({
    action: "DOCUMENT_RELEASE_REVOKED",
    targetType: "DocumentRelease",
    targetId: release.id,
    result: "SUCCESS",
    actorUserId: params.actorUserId,
    practiceId: params.practiceId,
    reason: params.reason,
  });
}

/**
 * Called from the IAM05 lifecycle when a user is suspended or their access
 * changes. Redemption already re-checks live state, so this is belt and
 * braces — but it also makes the revocation visible in the data rather than
 * only implied by a check somewhere else.
 */
export async function revokeAccessTokensForUser(userId: string, reason: string) {
  const { count } = await prisma.documentAccessToken.updateMany({
    where: { issuedToUserId: userId, revokedAt: null },
    data: { revokedAt: new Date(), revokeReason: reason },
  });
  return count;
}

/**
 * What a client contact can actually see in the portal.
 *
 * The acceptance evidence is that "a client can see the released report but
 * cannot discover internal working paper titles" — so this does not filter a
 * list of the client's documents, it builds the list FROM the releases. A
 * document that was never released cannot appear, whatever its flags say.
 */
export async function listReleasedForContact(params: {
  contactId: string;
  practiceId?: string;
  now?: Date;
}) {
  const now = params.now ?? new Date();

  const releases = await prisma.documentRelease.findMany({
    where: {
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      recipients: { some: { contactId: params.contactId } },
      ...(params.practiceId ? { practiceId: params.practiceId } : {}),
    },
    select: {
      id: true,
      practiceId: true,
      createdAt: true,
      documentVersion: {
        select: {
          id: true, versionNo: true, filename: true, mimeType: true,
          document: { select: { id: true, title: true, documentType: true, periodLabel: true } },
        },
      },
    },
  });

  return releases.map((r) => ({
    releaseId: r.id,
    practiceId: r.practiceId,
    releasedAt: r.createdAt,
    documentId: r.documentVersion.document.id,
    title: r.documentVersion.document.title,
    documentType: r.documentVersion.document.documentType,
    periodLabel: r.documentVersion.document.periodLabel,
    versionId: r.documentVersion.id,
    versionNo: r.documentVersion.versionNo,
    filename: r.documentVersion.filename,
    mimeType: r.documentVersion.mimeType,
  }));
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Constant-time comparison helper, exported for use by route handlers. */
export function tokensMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// ===========================================================================
// DOC06 — lock and retention
// ===========================================================================

export async function addToSet(params: {
  actorUserId: string;
  practiceId: string;
  documentSetId: string;
  documentVersionId: string;
}) {
  const set = await prisma.documentSet.findFirst({
    where: { id: params.documentSetId, practiceId: params.practiceId },
  });
  if (!set) throw new DocumentError("Not found", "SET_NOT_FOUND", 404);
  if (set.state === "FINALISED") {
    throw new DocumentError("A finalised set cannot be changed", "SET_FINALISED");
  }

  const version = await prisma.documentVersion.findFirst({
    where: { id: params.documentVersionId, practiceId: params.practiceId },
    select: { id: true, documentId: true, versionNo: true, sha256: true },
  });
  if (!version) throw new DocumentError("Not found", "VERSION_NOT_FOUND", 404);

  return prisma.documentSetEntry.create({
    data: {
      practiceId: params.practiceId,
      documentSetId: set.id,
      documentId: version.documentId,
      documentVersionId: version.id,
      versionNo: version.versionNo,
      sha256: version.sha256,
    },
  });
}

/**
 * DOC06: "Finalise a document set through a manifest of versions and hashes."
 *
 * The manifest records the hash of every version as it stood at finalisation,
 * and is itself hashed — so a later claim about what the set contained can be
 * checked, not just asserted. The documents in it are locked against new
 * versions from that point.
 */
export async function finaliseSet(params: {
  actorUserId: string;
  practiceId: string;
  documentSetId: string;
}) {
  await assertCan(params.actorUserId, params.practiceId, "document.release");

  const set = await prisma.documentSet.findFirst({
    where: { id: params.documentSetId, practiceId: params.practiceId },
    include: {
      entries: {
        orderBy: { addedAt: "asc" },
        include: { documentVersion: { select: { filename: true } } },
      },
    },
  });
  if (!set) throw new DocumentError("Not found", "SET_NOT_FOUND", 404);
  if (set.state === "FINALISED") {
    throw new DocumentError("This set is already finalised", "SET_FINALISED");
  }
  if (set.entries.length === 0) {
    throw new DocumentError("An empty set cannot be finalised", "SET_EMPTY");
  }

  const manifest = set.entries.map((e) => ({
    documentId: e.documentId,
    documentVersionId: e.documentVersionId,
    versionNo: e.versionNo,
    sha256: e.sha256,
    filename: e.documentVersion.filename,
  }));
  const manifestSha256 = manifestHash(manifest);

  const actor = await prisma.user.findUnique({
    where: { id: params.actorUserId },
    select: { fullName: true },
  });
  const now = new Date();

  const finalised = await prisma.$transaction(async (tx) => {
    await tx.document.updateMany({
      where: { id: { in: manifest.map((m) => m.documentId) }, practiceId: params.practiceId },
      data: { lockedAt: now, lockedByUserId: params.actorUserId, documentSetId: set.id },
    });
    return tx.documentSet.update({
      where: { id: set.id },
      data: {
        state: "FINALISED",
        manifest: manifest as never,
        manifestSha256,
        finalisedAt: now,
        finalisedByUserId: params.actorUserId,
        finalisedByUserName: actor?.fullName ?? "(unknown)",
      },
    });
  });

  await recordEvent({
    action: "DOCUMENT_SET_FINALISED",
    targetType: "DocumentSet",
    targetId: set.id,
    result: "SUCCESS",
    actorUserId: params.actorUserId,
    practiceId: params.practiceId,
    afterMeta: { entryCount: manifest.length, manifestSha256 },
  });

  return { set: finalised, manifest, manifestSha256 };
}

export type ManifestEntry = {
  documentId: string;
  documentVersionId: string;
  versionNo: number;
  sha256: string;
  filename: string;
};

/**
 * The manifest hash must be canonical, not "whatever JSON.stringify produced
 * that day". The manifest is stored as jsonb, which does not preserve key
 * order, so hashing a serialisation would verify by luck and fail for reasons
 * that have nothing to do with tampering — which is worse than no check at
 * all, because it teaches people to ignore the alarm. Fields are therefore
 * read by name and joined in a fixed order, the same approach the SEC04 audit
 * chain uses in `audit.ts`.
 */
function manifestHash(entries: ManifestEntry[]): string {
  const canonical = entries
    .map((e) =>
      [e.documentId, e.documentVersionId, String(e.versionNo), e.sha256, e.filename].join("|"),
    )
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}

/** Recompute the manifest hash from the stored rows and compare. */
export async function verifySetManifest(practiceId: string, documentSetId: string) {
  const set = await prisma.documentSet.findFirst({
    where: { id: documentSetId, practiceId },
    select: { manifest: true, manifestSha256: true, state: true },
  });
  if (!set || set.state !== "FINALISED" || !set.manifestSha256) {
    return { ok: false, problem: "Set is not finalised" };
  }

  const stored = set.manifest as unknown as ManifestEntry[] | null;
  if (!Array.isArray(stored)) {
    return { ok: false, problem: "Manifest is missing or not a list of versions" };
  }

  const recomputed = manifestHash(stored);
  return {
    ok: recomputed === set.manifestSha256,
    problem: recomputed === set.manifestSha256 ? null : "Manifest does not match its recorded hash",
  };
}

export async function applyRetention(params: {
  actorUserId: string;
  practiceId: string;
  documentId: string;
  recordClass: string;
  from?: Date;
}) {
  const now = params.from ?? new Date();
  const policy = await prisma.retentionPolicy.findFirst({
    where: {
      practiceId: params.practiceId,
      recordClass: params.recordClass,
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
    },
    orderBy: { effectiveFrom: "desc" },
  });
  if (!policy) {
    throw new DocumentError(
      `No retention policy is in force for record class ${params.recordClass}`,
      "NO_RETENTION_POLICY",
    );
  }

  const until = new Date(now);
  until.setUTCFullYear(until.getUTCFullYear() + policy.retainYears);

  return prisma.document.update({
    where: { id: params.documentId },
    data: {
      retentionPolicyId: policy.id,
      retentionUntil: until,
      retentionBasis: policy.basis,
    },
  });
}

export async function placeLegalHold(params: {
  actorUserId: string;
  practiceId: string;
  reason: string;
  documentId?: string;
  engagementId?: string;
  clientRelationshipId?: string;
}) {
  const actor = await prisma.user.findUnique({
    where: { id: params.actorUserId },
    select: { fullName: true },
  });

  const hold = await prisma.legalHold.create({
    data: {
      practiceId: params.practiceId,
      reason: params.reason,
      scopeDocumentId: params.documentId ?? null,
      scopeEngagementId: params.engagementId ?? null,
      scopeClientRelationshipId: params.clientRelationshipId ?? null,
      placedByUserId: params.actorUserId,
      placedByUserName: actor?.fullName ?? "(unknown)",
    },
  });

  await prisma.document.updateMany({
    where: {
      practiceId: params.practiceId,
      ...(params.documentId ? { id: params.documentId } : {}),
      ...(params.engagementId ? { engagementId: params.engagementId } : {}),
      ...(params.clientRelationshipId
        ? { clientRelationshipId: params.clientRelationshipId }
        : {}),
    },
    data: { legalHold: true },
  });

  await recordEvent({
    action: "LEGAL_HOLD_PLACED",
    targetType: "LegalHold",
    targetId: hold.id,
    result: "SUCCESS",
    actorUserId: params.actorUserId,
    practiceId: params.practiceId,
    reason: params.reason,
  });

  return hold;
}

export type EligibilityResult = { eligible: boolean; reason: string | null };

/**
 * DOC06 gate 1 — eligibility. Kept separate from the approval so the two
 * cannot collapse into a single click: an approver is entitled to see the
 * eligibility answer before deciding, not alongside it.
 */
export async function checkDeletionEligibility(params: {
  practiceId: string;
  documentId: string;
  now?: Date;
}): Promise<EligibilityResult> {
  const now = params.now ?? new Date();
  const doc = await prisma.document.findFirst({
    where: { id: params.documentId, practiceId: params.practiceId },
    include: { versions: { select: { id: true } } },
  });
  if (!doc) return { eligible: false, reason: "Document not found" };

  if (doc.legalHold) return { eligible: false, reason: "Document is under legal hold" };
  if (doc.lockedAt) {
    return { eligible: false, reason: "Document belongs to a finalised set" };
  }
  if (doc.retentionUntil && doc.retentionUntil > now) {
    return {
      eligible: false,
      reason: `Retention period runs to ${doc.retentionUntil.toISOString().slice(0, 10)} (${doc.retentionBasis ?? "policy"})`,
    };
  }
  if (!doc.retentionUntil) {
    // No policy applied is not the same as no retention required. Refusing
    // here is the safe direction: an unclassified document is not evidence
    // that it may go.
    return { eligible: false, reason: "No retention policy has been applied to this document" };
  }

  const liveRelease = await prisma.documentRelease.findFirst({
    where: {
      documentId: doc.id,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { id: true },
  });
  if (liveRelease) {
    return { eligible: false, reason: "Document is currently released to a client" };
  }

  return { eligible: true, reason: null };
}

export async function requestDeletion(params: {
  actorUserId: string;
  practiceId: string;
  documentId: string;
  reason: string;
}) {
  const eligibility = await checkDeletionEligibility({
    practiceId: params.practiceId,
    documentId: params.documentId,
  });

  const request = await prisma.deletionRequest.create({
    data: {
      practiceId: params.practiceId,
      documentId: params.documentId,
      requestedByUserId: params.actorUserId,
      reason: params.reason,
      eligibilityCheckedAt: new Date(),
      eligible: eligibility.eligible,
      ineligibleReason: eligibility.reason,
      state: "REQUESTED",
      backupExpiryNote:
        "Copies already written to backups are not removed by this action; " +
        "they expire under the backup retention schedule (BCP01-04).",
    },
  });

  await recordEvent({
    action: "DOCUMENT_DELETION_REQUESTED",
    targetType: "DeletionRequest",
    targetId: request.id,
    result: "SUCCESS",
    actorUserId: params.actorUserId,
    practiceId: params.practiceId,
    reason: params.reason,
    afterMeta: { eligible: eligibility.eligible, ineligibleReason: eligibility.reason },
  });

  return request;
}

/**
 * DOC06 gate 2 — approval. The requester cannot approve their own deletion
 * request, and an ineligible request cannot be approved at all: an approval
 * is not a way to overrule a legal hold or a retention period.
 */
export async function approveDeletion(params: {
  actorUserId: string;
  practiceId: string;
  requestId: string;
}) {
  await assertCan(params.actorUserId, params.practiceId, "document.delete_approve");

  const request = await prisma.deletionRequest.findFirst({
    where: { id: params.requestId, practiceId: params.practiceId },
  });
  if (!request) throw new DocumentError("Not found", "REQUEST_NOT_FOUND", 404);
  if (request.state !== "REQUESTED") {
    throw new DocumentError("This request has already been decided", "ALREADY_DECIDED");
  }
  if (request.requestedByUserId === params.actorUserId) {
    throw new DocumentError(
      "The requester cannot approve their own deletion request",
      "SELF_APPROVAL_REFUSED",
      403,
    );
  }

  // Re-check rather than trusting the answer stored at request time — a legal
  // hold may have been placed in between.
  const eligibility = await checkDeletionEligibility({
    practiceId: params.practiceId,
    documentId: request.documentId,
  });
  if (!eligibility.eligible) {
    await prisma.deletionRequest.update({
      where: { id: request.id },
      data: {
        state: "REJECTED",
        rejectedReason: eligibility.reason,
        eligible: false,
        ineligibleReason: eligibility.reason,
        eligibilityCheckedAt: new Date(),
      },
    });
    throw new DocumentError(
      `Deletion refused: ${eligibility.reason}`,
      "NOT_ELIGIBLE",
      403,
    );
  }

  const actor = await prisma.user.findUnique({
    where: { id: params.actorUserId },
    select: { fullName: true },
  });

  const approved = await prisma.deletionRequest.update({
    where: { id: request.id },
    data: {
      state: "APPROVED",
      approvedByUserId: params.actorUserId,
      approvedByUserName: actor?.fullName ?? "(unknown)",
      approvedAt: new Date(),
    },
  });

  await recordEvent({
    action: "DOCUMENT_DELETION_APPROVED",
    targetType: "DeletionRequest",
    targetId: request.id,
    result: "SUCCESS",
    actorUserId: params.actorUserId,
    practiceId: params.practiceId,
  });

  return approved;
}

/**
 * DOC06 gate 3 — logged execution. The Document row and every version row
 * SURVIVE, archived: what was held, by whom, and that it was destroyed is
 * itself a record. Only the stored bytes go.
 */
export async function executeDeletion(params: {
  actorUserId: string;
  practiceId: string;
  requestId: string;
}) {
  const request = await prisma.deletionRequest.findFirst({
    where: { id: params.requestId, practiceId: params.practiceId },
  });
  if (!request) throw new DocumentError("Not found", "REQUEST_NOT_FOUND", 404);
  if (request.state !== "APPROVED") {
    throw new DocumentError("Only an approved request can be executed", "NOT_APPROVED");
  }

  const versions = await prisma.documentVersion.findMany({
    where: { documentId: request.documentId, practiceId: params.practiceId },
    select: { id: true, storageObjectId: true, sha256: true },
  });

  for (const v of versions) {
    await deleteObject(v.storageObjectId);
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.document.updateMany({
      where: { id: request.documentId, practiceId: params.practiceId },
      data: { archivedAt: now },
    }),
    prisma.deletionRequest.update({
      where: { id: request.id },
      data: { state: "EXECUTED", executedAt: now },
    }),
    prisma.documentAccessToken.updateMany({
      where: {
        documentVersion: { documentId: request.documentId },
        revokedAt: null,
      },
      data: { revokedAt: now, revokeReason: "Document deleted" },
    }),
  ]);

  await recordEvent({
    action: "DOCUMENT_DELETED",
    targetType: "Document",
    targetId: request.documentId,
    result: "SUCCESS",
    actorUserId: params.actorUserId,
    practiceId: params.practiceId,
    reason: request.reason,
    afterMeta: {
      versionsDestroyed: versions.length,
      // The hashes are kept: they prove WHAT was destroyed without retaining
      // any of its content.
      hashes: versions.map((v) => v.sha256),
      backupNote: request.backupExpiryNote,
    },
  });

  return { versionsDestroyed: versions.length };
}

/** Convenience for callers that need the object key for a fresh upload. */
export { documentObjectKey };
