/**
 * T11 acceptance test — DOC01-04, DOC06 (PRD §15). DOC05 is R1.
 *
 * PRD acceptance evidence, verbatim:
 *   "Upload the same filename twice and preserve both versions. Quarantine a
 *    malformed archive. Revoke a user and verify their signed object link and
 *    search results no longer work. A client can see the released report but
 *    cannot discover internal working paper titles."
 *
 * Also covers the section's closing rule: "Redaction produces a derivative
 * with a review record; visual black rectangles alone do not prove sensitive
 * content has been removed. Test hidden text, metadata, attachments and OCR
 * layers before external release."
 *
 * Library level, but NOT in-memory: every accepted upload is really written to
 * the running MinIO container and read back, because "immutable originals with
 * a cryptographic hash" is a claim about storage, not about a variable.
 *
 * All fixture data is fictional. Run: npm run test:t11
 * Requires: docker compose up -d db minio
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  EICAR,
  IntakeError,
  assessUpload,
  detectMimeType,
  inspectArchive,
  receiveUpload,
  setMalwareScanner,
} from "../src/lib/document-intake";
import {
  DocumentError,
  addToSet,
  approveDeletion,
  approveVersion,
  checkDeletionEligibility,
  createDerivative,
  decideClassification,
  executeDeletion,
  fileUpload,
  finaliseSet,
  issueAccessToken,
  listReleasedForContact,
  placeLegalHold,
  recordRedactionReview,
  redeemAccessToken,
  releaseVersion,
  requestDeletion,
  revokeRelease,
  searchDocuments,
  suggestClassification,
  verifySetManifest,
} from "../src/lib/documents";
import { ensureBucket, getObject, sha256Hex } from "../src/lib/object-store";
import { suspendUser } from "../src/lib/user-lifecycle";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  PASS  ${name}`);
    passed++;
  } else {
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

async function throws<T extends Error>(
  fn: () => Promise<unknown>,
  ctor: new (...a: never[]) => T,
): Promise<T | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof ctor ? e : null;
  }
}

const RUN = Date.now();
const tag = (s: string) => `${s}-${RUN}`;
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

// --------------------------------------------------------------- file makers

/** A structurally valid PDF header is all the sniffer needs. */
function pdf(text: string): Buffer {
  return Buffer.from(`%PDF-1.7\n% fictional test document\n${text}\n%%EOF\n`, "latin1");
}

function png(): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from("fictional png body"),
  ]);
}

type ZipEntry = { name: string; compressedSize: number; uncompressedSize: number; encrypted?: boolean };

/**
 * Builds a real zip container with the sizes we want DECLARED in its central
 * directory. Nothing is actually compressed — the point is that the intake
 * check reads the directory and never expands anything, so a bomb can be
 * detected from a few hundred bytes.
 */
function makeZip(entries: ZipEntry[], opts: { truncateDirectory?: boolean; dropEocd?: boolean } = {}): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = Buffer.from(e.name, "latin1");
    const flags = e.encrypted ? 0x0001 : 0x0000;

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt32LE(0, 14); // crc32
    local.writeUInt32LE(e.compressedSize, 18);
    local.writeUInt32LE(e.uncompressedSize, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    locals.push(local);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 16); // crc32
    central.writeUInt32LE(e.compressedSize, 20);
    central.writeUInt32LE(e.uncompressedSize, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);

    offset += local.length;
  }

  const localBlock = Buffer.concat(locals);
  // Truncation drops the LAST central-directory record entirely while the
  // end-of-directory record still claims every entry — a genuinely truncated
  // archive, not one with a slightly short trailing field.
  let centralBlock = Buffer.concat(opts.truncateDirectory ? centrals.slice(0, -1) : centrals);

  if (opts.dropEocd) return Buffer.concat([localBlock, centralBlock]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBlock.length, 12);
  eocd.writeUInt32LE(localBlock.length, 16);

  return Buffer.concat([localBlock, centralBlock, eocd]);
}

// ============================================================================

