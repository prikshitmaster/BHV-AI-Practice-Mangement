/**
 * Document intake — DOC01 (PRD §15).
 *
 * "Accept permitted file types through the portal or staff upload. Record
 *  source, uploader, practice, client, engagement, period, received time and
 *  checklist link. Scan malware, validate actual MIME type, limit size and
 *  decompression, quarantine suspicious files and show actionable rejection
 *  reasons."
 *
 * Three things here are easy to get subtly wrong, so they are stated plainly:
 *
 *  1. The DECLARED content type is attacker-controlled. It is recorded as
 *     evidence, never trusted. The type is decided from the leading bytes.
 *
 *  2. "Limit size AND decompression" are different limits. A 400 KB zip that
 *     expands to 4 GB passes every size check. The expansion ratio is checked
 *     from the archive's own directory, without decompressing anything.
 *
 *  3. The scanner failing is not a pass. An unreachable scanner yields
 *     SCAN_UNAVAILABLE and the file is withheld — the alternative is that an
 *     outage becomes a bypass.
 *
 * A rejected or quarantined file never becomes a Document. It still produces a
 * DocumentIntake row: an upload that leaves no trace is how a hostile file
 * becomes invisible, and how the uploader is left with nothing actionable.
 */

import { Buffer } from "node:buffer";
import type { DocumentSource, RejectionReason, ScanVerdict } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { recordEvent } from "@/lib/audit";
import { assertPracticeAccess } from "@/lib/practice-scope";
import {
  documentObjectKey,
  quarantineObjectKey,
  putObject,
  sha256Hex,
} from "@/lib/object-store";

export class IntakeError extends Error {
  readonly status = 400;
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "IntakeError";
  }
}

/** DOC01 "permitted file types" — an allow-list, never a block-list. */
export const PERMITTED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/tiff",
  "application/zip",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/msword",
  "text/csv",
  "text/plain",
  "application/xml",
  "application/json",
] as const;

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB
/** Expanded bytes per compressed byte. 100:1 is generous for real documents. */
export const MAX_DECOMPRESSION_RATIO = 100;
export const MAX_EXPANDED_BYTES = 1024 * 1024 * 1024; // 1 GB

// ------------------------------------------------------------- MIME sniffing

type Signature = { mime: string; magic: number[]; offset?: number };

const SIGNATURES: Signature[] = [
  { mime: "application/pdf", magic: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { mime: "image/jpeg", magic: [0xff, 0xd8, 0xff] },
  { mime: "image/png", magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: "image/tiff", magic: [0x49, 0x49, 0x2a, 0x00] },
  { mime: "image/tiff", magic: [0x4d, 0x4d, 0x00, 0x2a] },
  { mime: "application/zip", magic: [0x50, 0x4b, 0x03, 0x04] },
  { mime: "application/zip", magic: [0x50, 0x4b, 0x05, 0x06] }, // empty archive
  { mime: "application/x-ole-storage", magic: [0xd0, 0xcf, 0x11, 0xe0] }, // legacy Office
];

/** OOXML containers are zip files; the member names say which one. */
const OOXML_BY_MEMBER: Array<{ member: string; mime: string }> = [
  { member: "xl/", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  { member: "word/", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
];

/**
 * Decide the type from content. Returns null when the bytes match nothing
 * known — which is a rejection, not a shrug.
 */
export function detectMimeType(body: Buffer): string | null {
  for (const sig of SIGNATURES) {
    const at = sig.offset ?? 0;
    if (body.length < at + sig.magic.length) continue;
    if (sig.magic.every((b, i) => body[at + i] === b)) {
      if (sig.mime === "application/zip") return refineZip(body);
      if (sig.mime === "application/x-ole-storage") return "application/msword";
      return sig.mime;
    }
  }
  if (looksLikeText(body)) return "text/plain";
  return null;
}

function refineZip(body: Buffer): string {
  const head = body.subarray(0, Math.min(body.length, 8192)).toString("latin1");
  for (const { member, mime } of OOXML_BY_MEMBER) {
    if (head.includes(member)) return mime;
  }
  return "application/zip";
}

function looksLikeText(body: Buffer): boolean {
  const sample = body.subarray(0, Math.min(body.length, 4096));
  if (sample.length === 0) return false;
  for (const byte of sample) {
    // Control characters other than tab / LF / CR mean this is not text.
    if (byte === 0) return false;
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) return false;
  }
  return true;
}

/**
 * Types that are interchangeable in practice, so a declared/detected mismatch
 * is not treated as hostile. Kept deliberately short — every entry here is a
 * check being relaxed.
 */
const EQUIVALENT: Record<string, string[]> = {
  "text/csv": ["text/plain"],
  "text/plain": ["text/csv", "application/xml", "application/json"],
  "application/xml": ["text/plain"],
  "application/json": ["text/plain"],
  "application/vnd.ms-excel": ["application/msword"], // both are OLE containers
  "application/msword": ["application/vnd.ms-excel"],
};

function typesAgree(declared: string, detected: string): boolean {
  if (declared === detected) return true;
  return (EQUIVALENT[declared] ?? []).includes(detected);
}

// ----------------------------------------------------- decompression limits

export type ArchiveReport = {
  isArchive: boolean;
  entries: number;
  compressedBytes: number;
  expandedBytes: number;
  ratio: number;
  encrypted: boolean;
  /** The archive claims to be one but its own directory cannot be read. */
  malformed: boolean;
};

/**
 * Reads the zip central directory only — the declared sizes are enough to spot
 * a bomb, and nothing is expanded, so inspecting the file cannot itself become
 * the denial of service being defended against.
 */
export function inspectArchive(body: Buffer): ArchiveReport {
  const none: ArchiveReport = {
    isArchive: false, entries: 0, compressedBytes: 0,
    expandedBytes: 0, ratio: 0, encrypted: false, malformed: false,
  };
  if (body.length < 4 || body.readUInt32LE(0) !== 0x04034b50) {
    if (body.length < 4 || body.readUInt32LE(0) !== 0x06054b50) return none;
  }

  // Locate the End Of Central Directory record (scan back over the comment).
  let eocd = -1;
  for (let i = body.length - 22; i >= 0 && i > body.length - 22 - 65535; i--) {
    if (body.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  // No directory means the contents cannot be enumerated, so they cannot be
  // checked either. That is a malformed archive, not an empty one.
  if (eocd < 0) return { ...none, isArchive: true, malformed: true };

  const entries = body.readUInt16LE(eocd + 10);
  let offset = body.readUInt32LE(eocd + 16);

  let compressed = 0;
  let expanded = 0;
  let encrypted = false;
  let read = 0;

  for (let n = 0; n < entries; n++) {
    if (offset + 46 > body.length) break;
    if (body.readUInt32LE(offset) !== 0x02014b50) break;

    const flags = body.readUInt16LE(offset + 8);
    if (flags & 0x0001) encrypted = true;

    compressed += body.readUInt32LE(offset + 20);
    expanded += body.readUInt32LE(offset + 24);

    const nameLen = body.readUInt16LE(offset + 28);
    const extraLen = body.readUInt16LE(offset + 30);
    const commentLen = body.readUInt16LE(offset + 32);
    offset += 46 + nameLen + extraLen + commentLen;
    read++;
  }

  const denominator = compressed > 0 ? compressed : body.length;
  return {
    isArchive: true,
    entries,
    compressedBytes: compressed,
    expandedBytes: expanded,
    ratio: denominator > 0 ? expanded / denominator : 0,
    encrypted,
    // The directory promised more entries than it actually contains, or an
    // entry header was corrupt part-way through.
    malformed: read !== entries,
  };
}

// ------------------------------------------------------------------- scanner

export type ScanResult = {
  verdict: ScanVerdict;
  scannerName: string;
  scannerVersion: string;
  signature?: string;
};

export type MalwareScanner = (body: Buffer) => Promise<ScanResult>;

/**
 * The default scanner. It is a real check, not a stub: it matches the EICAR
 * test signature, which is the standard way to prove an intake path actually
 * refuses a detected file.
 *
 * It is NOT a production anti-virus engine, and pretending otherwise would be
 * the dangerous part. `setMalwareScanner` is the seam where ClamAV (or the
 * firm's chosen engine) is attached before go-live; SECURITY.md records that
 * this is outstanding.
 *
 * So in production it does not return CLEAN at all. A deployment that has not
 * attached an engine reports SCAN_UNAVAILABLE, which holds every upload — the
 * intake path is then safe but visibly unusable, which is the right way to
 * discover a missing scanner. The alternative, a signature check for exactly
 * one known test file quietly passing everything else, would look like
 * malware scanning without being it.
 */
export const EICAR =
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

const defaultScanner: MalwareScanner = async (body) => {
  const head = body.subarray(0, Math.min(body.length, 4096)).toString("latin1");
  if (head.includes(EICAR)) {
    return {
      verdict: "INFECTED",
      scannerName: "builtin-signature",
      scannerVersion: "1",
      signature: "EICAR-Test-File",
    };
  }

  if (process.env.NODE_ENV === "production") {
    return {
      verdict: "SCAN_UNAVAILABLE",
      scannerName: "builtin-signature",
      scannerVersion: "1",
    };
  }

  return { verdict: "CLEAN", scannerName: "builtin-signature", scannerVersion: "1" };
};

let activeScanner: MalwareScanner = defaultScanner;

export function setMalwareScanner(scanner: MalwareScanner | null) {
  activeScanner = scanner ?? defaultScanner;
}

// -------------------------------------------------------------- the decision

export type IntakeVerdict = {
  accepted: boolean;
  quarantine: boolean;
  reason: RejectionReason;
  /** Actionable message shown to the uploader — says what to do, not "error". */
  detail: string | null;
  detectedMimeType: string | null;
  scan: ScanResult;
  archive: ArchiveReport;
};

const SCAN_FAILED: ScanResult = {
  verdict: "SCAN_UNAVAILABLE",
  scannerName: "unknown",
  scannerVersion: "0",
};

/**
 * Pure decision function — no database, no storage, so it can be exercised
 * directly. `validateUpload` is what the route calls; this is what it thinks.
 */
export async function assessUpload(params: {
  body: Buffer;
  filename: string;
  declaredMimeType: string;
}): Promise<IntakeVerdict> {
  const { body, filename, declaredMimeType } = params;
  const archiveNone: ArchiveReport = {
    isArchive: false, entries: 0, compressedBytes: 0,
    expandedBytes: 0, ratio: 0, encrypted: false, malformed: false,
  };

  const reject = (
    reason: RejectionReason,
    detail: string,
    extra: Partial<IntakeVerdict> = {},
  ): IntakeVerdict => ({
    accepted: false,
    quarantine: false,
    reason,
    detail,
    detectedMimeType: null,
    scan: { verdict: "PENDING", scannerName: "n/a", scannerVersion: "0" },
    archive: archiveNone,
    ...extra,
  });

  if (body.byteLength === 0) {
    return reject(
      "EMPTY_FILE",
      `"${filename}" contains no data. Check the file opens on your device, then upload it again.`,
    );
  }

  if (body.byteLength > MAX_UPLOAD_BYTES) {
    return reject(
      "TOO_LARGE",
      `"${filename}" is ${mb(body.byteLength)} MB. The limit is ${mb(MAX_UPLOAD_BYTES)} MB — ` +
        `split it into parts or send the originals through the portal's large-file request.`,
    );
  }

  const detected = detectMimeType(body);

  if (!detected || !(PERMITTED_MIME_TYPES as readonly string[]).includes(detected)) {
    return reject(
      "DISALLOWED_TYPE",
      `"${filename}" is not a permitted file type` +
        (detected ? ` (detected ${detected}).` : ".") +
        ` Accepted: PDF, JPEG, PNG, TIFF, Office documents, CSV, XML, JSON, plain text and ZIP.`,
      { detectedMimeType: detected },
    );
  }

  // DOC01 "validate actual MIME type". A mismatch is suspicious rather than a
  // flat rejection: it is often a mislabelling browser, but it is also how an
  // executable arrives dressed as a PDF — so the bytes are kept for review
  // instead of being handed back or thrown away.
  if (!typesAgree(declaredMimeType, detected)) {
    return {
      accepted: false,
      quarantine: true,
      reason: "MIME_MISMATCH",
      detail:
        `"${filename}" was sent as ${declaredMimeType} but its contents are ${detected}. ` +
        `It has been quarantined for review — re-save the file in its stated format and upload again.`,
      detectedMimeType: detected,
      scan: { verdict: "SUSPICIOUS", scannerName: "mime-check", scannerVersion: "1" },
      archive: archiveNone,
    };
  }

  const archive = inspectArchive(body);

  // DOC01 acceptance evidence: "Quarantine a malformed archive." An archive
  // whose directory cannot be read cannot be scanned either, so admitting it
  // would mean admitting unexamined contents.
  if (archive.isArchive && archive.malformed) {
    return {
      accepted: false,
      quarantine: true,
      reason: "MALFORMED_ARCHIVE",
      detail:
        `"${filename}" is a damaged archive — its contents list could not be read, ` +
        `so the files inside cannot be checked. It has been quarantined. ` +
        `Re-create the archive and upload it again, or send the files individually.`,
      detectedMimeType: detected,
      scan: { verdict: "SUSPICIOUS", scannerName: "archive-check", scannerVersion: "1" },
      archive,
    };
  }

  if (archive.isArchive && archive.encrypted) {
    return reject(
      "ENCRYPTED_ARCHIVE",
      `"${filename}" is a password-protected archive, which cannot be scanned for malware. ` +
        `Upload the files individually, or send an unencrypted archive.`,
      { detectedMimeType: detected, archive },
    );
  }

  if (
    archive.isArchive &&
    (archive.ratio > MAX_DECOMPRESSION_RATIO || archive.expandedBytes > MAX_EXPANDED_BYTES)
  ) {
    return {
      accepted: false,
      quarantine: true,
      reason: "DECOMPRESSION_LIMIT",
      detail:
        `"${filename}" declares ${mb(archive.expandedBytes)} MB of contents from ` +
        `${mb(body.byteLength)} MB of data (${Math.round(archive.ratio)}:1). ` +
        `It has been quarantined and not expanded. Send the documents individually.`,
      detectedMimeType: detected,
      scan: { verdict: "SUSPICIOUS", scannerName: "archive-check", scannerVersion: "1" },
      archive,
    };
  }

  let scan: ScanResult;
  try {
    scan = await activeScanner(body);
  } catch {
    scan = SCAN_FAILED;
  }

  if (scan.verdict === "INFECTED") {
    return {
      accepted: false,
      quarantine: true,
      reason: "MALWARE_SIGNATURE",
      detail:
        `"${filename}" was identified as malicious${scan.signature ? ` (${scan.signature})` : ""} ` +
        `and has been quarantined. Do not re-send it — check the device it came from.`,
      detectedMimeType: detected,
      scan,
      archive,
    };
  }

  // Fail closed: an outage in the scanner must not become an admission path.
  if (scan.verdict !== "CLEAN") {
    return {
      accepted: false,
      quarantine: true,
      reason: "SCANNER_UNAVAILABLE",
      detail:
        `"${filename}" could not be scanned for malware and is being held. ` +
        `It will be released automatically once scanning is available — no action needed.`,
      detectedMimeType: detected,
      scan,
      archive,
    };
  }

  return {
    accepted: true,
    quarantine: false,
    reason: "NONE",
    detail: null,
    detectedMimeType: detected,
    scan,
    archive,
  };
}

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

// ------------------------------------------------------------ recorded entry

export type IntakeContext = {
  actorUserId: string | null;
  practiceId: string;
  clientRelationshipId?: string | null;
  engagementId?: string | null;
  obligationId?: string | null;
  checklistItemId?: string | null;
  clientRequestId?: string | null;
  periodLabel?: string | null;
  source: DocumentSource;
  uploadedByContactId?: string | null;
};

export type IntakeReceipt = {
  intakeId: string;
  outcome: "ACCEPTED" | "QUARANTINED" | "REJECTED";
  reason: RejectionReason;
  detail: string | null;
  /** Present only when accepted — the caller then files it as a version. */
  storedObjectKey: string | null;
  sha256: string | null;
  detectedMimeType: string | null;
  sizeBytes: number;
};

/**
 * DOC01 accepts uploads "through the portal or staff upload" — two different
 * kinds of principal, so two different checks, and no path where neither runs.
 * Returns the practice's ORG04 document namespace.
 */
async function resolveUploadScope(ctx: IntakeContext): Promise<string> {
  if (ctx.actorUserId) {
    await assertPracticeAccess(ctx.actorUserId, ctx.practiceId);
  } else if (ctx.uploadedByContactId) {
    // A portal upload is made by a client CONTACT. Membership means nothing
    // here; what matters is a live authority to upload for THIS relationship
    // in THIS practice.
    if (!ctx.clientRelationshipId) {
      throw new IntakeError(
        "A portal upload must name the client relationship it belongs to",
        "PORTAL_UPLOAD_UNSCOPED",
      );
    }
    const now = new Date();
    const authority = await prisma.contactAuthority.findFirst({
      where: {
        contactId: ctx.uploadedByContactId,
        clientRelationshipId: ctx.clientRelationshipId,
        practiceId: ctx.practiceId,
        authority: { in: ["UPLOAD", "APPROVE", "SIGNATORY"] },
        revokedAt: null,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
      select: { id: true },
    });
    if (!authority) {
      throw new IntakeError("Not found", "PORTAL_UPLOAD_DENIED");
    }
  } else {
    // Neither a staff user nor a contact: there is no anonymous intake.
    throw new IntakeError("Unauthenticated upload", "UPLOAD_UNAUTHENTICATED");
  }

  const practice = await prisma.practice.findUnique({
    where: { id: ctx.practiceId },
    select: { documentNamespace: true },
  });
  if (!practice) throw new IntakeError("Not found", "PRACTICE_NOT_FOUND");
  return practice.documentNamespace;
}

/**
 * DOC01 end to end: assess, store (or quarantine), and record the attempt.
 * Nothing reaches the document key space until every check has passed.
 */
export async function receiveUpload(params: {
  ctx: IntakeContext;
  body: Buffer;
  filename: string;
  declaredMimeType: string;
}): Promise<IntakeReceipt> {
  const { ctx, body, filename, declaredMimeType } = params;

  // IAM01 / ORG04: scope first. An upload is a write; it cannot be the one
  // place the practice check is skipped.
  const namespace = await resolveUploadScope(ctx);

  const verdict = await assessUpload({ body, filename, declaredMimeType });
  const digest = sha256Hex(body);

  let storedObjectKey: string | null = null;
  let quarantineKey: string | null = null;

  if (verdict.accepted) {
    storedObjectKey = documentObjectKey(namespace, digest);
    await putObject({
      key: storedObjectKey,
      body,
      contentType: verdict.detectedMimeType ?? "application/octet-stream",
    });
  } else if (verdict.quarantine) {
    // Held under the quarantine prefix so it is retrievable for review but
    // unreachable from any document route.
    quarantineKey = quarantineObjectKey(namespace, digest);
    await putObject({
      key: quarantineKey,
      body,
      contentType: "application/octet-stream",
    });
  }

  const outcome = verdict.accepted
    ? "ACCEPTED"
    : verdict.quarantine
      ? "QUARANTINED"
      : "REJECTED";

  const intake = await prisma.documentIntake.create({
    data: {
      practiceId: ctx.practiceId,
      clientRelationshipId: ctx.clientRelationshipId ?? null,
      engagementId: ctx.engagementId ?? null,
      obligationId: ctx.obligationId ?? null,
      checklistItemId: ctx.checklistItemId ?? null,
      clientRequestId: ctx.clientRequestId ?? null,
      periodLabel: ctx.periodLabel ?? null,
      filename,
      declaredMimeType,
      detectedMimeType: verdict.detectedMimeType,
      sizeBytes: BigInt(body.byteLength),
      sha256: digest,
      source: ctx.source,
      uploadedByUserId: ctx.actorUserId,
      uploadedByContactId: ctx.uploadedByContactId ?? null,
      outcome,
      rejectionReason: verdict.reason,
      rejectionDetail: verdict.detail,
      scanVerdict: verdict.scan.verdict,
      scannerName: verdict.scan.scannerName,
      scannerVersion: verdict.scan.scannerVersion,
      quarantineObjectId: quarantineKey,
    },
  });

  await recordEvent({
    action: `DOCUMENT_INTAKE_${outcome}`,
    targetType: "DocumentIntake",
    targetId: intake.id,
    result: outcome === "ACCEPTED" ? "SUCCESS" : "FAILURE",
    actorUserId: ctx.actorUserId,
    practiceId: ctx.practiceId,
    reason: verdict.reason === "NONE" ? null : verdict.reason,
    // SEC04: metadata about the file, never the file. `audit.ts` truncates and
    // redacts, but the shape written here already carries no content.
    afterMeta: {
      filename,
      declaredMimeType,
      detectedMimeType: verdict.detectedMimeType,
      sizeBytes: body.byteLength,
      sha256: digest,
      scanVerdict: verdict.scan.verdict,
      archiveRatio: verdict.archive.isArchive ? Math.round(verdict.archive.ratio) : null,
      uploadedByContactId: ctx.uploadedByContactId ?? null,
    },
  });

  return {
    intakeId: intake.id,
    outcome,
    reason: verdict.reason,
    detail: verdict.detail,
    storedObjectKey,
    sha256: verdict.accepted ? digest : null,
    detectedMimeType: verdict.detectedMimeType,
    sizeBytes: body.byteLength,
  };
}