async function main() {
  console.log("\nT11 — document management and evidence custody (PRD §15 DOC01-04, DOC06)\n");

  await ensureBucket();
  setMalwareScanner(null); // start from the built-in signature scanner

  // ------------------------------------------------------------- fixtures
  const tenant = await prisma.tenant.create({ data: { name: tag("T") } });

  const company = await prisma.practice.create({
    data: {
      tenantId: tenant.id, name: tag("Company"), constitution: "LLP",
      documentNamespace: tag("co"), effectiveFrom: d("2024-04-01"),
    },
  });
  const associates = await prisma.practice.create({
    data: {
      tenantId: tenant.id, name: tag("Associates"), constitution: "PARTNERSHIP",
      documentNamespace: tag("as"), effectiveFrom: d("2024-04-01"),
    },
  });

  const partner = await prisma.user.create({
    data: { email: `partner-${RUN}@example.invalid`, fullName: "Fictional Partner", status: "ACTIVE" },
  });
  const reviewer = await prisma.user.create({
    data: { email: `reviewer-${RUN}@example.invalid`, fullName: "Fictional Reviewer", status: "ACTIVE" },
  });
  const article = await prisma.user.create({
    data: { email: `article-${RUN}@example.invalid`, fullName: "Fictional Article", status: "ACTIVE" },
  });
  const leaver = await prisma.user.create({
    data: { email: `leaver-${RUN}@example.invalid`, fullName: "Fictional Leaver", status: "ACTIVE" },
  });
  const outsider = await prisma.user.create({
    data: { email: `outsider-${RUN}@example.invalid`, fullName: "Associates Only User", status: "ACTIVE" },
  });

  await prisma.practiceMembership.createMany({
    data: [
      { practiceId: company.id, userId: partner.id, role: "PRACTICE_PARTNER", assignmentScope: "PRACTICE", effectiveFrom: d("2024-04-01") },
      { practiceId: company.id, userId: reviewer.id, role: "REVIEWER", assignmentScope: "PRACTICE", effectiveFrom: d("2024-04-01") },
      { practiceId: company.id, userId: article.id, role: "STAFF_ARTICLE", assignmentScope: "OWN_WORK", effectiveFrom: d("2024-04-01") },
      { practiceId: company.id, userId: leaver.id, role: "MANAGER", assignmentScope: "PRACTICE", effectiveFrom: d("2024-04-01") },
      { practiceId: associates.id, userId: outsider.id, role: "MANAGER", assignmentScope: "PRACTICE", effectiveFrom: d("2024-04-01") },
    ],
  });

  const party = await prisma.party.create({
    data: { tenantId: tenant.id, legalName: tag("Fictional Client Limited"), type: "COMPANY" },
  });
  const rel = await prisma.clientRelationship.create({
    data: { practiceId: company.id, partyId: party.id, acceptanceStatus: "ACCEPTED", acceptedAt: new Date() },
  });

  const cfo = await prisma.contact.create({
    data: { partyId: party.id, fullName: "Fictional CFO", email: `cfo-${RUN}@example.invalid`, designation: "CFO" },
  });
  const strangerContact = await prisma.contact.create({
    data: { partyId: party.id, fullName: "Unauthorised Person", email: `stranger-${RUN}@example.invalid` },
  });
  await prisma.contactAuthority.create({
    data: {
      practiceId: company.id, contactId: cfo.id, clientRelationshipId: rel.id,
      authority: "APPROVE", effectiveFrom: d("2024-04-01"),
    },
  });

  const staffCtx = (userId: string, extra: Record<string, unknown> = {}) => ({
    actorUserId: userId,
    practiceId: company.id,
    clientRelationshipId: rel.id,
    source: "STAFF_UPLOAD" as const,
    ...extra,
  });

  // ====================================================================
  console.log("DOC01 — intake: type validation");

  check("PDF is detected from its magic bytes", detectMimeType(pdf("x")) === "application/pdf");
  check("PNG is detected from its magic bytes", detectMimeType(png()) === "image/png");
  check(
    "an unrecognised binary is detected as nothing, not guessed",
    detectMimeType(Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04])) === null,
  );

  const exeDressedAsPdf = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(64, 0)]);
  const exeVerdict = await assessUpload({
    body: exeDressedAsPdf, filename: "invoice.pdf", declaredMimeType: "application/pdf",
  });
  check(
    "an executable renamed .pdf is refused (the declared type is not trusted)",
    !exeVerdict.accepted && exeVerdict.reason === "DISALLOWED_TYPE",
    `reason=${exeVerdict.reason}`,
  );

  const mismatch = await assessUpload({
    body: png(), filename: "statement.pdf", declaredMimeType: "application/pdf",
  });
  check(
    "a declared/detected MIME mismatch is QUARANTINED, not silently accepted",
    !mismatch.accepted && mismatch.quarantine && mismatch.reason === "MIME_MISMATCH",
    `reason=${mismatch.reason}`,
  );
  check(
    "the mismatch message tells the uploader what to do",
    (mismatch.detail ?? "").includes("statement.pdf") && /upload again/i.test(mismatch.detail ?? ""),
    mismatch.detail ?? "(none)",
  );

  const empty = await assessUpload({ body: Buffer.alloc(0), filename: "blank.pdf", declaredMimeType: "application/pdf" });
  check("an empty file is refused", !empty.accepted && empty.reason === "EMPTY_FILE");

  // ====================================================================
  console.log("\nDOC01 — intake: archives (the headline evidence)");

  const goodZip = makeZip([{ name: "ledger.csv", compressedSize: 400, uncompressedSize: 1200 }]);
  const goodZipReport = inspectArchive(goodZip);
  check(
    "a well-formed archive reads as an archive with a sane ratio",
    goodZipReport.isArchive && !goodZipReport.malformed && goodZipReport.ratio === 3,
    `ratio=${goodZipReport.ratio} malformed=${goodZipReport.malformed}`,
  );

  const bombZip = makeZip([{ name: "big.bin", compressedSize: 500, uncompressedSize: 900_000_000 }]);
  const bomb = await assessUpload({ body: bombZip, filename: "records.zip", declaredMimeType: "application/zip" });
  check(
    "a decompression bomb is quarantined on its DECLARED ratio, without expanding it",
    !bomb.accepted && bomb.quarantine && bomb.reason === "DECOMPRESSION_LIMIT",
    `reason=${bomb.reason}`,
  );
  check(
    "the bomb is caught from a few hundred bytes (nothing was expanded)",
    bombZip.byteLength < 2000,
    `${bombZip.byteLength} bytes`,
  );

  // *** PRD evidence 2: quarantine a malformed archive ***
  const noDirectory = makeZip([{ name: "a.txt", compressedSize: 10, uncompressedSize: 10 }], { dropEocd: true });
  const malformed1 = await assessUpload({
    body: noDirectory, filename: "backup.zip", declaredMimeType: "application/zip",
  });
  check(
    "EVIDENCE 2a — an archive with no central directory is QUARANTINED as malformed",
    !malformed1.accepted && malformed1.quarantine && malformed1.reason === "MALFORMED_ARCHIVE",
    `reason=${malformed1.reason}`,
  );

  const truncated = makeZip(
    [
      { name: "a.txt", compressedSize: 10, uncompressedSize: 10 },
      { name: "b.txt", compressedSize: 10, uncompressedSize: 10 },
    ],
    { truncateDirectory: true },
  );
  const malformed2 = await assessUpload({
    body: truncated, filename: "partial.zip", declaredMimeType: "application/zip",
  });
  check(
    "EVIDENCE 2b — an archive whose directory promises more entries than it holds is QUARANTINED",
    !malformed2.accepted && malformed2.quarantine && malformed2.reason === "MALFORMED_ARCHIVE",
    `reason=${malformed2.reason}`,
  );
  check(
    "the malformed-archive message says the contents could not be checked",
    /could not be read/i.test(malformed2.detail ?? ""),
    malformed2.detail ?? "(none)",
  );

  const encrypted = makeZip([{ name: "secret.pdf", compressedSize: 100, uncompressedSize: 200, encrypted: true }]);
  const encVerdict = await assessUpload({
    body: encrypted, filename: "locked.zip", declaredMimeType: "application/zip",
  });
  check(
    "a password-protected archive is refused because it cannot be scanned",
    !encVerdict.accepted && encVerdict.reason === "ENCRYPTED_ARCHIVE",
    `reason=${encVerdict.reason}`,
  );

  // ====================================================================
  console.log("\nDOC01 — intake: malware and scanner failure");

  const infected = Buffer.from(`%PDF-1.7\n${EICAR}\n`, "latin1");
  const infectedVerdict = await assessUpload({
    body: infected, filename: "eicar.pdf", declaredMimeType: "application/pdf",
  });
  check(
    "a detected signature quarantines the file",
    !infectedVerdict.accepted && infectedVerdict.quarantine && infectedVerdict.reason === "MALWARE_SIGNATURE",
    `reason=${infectedVerdict.reason}`,
  );

  setMalwareScanner(async () => {
    throw new Error("scanner container is down");
  });
  const unscanned = await assessUpload({
    body: pdf("clean enough"), filename: "audit.pdf", declaredMimeType: "application/pdf",
  });
  check(
    "a scanner outage HOLDS the file — an outage is never an admission path",
    !unscanned.accepted && unscanned.reason === "SCANNER_UNAVAILABLE",
    `reason=${unscanned.reason}`,
  );
  setMalwareScanner(null);

  // The built-in signature check must not masquerade as an AV engine in
  // production. With no real scanner attached it holds everything, so a
  // deployment that forgot to wire one in is obvious rather than silently
  // unprotected.
  const realEnv = process.env.NODE_ENV;
  const env = process.env as Record<string, string | undefined>;
  env.NODE_ENV = "production";
  const prodUnscanned = await assessUpload({
    body: pdf("would be admitted in dev"), filename: "audit.pdf", declaredMimeType: "application/pdf",
  });
  env.NODE_ENV = realEnv;
  check(
    "in production the built-in scanner refuses to pass files it has not really scanned",
    !prodUnscanned.accepted && prodUnscanned.reason === "SCANNER_UNAVAILABLE",
    `reason=${prodUnscanned.reason}`,
  );
  check(
    "and the same file IS accepted in development, so the difference is the environment",
    (await assessUpload({
      body: pdf("would be admitted in dev"), filename: "audit.pdf", declaredMimeType: "application/pdf",
    })).accepted,
  );

  // ====================================================================
  console.log("\nDOC01 — intake: recorded attempts and scope");

  const quarantined = await receiveUpload({
    ctx: staffCtx(partner.id),
    body: infected,
    filename: "eicar.pdf",
    declaredMimeType: "application/pdf",
  });
  check("a quarantined upload still produces an intake record", Boolean(quarantined.intakeId));
  check("a quarantined upload is NOT filed as a document", quarantined.storedObjectKey === null);

  const quarantineRow = await prisma.documentIntake.findUniqueOrThrow({
    where: { id: quarantined.intakeId },
  });
  check(
    "the quarantine record holds provenance: uploader, practice, client, source, received time",
    quarantineRow.uploadedByUserId === partner.id &&
      quarantineRow.practiceId === company.id &&
      quarantineRow.clientRelationshipId === rel.id &&
      quarantineRow.source === "STAFF_UPLOAD" &&
      quarantineRow.receivedAt instanceof Date,
  );
  check(
    "the quarantined bytes are held under the quarantine prefix, not the document prefix",
    (quarantineRow.quarantineObjectId ?? "").includes("/quarantine/") &&
      !(quarantineRow.quarantineObjectId ?? "").includes("/documents/"),
    quarantineRow.quarantineObjectId ?? "(none)",
  );
  check("no Document row exists for the quarantined file", quarantineRow.documentId === null);

  const crossPractice = await throws(
    () =>
      receiveUpload({
        // The Associates-only user naming the Company practice.
        ctx: { ...staffCtx(outsider.id) },
        body: pdf("cross practice"),
        filename: "sneak.pdf",
        declaredMimeType: "application/pdf",
      }),
    Error,
  );
  check(
    "an out-of-practice user cannot upload into another firm",
    crossPractice !== null && crossPractice.name === "PracticeAccessError",
    crossPractice?.name ?? "(no error)",
  );

  const anon = await throws(
    () =>
      receiveUpload({
        ctx: { actorUserId: null, practiceId: company.id, source: "PORTAL_UPLOAD" },
        body: pdf("anon"),
        filename: "anon.pdf",
        declaredMimeType: "application/pdf",
      }),
    IntakeError,
  );
  check("there is no anonymous intake path", anon?.code === "UPLOAD_UNAUTHENTICATED", anon?.code);

  const strangerUpload = await throws(
    () =>
      receiveUpload({
        ctx: {
          actorUserId: null, practiceId: company.id, clientRelationshipId: rel.id,
          source: "PORTAL_UPLOAD", uploadedByContactId: strangerContact.id,
        },
        body: pdf("stranger"),
        filename: "stranger.pdf",
        declaredMimeType: "application/pdf",
      }),
    IntakeError,
  );
  check(
    "a portal upload from a contact with no upload authority is refused",
    strangerUpload?.code === "PORTAL_UPLOAD_DENIED",
    strangerUpload?.code,
  );

  // ====================================================================
  console.log("\nDOC02 — versioning (the headline evidence)");

  const v1Bytes = pdf("bank statement, first attempt");
  const r1 = await receiveUpload({
    ctx: staffCtx(article.id),
    body: v1Bytes,
    filename: "bank-statement.pdf",
    declaredMimeType: "application/pdf",
  });
  check("a clean PDF is accepted", r1.outcome === "ACCEPTED", `${r1.outcome} ${r1.detail ?? ""}`);

  const filed1 = await fileUpload({
    actorUserId: article.id,
    practiceId: company.id,
    receipt: r1,
    filename: "bank-statement.pdf",
    title: "Bank statement",
    clientRelationshipId: rel.id,
    documentType: "BANK_STATEMENT",
    periodLabel: "FY 2025-26",
    kind: "CLIENT_SUPPLIED",
  });
  check("first upload becomes version 1", filed1.version.versionNo === 1);

  // *** PRD evidence 1: same filename twice, both versions preserved ***
  const v2Bytes = pdf("bank statement, corrected");
  const r2 = await receiveUpload({
    ctx: staffCtx(article.id),
    body: v2Bytes,
    filename: "bank-statement.pdf",
    declaredMimeType: "application/pdf",
  });
  const filed2 = await fileUpload({
    actorUserId: article.id,
    practiceId: company.id,
    receipt: r2,
    filename: "bank-statement.pdf",
    clientRelationshipId: rel.id,
  });

  check(
    "EVIDENCE 1a — the same filename resolves to the SAME document",
    filed2.document.id === filed1.document.id,
  );
  check("EVIDENCE 1b — the second upload becomes version 2", filed2.version.versionNo === 2);

  const bothVersions = await prisma.documentVersion.findMany({
    where: { documentId: filed1.document.id },
    orderBy: { versionNo: "asc" },
  });
  check("EVIDENCE 1c — BOTH versions exist", bothVersions.length === 2, `found ${bothVersions.length}`);
  check(
    "EVIDENCE 1d — they are stored under DIFFERENT object keys, so nothing was overwritten",
    bothVersions[0].storageObjectId !== bothVersions[1].storageObjectId,
  );
  check(
    "EVIDENCE 1e — version 1's ORIGINAL BYTES are still retrievable from the store",
    (await getObject(bothVersions[0].storageObjectId))?.equals(v1Bytes) === true,
  );
  check(
    "EVIDENCE 1f — and they are still the bytes that were uploaded (hash matches)",
    bothVersions[0].sha256 === sha256Hex(v1Bytes) && bothVersions[1].sha256 === sha256Hex(v2Bytes),
  );
  check(
    "version 1 is marked superseded rather than removed",
    bothVersions[0].status === "SUPERSEDED" && bothVersions[0].supersededAt !== null,
  );

  // Preparer / reviewer / status.
  const selfApprove = await throws(
    () => approveVersion({ actorUserId: article.id, practiceId: company.id, versionId: filed2.version.id }),
    Error,
  );
  check(
    "the preparer cannot approve their own version (IAM04)",
    selfApprove !== null &&
      (selfApprove.name === "DocumentError" || selfApprove.name === "PermissionDeniedError"),
    selfApprove?.name ?? "(no error)",
  );

  const approvedV2 = await approveVersion({
    actorUserId: reviewer.id, practiceId: company.id, versionId: filed2.version.id, note: "Checked against ledger",
  });
  check(
    "an independent reviewer can approve, and the approver's NAME is snapshotted",
    approvedV2.status === "APPROVED" && approvedV2.approvedByUserName === "Fictional Reviewer",
  );

  // "Never overwrite an approved original through ... OCR ..., conversion or
  // integration retry."
  const ocrBytes = pdf("bank statement, corrected + OCR text layer");
  const ocrVersion = await createDerivative({
    actorUserId: article.id,
    practiceId: company.id,
    sourceVersionId: filed2.version.id,
    derivation: "OCR",
    storageObjectId: `${tag("co")}/documents/aa/bb/${sha256Hex(ocrBytes)}`,
    sha256: sha256Hex(ocrBytes),
    mimeType: "application/pdf",
    sizeBytes: ocrBytes.byteLength,
  });
  const sourceAfterOcr = await prisma.documentVersion.findUniqueOrThrow({
    where: { id: filed2.version.id },
  });
  check(
    "an OCR pass creates a NEW version instead of rewriting the approved original",
    ocrVersion.versionNo === 3 && ocrVersion.derivedFromVersionId === filed2.version.id,
  );
  check(
    "the approved original is byte-identical afterwards (hash, key and approval untouched)",
    sourceAfterOcr.sha256 === approvedV2.sha256 &&
      sourceAfterOcr.storageObjectId === approvedV2.storageObjectId &&
      sourceAfterOcr.approvedByUserName === "Fictional Reviewer" &&
      sourceAfterOcr.approvedAt?.getTime() === approvedV2.approvedAt?.getTime(),
  );

  const noopDerivative = await throws(
    () =>
      createDerivative({
        actorUserId: article.id,
        practiceId: company.id,
        sourceVersionId: filed2.version.id,
        derivation: "REDACTION",
        storageObjectId: filed2.version.storageObjectId,
        sha256: filed2.version.sha256,
        mimeType: "application/pdf",
        sizeBytes: 10,
      }),
    DocumentError,
  );
  check(
    "a derivative identical to its source is refused — a redaction that removed nothing",
    noopDerivative?.code === "DERIVATIVE_UNCHANGED",
    noopDerivative?.code,
  );

  // ====================================================================
  console.log("\nDOC03 — classification and search");

  const draft = await suggestClassification({
    practiceId: company.id,
    documentVersionId: filed2.version.id,
    field: "documentType",
    value: "BANK_STATEMENT_OCR_GUESS",
    confidence: 0.62,
    producedBy: "OCR",
    modelVersion: "tesseract-5",
    sourceReference: "page 1, line 3",
  });
  check(
    "an OCR classification lands as DRAFT with its source reference",
    draft.status === "DRAFT" && draft.sourceReference === "page 1, line 3" && draft.producedBy === "OCR",
  );

  const docBeforeDecision = await prisma.document.findUniqueOrThrow({ where: { id: filed1.document.id } });
  check(
    "a draft classification does NOT write itself onto the document",
    docBeforeDecision.documentType === "BANK_STATEMENT",
  );

  const corrected = await decideClassification({
    actorUserId: reviewer.id,
    practiceId: company.id,
    classificationId: draft.id,
    decision: "CORRECT",
    correctedValue: "BANK_STATEMENT",
    reason: "OCR read the header wrong",
  });
  const originalDraft = await prisma.documentClassification.findUniqueOrThrow({ where: { id: draft.id } });
  check(
    "a correction writes a NEW row pointing at what it replaced (correction history)",
    corrected.supersedesId === draft.id && corrected.producedBy === "HUMAN",
  );
  check(
    "the machine's original suggestion is retained, marked CORRECTED",
    originalDraft.status === "CORRECTED" && originalDraft.value === "BANK_STATEMENT_OCR_GUESS",
  );

  // A protected internal working paper, in the Company practice.
  const wpBytes = pdf("internal audit working paper — sampling memo");
  const wpReceipt = await receiveUpload({
    ctx: staffCtx(partner.id),
    body: wpBytes,
    filename: "sampling-memo.pdf",
    declaredMimeType: "application/pdf",
  });
  const workingPaper = await fileUpload({
    actorUserId: partner.id,
    practiceId: company.id,
    receipt: wpReceipt,
    filename: "sampling-memo.pdf",
    title: tag("Zephyr audit sampling memo"),
    clientRelationshipId: rel.id,
    kind: "INTERNAL",
    workingPaper: true,
    documentType: "WORKING_PAPER",
  });

  const partnerSearch = await searchDocuments({ actorUserId: partner.id, query: "Zephyr" });
  check(
    "a working paper is invisible without the IAM03 protected-workpaper grant, even to a partner",
    partnerSearch.totalCount === 0 && partnerSearch.results.length === 0,
    `count=${partnerSearch.totalCount}`,
  );
  check(
    "and the COUNT is zero too — not 'n results you may not open'",
    partnerSearch.totalCount === 0 && partnerSearch.suggestions.length === 0,
  );

  await prisma.permissionGrant.create({
    data: {
      membershipId: (await prisma.practiceMembership.findFirstOrThrow({
        where: { userId: partner.id, practiceId: company.id },
      })).id,
      practiceId: company.id,
      permission: "PROTECTED_WORKPAPERS",
      grantedByUserId: partner.id,
      grantedByName: "Fictional Partner",
      reason: "Engagement partner on this audit",
      effectiveFrom: d("2024-04-01"),
    },
  });
  const partnerSearchGranted = await searchDocuments({ actorUserId: partner.id, query: "Zephyr" });
  check(
    "with the explicit grant, the same search returns the working paper",
    partnerSearchGranted.totalCount === 1,
    `count=${partnerSearchGranted.totalCount}`,
  );

  const outsiderSearch = await searchDocuments({ actorUserId: outsider.id, query: "Zephyr" });
  check(
    "an Associates-only user searching finds nothing of the Company's",
    outsiderSearch.totalCount === 0 && outsiderSearch.suggestions.length === 0,
  );
  const outsiderScoped = await throws(
    () => searchDocuments({ actorUserId: outsider.id, query: "Zephyr", practiceId: company.id }),
    Error,
  );
  check(
    "naming another firm's practiceId in the search is refused, not silently widened",
    outsiderScoped?.name === "PracticeAccessError",
    outsiderScoped?.name ?? "(no error)",
  );

  const nobody = await prisma.user.create({
    data: { email: `nobody-${RUN}@example.invalid`, fullName: "No Memberships", status: "ACTIVE" },
  });
  const nobodySearch = await searchDocuments({ actorUserId: nobody.id, query: "bank" });
  check(
    "a user with no memberships gets nothing, never everything",
    nobodySearch.totalCount === 0 && nobodySearch.results.length === 0,
  );

  // ====================================================================
  console.log("\nDOC04 — release and sharing");

  const reportBytes = pdf("audit report for the client — final");
  const reportReceipt = await receiveUpload({
    ctx: staffCtx(article.id),
    body: reportBytes,
    filename: "audit-report.pdf",
    declaredMimeType: "application/pdf",
  });
  const report = await fileUpload({
    actorUserId: article.id,
    practiceId: company.id,
    receipt: reportReceipt,
    filename: "audit-report.pdf",
    title: tag("Zephyr audit report"),
    clientRelationshipId: rel.id,
    kind: "APPROVED_DELIVERABLE",
    documentType: "AUDIT_REPORT",
  });

  const unapproved = await throws(
    () =>
      releaseVersion({
        actorUserId: reviewer.id, practiceId: company.id,
        versionId: report.version.id, contactIds: [cfo.id],
      }),
    DocumentError,
  );
  check(
    "an unapproved version cannot be released",
    unapproved?.code === "VERSION_NOT_APPROVED",
    unapproved?.code,
  );

  await approveVersion({ actorUserId: reviewer.id, practiceId: company.id, versionId: report.version.id });

  const wpApproved = await approveVersion({
    actorUserId: reviewer.id, practiceId: company.id, versionId: workingPaper.version.id,
  });
  const wpRelease = await throws(
    () =>
      releaseVersion({
        actorUserId: reviewer.id, practiceId: company.id,
        versionId: wpApproved.id, contactIds: [cfo.id],
      }),
    DocumentError,
  );
  check(
    "an internal working paper is NOT automatically a client deliverable",
    wpRelease?.code === "NOT_A_DELIVERABLE",
    wpRelease?.code,
  );

  const unauthorisedRecipient = await throws(
    () =>
      releaseVersion({
        actorUserId: reviewer.id, practiceId: company.id,
        versionId: report.version.id, contactIds: [cfo.id, strangerContact.id],
      }),
    DocumentError,
  );
  check(
    "a release naming a contact with no authority is refused outright",
    unauthorisedRecipient?.code === "RECIPIENT_NOT_AUTHORISED",
    unauthorisedRecipient?.code,
  );

  const articleRelease = await throws(
    () =>
      releaseVersion({
        actorUserId: article.id, practiceId: company.id,
        versionId: report.version.id, contactIds: [cfo.id],
      }),
    Error,
  );
  check(
    "an article cannot release to a client",
    articleRelease?.name === "PermissionDeniedError",
    articleRelease?.name ?? "(no error)",
  );

  const release = await releaseVersion({
    actorUserId: reviewer.id,
    practiceId: company.id,
    versionId: report.version.id,
    contactIds: [cfo.id],
    reason: "Signed report issued to the client",
  });
  check("a reviewer releases the exact version to a named contact", release.recipients.length === 1);
  check(
    "the recipient's name at the time of release is snapshotted (DAT02)",
    release.recipients[0].contactNameAtRelease === "Fictional CFO",
  );

  const releaseEvent = await prisma.event.findFirstOrThrow({
    where: { action: "DOCUMENT_RELEASED", targetId: report.version.id },
  });
  check(
    "the audit trail records the EXACT version released (SEC04)",
    releaseEvent.targetVersion === report.version.versionNo,
    `targetVersion=${releaseEvent.targetVersion}`,
  );

  // *** PRD evidence 4: the client sees the released report, not the papers ***
  const clientView = await listReleasedForContact({ contactId: cfo.id });
  check(
    "EVIDENCE 4a — the client can see the released report",
    clientView.length === 1 && clientView[0].documentId === report.document.id,
    `${clientView.length} item(s)`,
  );
  const clientTitles = clientView.map((c) => c.title).join(" | ");
  check(
    "EVIDENCE 4b — the internal working paper's TITLE never appears in the client's view",
    !clientTitles.includes("sampling memo") && !clientTitles.includes("Zephyr audit sampling"),
    clientTitles,
  );
  check(
    "EVIDENCE 4c — and neither does the client-supplied bank statement, which was never released",
    !clientTitles.includes("Bank statement"),
    clientTitles,
  );

  const strangerView = await listReleasedForContact({ contactId: strangerContact.id });
  check(
    "a contact who was not named on the release sees nothing",
    strangerView.length === 0,
    `${strangerView.length} item(s)`,
  );

  // Links.
  const clientLink = await issueAccessToken({
    practiceId: company.id,
    documentVersionId: report.version.id,
    releaseId: release.id,
    issuedToContactId: cfo.id,
    issuedByUserId: reviewer.id,
    purpose: "CLIENT_DELIVERABLE",
  });
  const redeemed = await redeemAccessToken({ token: clientLink.token });
  check("the client's link resolves to the released version", redeemed.documentVersionId === report.version.id);
  check(
    "and the bytes behind it are the ones that were approved",
    (await getObject(redeemed.storageObjectId))?.equals(reportBytes) === true,
  );

  const storedToken = await prisma.documentAccessToken.findUniqueOrThrow({ where: { id: clientLink.tokenId } });
  check(
    "only the token's HASH is stored — a leaked row is not a working link",
    storedToken.tokenHash !== clientLink.token && storedToken.tokenHash.length === 64,
  );

  const expiredLink = await issueAccessToken({
    practiceId: company.id, documentVersionId: report.version.id, releaseId: release.id,
    issuedToContactId: cfo.id, purpose: "CLIENT_DELIVERABLE", ttlMs: -1000,
  });
  const expiredRedeem = await throws(() => redeemAccessToken({ token: expiredLink.token }), DocumentError);
  check("an expired link is refused", expiredRedeem?.code === "LINK_INVALID", expiredRedeem?.code);
  check(
    "and the refusal is a bare 404 — it does not confirm the document exists",
    expiredRedeem?.status === 404 && expiredRedeem.message === "Not found",
  );

  const bogus = await throws(() => redeemAccessToken({ token: "not-a-real-token" }), DocumentError);
  check(
    "an unknown token and an expired token give the SAME answer",
    bogus?.status === 404 && bogus.message === expiredRedeem?.message,
  );

  // Revoking the release kills a live link immediately.
  const preRevokeLink = await issueAccessToken({
    practiceId: company.id, documentVersionId: report.version.id, releaseId: release.id,
    issuedToContactId: cfo.id, purpose: "CLIENT_DELIVERABLE",
  });
  check(
    "the link works before revocation",
    (await redeemAccessToken({ token: preRevokeLink.token })).documentVersionId === report.version.id,
  );
  await revokeRelease({
    actorUserId: reviewer.id, practiceId: company.id, releaseId: release.id,
    reason: "Report reissued after a correction",
  });
  const afterRevoke = await throws(() => redeemAccessToken({ token: preRevokeLink.token }), DocumentError);
  check(
    "revoking the release stops an ALREADY-ISSUED link on its next use",
    afterRevoke?.code === "LINK_INVALID",
    afterRevoke?.code,
  );
  const clientViewAfterRevoke = await listReleasedForContact({ contactId: cfo.id });
  check(
    "and the document disappears from the client's portal list",
    clientViewAfterRevoke.length === 0,
    `${clientViewAfterRevoke.length} item(s)`,
  );

  // Revoking a contact's authority also kills their links.
  const release2 = await releaseVersion({
    actorUserId: reviewer.id, practiceId: company.id, versionId: report.version.id,
    contactIds: [cfo.id], reason: "Reissue",
  });
  const cfoLink = await issueAccessToken({
    practiceId: company.id, documentVersionId: report.version.id, releaseId: release2.id,
    issuedToContactId: cfo.id, purpose: "CLIENT_DELIVERABLE",
  });
  check(
    "the reissued link works",
    (await redeemAccessToken({ token: cfoLink.token })).versionNo === report.version.versionNo,
  );
  await prisma.contactAuthority.updateMany({
    where: { contactId: cfo.id, clientRelationshipId: rel.id },
    data: { revokedAt: new Date() },
  });
  const afterAuthorityRevoke = await throws(() => redeemAccessToken({ token: cfoLink.token }), DocumentError);
  check(
    "revoking the contact's authority breaks their existing link on the next use",
    afterAuthorityRevoke?.code === "LINK_INVALID",
    afterAuthorityRevoke?.code,
  );

  // ====================================================================
  console.log("\nDOC04 — redaction (black rectangles are not proof)");

  const redactedBytes = pdf("audit report — client copy with fee detail removed");
  const redacted = await createDerivative({
    actorUserId: article.id,
    practiceId: company.id,
    sourceVersionId: report.version.id,
    derivation: "REDACTION",
    storageObjectId: `${tag("co")}/documents/cc/dd/${sha256Hex(redactedBytes)}`,
    sha256: sha256Hex(redactedBytes),
    mimeType: "application/pdf",
    sizeBytes: redactedBytes.byteLength,
    filename: "audit-report-redacted.pdf",
  });
  await approveVersion({ actorUserId: reviewer.id, practiceId: company.id, versionId: redacted.id });

  await prisma.contactAuthority.create({
    data: {
      practiceId: company.id, contactId: cfo.id, clientRelationshipId: rel.id,
      authority: "VIEW_ONLY", effectiveFrom: new Date(Date.now() - 1000),
    },
  });

  const unreviewedRedaction = await throws(
    () =>
      releaseVersion({
        actorUserId: reviewer.id, practiceId: company.id,
        versionId: redacted.id, contactIds: [cfo.id],
      }),
    DocumentError,
  );
  check(
    "a redacted derivative cannot be released without a review record",
    unreviewedRedaction?.code === "REDACTION_UNVERIFIED",
    unreviewedRedaction?.code,
  );

  await recordRedactionReview({
    actorUserId: reviewer.id,
    practiceId: company.id,
    versionId: redacted.id,
    method: "Content removed and re-rendered, not overlaid",
    checkedHiddenText: true,
    checkedMetadata: true,
    checkedAttachments: true,
    checkedOcrLayer: false, // deliberately incomplete
    conclusion: "OCR layer still to be checked",
  });
  const partialReview = await throws(
    () =>
      releaseVersion({
        actorUserId: reviewer.id, practiceId: company.id,
        versionId: redacted.id, contactIds: [cfo.id],
      }),
    DocumentError,
  );
  check(
    "a PARTIAL review is still refused — the OCR layer alone blocks release",
    partialReview?.code === "REDACTION_UNVERIFIED",
    partialReview?.code,
  );

  await prisma.redactionReview.updateMany({
    where: { documentVersionId: redacted.id },
    data: { checkedOcrLayer: true, conclusion: "Hidden text, metadata, attachments and OCR layer all checked" },
  });
  const redactedRelease = await releaseVersion({
    actorUserId: reviewer.id, practiceId: company.id,
    versionId: redacted.id, contactIds: [cfo.id], reason: "Redacted client copy",
  });
  check(
    "with all four checks confirmed, the redacted derivative can be released",
    redactedRelease.documentVersionId === redacted.id,
  );

  const sourceAfterRedaction = await prisma.documentVersion.findUniqueOrThrow({
    where: { id: report.version.id },
  });
  check(
    "and the unredacted original is untouched by the redaction",
    sourceAfterRedaction.sha256 === report.version.sha256 &&
      sourceAfterRedaction.storageObjectId === report.version.storageObjectId,
  );

  const reviewOnOriginal = await throws(
    () =>
      recordRedactionReview({
        actorUserId: reviewer.id, practiceId: company.id, versionId: report.version.id,
        method: "n/a", checkedHiddenText: true, checkedMetadata: true,
        checkedAttachments: true, checkedOcrLayer: true, conclusion: "n/a",
      }),
    DocumentError,
  );
  check(
    "a redaction review cannot be attached to an original to fake one",
    reviewOnOriginal?.code === "NOT_A_REDACTION",
    reviewOnOriginal?.code,
  );

  // ====================================================================
  console.log("\nEVIDENCE 3 — revoking a user kills their link AND their search results");

  const leaverReceipt = await receiveUpload({
    ctx: staffCtx(leaver.id),
    body: pdf("manager's own note"),
    filename: "handover-note.pdf",
    declaredMimeType: "application/pdf",
  });
  await fileUpload({
    actorUserId: leaver.id,
    practiceId: company.id,
    receipt: leaverReceipt,
    filename: "handover-note.pdf",
    title: tag("Quokka handover note"),
    clientRelationshipId: rel.id,
  });

  const leaverSearchBefore = await searchDocuments({ actorUserId: leaver.id, query: "Quokka" });
  check(
    "before suspension the manager's search returns their document",
    leaverSearchBefore.totalCount === 1,
    `count=${leaverSearchBefore.totalCount}`,
  );

  const leaverLink = await issueAccessToken({
    practiceId: company.id,
    documentVersionId: report.version.id,
    issuedToUserId: leaver.id,
    issuedByUserId: leaver.id,
    purpose: "STAFF_ACCESS",
    ttlMs: 60 * 60 * 1000, // deliberately long-lived
  });
  const leaverRedeemBefore = await redeemAccessToken({ token: leaverLink.token });
  check("and their object link works", leaverRedeemBefore.documentVersionId === report.version.id);

  const suspension = await suspendUser({
    actorUserId: partner.id,
    actorName: "Fictional Partner",
    userId: leaver.id,
    reason: "Left the firm",
  });

  const leaverRedeemAfter = await throws(() => redeemAccessToken({ token: leaverLink.token }), DocumentError);
  check(
    "EVIDENCE 3a — the suspended user's signed object link stops working IMMEDIATELY",
    leaverRedeemAfter?.code === "LINK_INVALID",
    leaverRedeemAfter?.code,
  );
  check(
    "EVIDENCE 3b — the link was still 59 minutes from expiry, so it was access that ended, not time",
    leaverLink.expiresAt.getTime() - Date.now() > 50 * 60 * 1000,
  );
  check(
    "suspension revoked the link in the same transaction as the session",
    suspension.revokedDocumentLinks >= 1,
    `revoked ${suspension.revokedDocumentLinks}`,
  );

  const leaverSearchAfter = await searchDocuments({ actorUserId: leaver.id, query: "Quokka" });
  check(
    "EVIDENCE 3c — and their search results stop working immediately",
    leaverSearchAfter.totalCount === 0 && leaverSearchAfter.results.length === 0,
    `count=${leaverSearchAfter.totalCount}`,
  );
  check(
    "EVIDENCE 3d — including the count and the suggestions, not just the list",
    leaverSearchAfter.suggestions.length === 0,
  );

  const docStillThere = await prisma.document.findFirst({
    where: { practiceId: company.id, title: tag("Quokka handover note") },
  });
  check(
    "the document they filed survives — suspension removes access, not the firm's records",
    docStillThere !== null && docStillThere.archivedAt === null,
  );

  // ====================================================================
  console.log("\nDOC06 — lock, retention and deletion");

  const setRow = await prisma.documentSet.create({
    data: { practiceId: company.id, name: tag("Audit file FY 2025-26"), clientRelationshipId: rel.id },
  });
  await addToSet({
    actorUserId: partner.id, practiceId: company.id,
    documentSetId: setRow.id, documentVersionId: report.version.id,
  });
  await addToSet({
    actorUserId: partner.id, practiceId: company.id,
    documentSetId: setRow.id, documentVersionId: workingPaper.version.id,
  });

  const finalised = await finaliseSet({
    actorUserId: partner.id, practiceId: company.id, documentSetId: setRow.id,
  });
  check("finalising produces a manifest of every version", finalised.manifest.length === 2);
  check(
    "the manifest carries each version's number AND hash",
    finalised.manifest.every((m) => m.sha256.length === 64 && m.versionNo > 0),
  );
  check("the manifest is itself hashed, so the list is tamper-evident", finalised.manifestSha256.length === 64);
  const verified = await verifySetManifest(company.id, setRow.id);
  check("and the manifest verifies against its recorded hash", verified.ok, verified.problem ?? "");

  // A verifier that cannot fail proves nothing. Alter one recorded hash and
  // confirm the check notices, then put it back.
  const goodManifest = finalised.manifest;
  await prisma.documentSet.update({
    where: { id: setRow.id },
    data: {
      manifest: goodManifest.map((m, i) =>
        i === 0 ? { ...m, sha256: "0".repeat(64) } : m,
      ) as never,
    },
  });
  const tampered = await verifySetManifest(company.id, setRow.id);
  check("a tampered manifest entry is DETECTED", !tampered.ok, tampered.problem ?? "");
  await prisma.documentSet.update({
    where: { id: setRow.id },
    data: { manifest: goodManifest as never },
  });
  check(
    "and the manifest verifies again once restored (the check is stable, not flaky)",
    (await verifySetManifest(company.id, setRow.id)).ok,
  );

  const lockedDoc = await prisma.document.findUniqueOrThrow({ where: { id: report.document.id } });
  check("documents in a finalised set are locked", lockedDoc.lockedAt !== null);

  const newVersionOnLocked = await receiveUpload({
    ctx: staffCtx(article.id),
    body: pdf("audit report — late change"),
    filename: "audit-report.pdf",
    declaredMimeType: "application/pdf",
  });
  const lockedAdd = await throws(
    () =>
      fileUpload({
        actorUserId: article.id, practiceId: company.id, receipt: newVersionOnLocked,
        filename: "audit-report.pdf", documentId: report.document.id, clientRelationshipId: rel.id,
      }),
    DocumentError,
  );
  check(
    "a locked document cannot take a new version",
    lockedAdd?.code === "DOCUMENT_LOCKED",
    lockedAdd?.code,
  );

  const setAddAfter = await throws(
    () =>
      addToSet({
        actorUserId: partner.id, practiceId: company.id,
        documentSetId: setRow.id, documentVersionId: filed2.version.id,
      }),
    DocumentError,
  );
  check("a finalised set cannot be changed", setAddAfter?.code === "SET_FINALISED", setAddAfter?.code);

  // Deletion: three gates.
  const noPolicy = await checkDeletionEligibility({ practiceId: company.id, documentId: filed1.document.id });
  check(
    "a document with no retention policy applied is NOT eligible for deletion",
    !noPolicy.eligible && /No retention policy/.test(noPolicy.reason ?? ""),
    noPolicy.reason ?? "",
  );

  await prisma.retentionPolicy.create({
    data: {
      practiceId: company.id, recordClass: "CLIENT_SUPPLIED", retainYears: 0,
      basis: "Fictional retention schedule, clause 4", effectiveFrom: d("2024-04-01"),
    },
  });
  const { applyRetention } = await import("../src/lib/documents");
  await applyRetention({
    actorUserId: partner.id, practiceId: company.id,
    documentId: filed1.document.id, recordClass: "CLIENT_SUPPLIED",
    from: new Date(Date.now() - 24 * 60 * 60 * 1000),
  });

  const eligibleNow = await checkDeletionEligibility({ practiceId: company.id, documentId: filed1.document.id });
  check("with an expired retention period the document becomes eligible", eligibleNow.eligible, eligibleNow.reason ?? "");

  await placeLegalHold({
    actorUserId: partner.id, practiceId: company.id,
    documentId: filed1.document.id, reason: "Fictional dispute — records preserved",
  });
  const heldEligibility = await checkDeletionEligibility({ practiceId: company.id, documentId: filed1.document.id });
  check(
    "a legal hold makes it ineligible again",
    !heldEligibility.eligible && /legal hold/i.test(heldEligibility.reason ?? ""),
    heldEligibility.reason ?? "",
  );

  const heldRequest = await requestDeletion({
    actorUserId: article.id, practiceId: company.id,
    documentId: filed1.document.id, reason: "Retention expired",
  });
  const heldApproval = await throws(
    () => approveDeletion({ actorUserId: partner.id, practiceId: company.id, requestId: heldRequest.id }),
    DocumentError,
  );
  check(
    "approval cannot overrule a legal hold",
    heldApproval?.code === "NOT_ELIGIBLE",
    heldApproval?.code,
  );

  await prisma.legalHold.updateMany({
    where: { practiceId: company.id, scopeDocumentId: filed1.document.id },
    data: { releasedAt: new Date(), releasedByUserId: partner.id, releaseReason: "Dispute closed" },
  });
  await prisma.document.update({ where: { id: filed1.document.id }, data: { legalHold: false } });

  const request = await requestDeletion({
    actorUserId: article.id, practiceId: company.id,
    documentId: filed1.document.id, reason: "Retention period expired",
  });
  check(
    "the request records the eligibility answer AND the backup expiry position",
    request.eligible === true && /backup retention schedule/i.test(request.backupExpiryNote ?? ""),
    request.backupExpiryNote ?? "",
  );

  const selfApproveDeletion = await throws(
    () => approveDeletion({ actorUserId: article.id, practiceId: company.id, requestId: request.id }),
    Error,
  );
  check(
    "the requester cannot approve their own deletion",
    selfApproveDeletion !== null,
    selfApproveDeletion?.name ?? "(no error)",
  );

  const notApproved = await throws(
    () => executeDeletion({ actorUserId: partner.id, practiceId: company.id, requestId: request.id }),
    DocumentError,
  );
  check(
    "an unapproved request cannot be executed",
    notApproved?.code === "NOT_APPROVED",
    notApproved?.code,
  );

  const reviewerDeletion = await throws(
    () => approveDeletion({ actorUserId: reviewer.id, practiceId: company.id, requestId: request.id }),
    Error,
  );
  check(
    "a reviewer who may release a document may NOT approve its destruction",
    reviewerDeletion?.name === "PermissionDeniedError",
    reviewerDeletion?.name ?? "(no error)",
  );

  await approveDeletion({ actorUserId: partner.id, practiceId: company.id, requestId: request.id });
  const versionsBefore = await prisma.documentVersion.findMany({
    where: { documentId: filed1.document.id },
    select: { storageObjectId: true, sha256: true },
  });
  const keysBefore = versionsBefore.map((v) => v.storageObjectId);

  const executed = await executeDeletion({
    actorUserId: partner.id, practiceId: company.id, requestId: request.id,
  });
  check("execution destroys every version's bytes", executed.versionsDestroyed === keysBefore.length);
  const stillStored = await Promise.all(keysBefore.map((k) => getObject(k)));
  check(
    "the bytes really are gone from the object store",
    stillStored.every((b) => b === null),
  );

  const afterDeletion = await prisma.document.findUniqueOrThrow({ where: { id: filed1.document.id } });
  const versionsAfter = await prisma.documentVersion.findMany({ where: { documentId: filed1.document.id } });
  check("the Document row survives, archived", afterDeletion.archivedAt !== null);
  check(
    "EVERY version row survives with its hash — what was destroyed stays provable",
    versionsAfter.length === versionsBefore.length &&
      versionsBefore.every((b) => versionsAfter.some((a) => a.sha256 === b.sha256)),
    `${versionsAfter.length} of ${versionsBefore.length} rows`,
  );
  const deletionEvent = await prisma.event.findFirstOrThrow({
    where: { action: "DOCUMENT_DELETED", targetId: filed1.document.id },
  });
  check(
    "the deletion is in the audit trail with its reason",
    deletionEvent.reason === "Retention period expired" && deletionEvent.result === "SUCCESS",
  );

  // ====================================================================
  console.log("\nAudit trail (SEC04) — nothing sensitive reaches it");

  const intakeEvents = await prisma.event.findMany({
    where: { practiceId: company.id, action: { startsWith: "DOCUMENT_INTAKE_" } },
    select: { afterMeta: true },
  });
  const serialised = JSON.stringify(intakeEvents);
  check(
    "no document body reaches the audit trail",
    !serialised.includes("fictional test document") && !serialised.includes("sampling memo"),
  );
  check(
    "and no EICAR payload was copied into an alert or event",
    !serialised.includes("EICAR-STANDARD"),
  );
  check("intake events do record the hash and size", serialised.includes("sha256"));

  // ====================================================================
  console.log(`\n${passed} passed, ${failed} failed\n`);
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("\nTEST RUN FAILED:", e);
  await prisma.$disconnect();
  process.exit(1);
});
