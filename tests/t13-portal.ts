/**
 * T13 acceptance test — POR01, POR02, POR03, POR05 (PRD §17).
 * POR04 (approvals) and POR06 (external experts) are R1 and not covered.
 *
 * PRD acceptance evidence, verbatim:
 *   "A group CFO switches between two approved client entities and cannot see
 *    a third. An expired invitation gives a safe renewal request without
 *    identifying the client to an unauthenticated visitor. Interrupted upload
 *    resumes without duplicate originals."
 *
 * All three are the sections marked EVIDENCE below. Everything else covers the
 * rules those headlines rest on: single-use invitations, the POR01 exposure
 * prohibition, and the receipt that confirms intake only.
 *
 * Library level — no HTTP server required — but it DOES need MinIO running,
 * because it writes and reads real objects rather than faking the store:
 *   docker compose up -d minio
 *
 * All fixture data is fictional. Run: npm run test:t13
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  PortalAuthError,
  acceptPortalInvitation,
  issuePortalInvitation,
  liveAuthorities,
  requestInvitationRenewal,
  validatePortalSession,
  assertPortalAccess,
  INVITATION_UNUSABLE_MESSAGE,
} from "../src/lib/portal-auth";
import { listPortalEntities, loadPortalHome, portalItemStatus } from "../src/lib/portal";
import {
  PortalUploadError,
  appendPortalUploadPart,
  beginPortalUpload,
  completePortalUpload,
  getPortalUploadStatus,
  RECEIPT_MESSAGE,
} from "../src/lib/portal-upload";
import { ensureBucket, sha256Hex } from "../src/lib/object-store";

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

/** A small, real PDF. Intake sniffs content, so a fake byte string is rejected. */
function pdfBytes(sizeBytes: number): Buffer {
  const header = Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "binary");
  const trailer = Buffer.from("\n%%EOF\n", "binary");
  const fillLength = Math.max(0, sizeBytes - header.length - trailer.length);
  // Deterministic filler, so the same logical file always has the same digest.
  const filler = Buffer.alloc(fillLength, 0x41);
  return Buffer.concat([header, filler, trailer]);
}

async function main() {
  console.log("\nT13 — client portal (PRD §17 POR01-03, POR05)\n");

  await ensureBucket();

  // ------------------------------------------------------------ fixtures

  const tenant = await prisma.tenant.create({ data: { name: tag("BHV") } });

  const practice = await prisma.practice.create({
    data: {
      tenantId: tenant.id,
      name: tag("Fictional Associates"),
      registeredDisplayName: tag("Fictional Associates Registered"),
      constitution: "PARTNERSHIP",
      documentNamespace: `t13-${RUN}`.toLowerCase(),
      effectiveFrom: d("2024-04-01"),
    },
  });

  const partner = await prisma.user.create({
    data: {
      email: `p-${RUN}@example.invalid`,
      fullName: "Fictional Partner",
      status: "ACTIVE",
    },
  });
  await prisma.practiceMembership.create({
    data: {
      practiceId: practice.id,
      userId: partner.id,
      role: "PRACTICE_PARTNER",
      assignmentScope: "PRACTICE",
      effectiveFrom: d("2024-04-01"),
    },
  });

  // The group: three companies, one CFO. The acceptance evidence turns on the
  // CFO being granted TWO of them and never the third.
  const partyA = await prisma.party.create({
    data: { tenantId: tenant.id, legalName: tag("Fictional Alpha Private Limited"), type: "COMPANY" },
  });
  const partyB = await prisma.party.create({
    data: { tenantId: tenant.id, legalName: tag("Fictional Beta Private Limited"), type: "COMPANY" },
  });
  const partyC = await prisma.party.create({
    data: { tenantId: tenant.id, legalName: tag("Fictional Gamma Private Limited"), type: "COMPANY" },
  });

  const relA = await prisma.clientRelationship.create({
    data: { practiceId: practice.id, partyId: partyA.id, acceptanceStatus: "ACCEPTED" },
  });
  const relB = await prisma.clientRelationship.create({
    data: { practiceId: practice.id, partyId: partyB.id, acceptanceStatus: "ACCEPTED" },
  });
  const relC = await prisma.clientRelationship.create({
    data: { practiceId: practice.id, partyId: partyC.id, acceptanceStatus: "ACCEPTED" },
  });

  const cfo = await prisma.contact.create({
    data: {
      partyId: partyA.id,
      fullName: "Fictional Group CFO",
      email: `cfo-${RUN}@example.invalid`,
      emailVerificationStatus: "VERIFIED",
    },
  });

  // ============================================================ POR02
  console.log("POR02 — invitation with client, practice and authority scope");

  const invite = await issuePortalInvitation({
    practiceId: practice.id,
    contactId: cfo.id,
    grants: [
      { clientRelationshipId: relA.id, authority: "UPLOAD" },
      { clientRelationshipId: relB.id, authority: "UPLOAD" },
    ],
    invitedByUserId: partner.id,
    invitedByName: "Fictional Partner",
  });

  check("invitation returns a raw token once", typeof invite.token === "string" && invite.token.length > 20);

  const storedInvite = await prisma.portalInvitation.findUniqueOrThrow({
    where: { id: invite.invitationId },
  });
  check(
    "only the token HASH is stored, never the token",
    storedInvite.tokenHash !== invite.token && !JSON.stringify(storedInvite).includes(invite.token),
  );

  const grantedAuthorities = await liveAuthorities(cfo.id, practice.id);
  check(
    "the invitation created exactly the two grants named, and no third",
    grantedAuthorities.length === 2 &&
      grantedAuthorities.some((a) => a.clientRelationshipId === relA.id) &&
      grantedAuthorities.some((a) => a.clientRelationshipId === relB.id) &&
      !grantedAuthorities.some((a) => a.clientRelationshipId === relC.id),
    `got ${grantedAuthorities.length}`,
  );

  // An invitation naming a relationship in another practice must not resolve.
  const otherPractice = await prisma.practice.create({
    data: {
      tenantId: tenant.id,
      name: tag("Fictional Other Firm"),
      constitution: "LLP",
      documentNamespace: `t13o-${RUN}`.toLowerCase(),
      effectiveFrom: d("2024-04-01"),
    },
  });
  const foreignRel = await prisma.clientRelationship.create({
    data: { practiceId: otherPractice.id, partyId: partyC.id, acceptanceStatus: "ACCEPTED" },
  });
  const crossPractice = await throws(
    () =>
      issuePortalInvitation({
        practiceId: practice.id,
        contactId: cfo.id,
        grants: [{ clientRelationshipId: foreignRel.id, authority: "UPLOAD" }],
        invitedByUserId: partner.id,
        invitedByName: "Fictional Partner",
      }),
    PortalAuthError,
  );
  check(
    "ORG04: an invitation cannot grant authority over another practice's client",
    crossPractice !== null && crossPractice.status === 404,
    crossPractice ? `status ${crossPractice.status}` : "no error thrown",
  );

  const unscoped = await throws(
    () =>
      issuePortalInvitation({
        practiceId: practice.id,
        contactId: cfo.id,
        grants: [],
        invitedByUserId: partner.id,
        invitedByName: "Fictional Partner",
      }),
    PortalAuthError,
  );
  check("an invitation with no entity scope is refused", unscoped !== null);

  const session = await acceptPortalInvitation({ token: invite.token });
  check("redeeming the invitation opens a portal session", typeof session.token === "string");

  const validated = await validatePortalSession(session.token);
  check(
    "the session resolves to the contact and practice, not a User",
    validated.contactId === cfo.id && validated.practiceId === practice.id,
  );

  // -- single use
  const reused = await throws(() => acceptPortalInvitation({ token: invite.token }), PortalAuthError);
  check(
    "POR02: an invitation is single use — a second redemption is refused",
    reused !== null && reused.message === INVITATION_UNUSABLE_MESSAGE,
  );

  // ============================================== EVIDENCE 1 (POR02)
  console.log("\nEVIDENCE — a group CFO switches between two entities and cannot see a third");

  const entities = await listPortalEntities({ contactId: cfo.id, practiceId: practice.id });
  check(
    "the entity switcher offers exactly the two approved entities",
    entities.length === 2 &&
      entities.some((e) => e.clientRelationshipId === relA.id) &&
      entities.some((e) => e.clientRelationshipId === relB.id),
    `got ${entities.map((e) => e.legalName).join(", ")}`,
  );
  check(
    "the third entity is NOT offered by the switcher",
    !entities.some((e) => e.clientRelationshipId === relC.id),
  );

  // Switching: both entities load a real home, each scoped to itself.
  const homeA = await loadPortalHome({
    contactId: cfo.id,
    practiceId: practice.id,
    clientRelationshipId: relA.id,
  });
  const homeB = await loadPortalHome({
    contactId: cfo.id,
    practiceId: practice.id,
    clientRelationshipId: relB.id,
  });
  check(
    "the CFO can switch: each entity loads its own home",
    homeA.active.clientRelationshipId === relA.id &&
      homeB.active.clientRelationshipId === relB.id &&
      homeA.active.legalName !== homeB.active.legalName,
  );

  // The third, named DIRECTLY — the URL-tampering path.
  const deniedHome = await throws(
    () =>
      loadPortalHome({
        contactId: cfo.id,
        practiceId: practice.id,
        clientRelationshipId: relC.id,
      }),
    PortalAuthError,
  );
  check(
    "naming the third entity directly is refused",
    deniedHome !== null,
    "no error thrown",
  );
  check(
    "the refusal is 404, never 403 — it does not confirm the entity exists",
    deniedHome !== null && deniedHome.status === 404 && deniedHome.message === "Not found",
    deniedHome ? `status ${deniedHome.status}, message "${deniedHome.message}"` : "",
  );

  // CONTROL: the same call for an entity the CFO IS entitled to must succeed,
  // or the assertion above would pass with authority checking switched off.
  const control = await assertPortalAccess({
    contactId: cfo.id,
    practiceId: practice.id,
    clientRelationshipId: relA.id,
  });
  check("CONTROL — the same check passes for an entitled entity", control.length > 0);

  // And an upload against the third entity is refused at the upload path too.
  const deniedUpload = await throws(
    () =>
      beginPortalUpload({
        contactId: cfo.id,
        practiceId: practice.id,
        clientRelationshipId: relC.id,
        filename: "attempt.pdf",
        declaredMimeType: "application/pdf",
        expectedBytes: 1024,
      }),
    PortalAuthError,
  );
  check(
    "uploading against the third entity is refused at the upload path too",
    deniedUpload !== null && deniedUpload.status === 404,
  );

  // ============================================== EVIDENCE 2 (POR02/POR05)
  console.log("\nEVIDENCE — an expired invitation gives a safe renewal without identifying the client");

  const expiring = await issuePortalInvitation({
    practiceId: practice.id,
    contactId: cfo.id,
    grants: [{ clientRelationshipId: relA.id, authority: "UPLOAD" }],
    invitedByUserId: partner.id,
    invitedByName: "Fictional Partner",
    // Already dead when issued, so no clock is waited on.
    ttlMs: -1000,
  });

  const expired = await throws(
    () => acceptPortalInvitation({ token: expiring.token }),
    PortalAuthError,
  );
  check("an expired invitation is refused", expired !== null);

  const unknownToken = await throws(
    () => acceptPortalInvitation({ token: "not-a-real-token-000000000000000000000000" }),
    PortalAuthError,
  );
  check("an unknown token is refused", unknownToken !== null);

  check(
    "expired, already-used and unknown tokens are INDISTINGUISHABLE from outside",
    expired !== null &&
      unknownToken !== null &&
      reused !== null &&
      expired.message === unknownToken.message &&
      expired.message === reused.message &&
      expired.code === unknownToken.code &&
      expired.status === unknownToken.status,
    expired && unknownToken ? `"${expired.message}" vs "${unknownToken.message}"` : "",
  );

  check(
    "the refusal names no client, contact, practice or reason",
    expired !== null &&
      !expired.message.includes(tag("Fictional Alpha Private Limited")) &&
      !expired.message.toLowerCase().includes("expired invitation") &&
      !expired.message.includes(cfo.fullName) &&
      !expired.message.includes(practice.name),
  );

  const renewal = await requestInvitationRenewal({ token: expiring.token });
  const renewalUnknown = await requestInvitationRenewal({ token: "still-not-a-real-token-0000000" });
  check(
    "renewal is acknowledged identically for a real and a nonexistent token",
    renewal.acknowledged === renewalUnknown.acknowledged &&
      renewal.message === renewalUnknown.message,
  );
  check(
    "the renewal acknowledgement identifies no client",
    !renewal.message.includes(tag("Fictional Alpha Private Limited")) &&
      !renewal.message.includes(cfo.fullName),
  );

  const renewedRow = await prisma.portalInvitation.findUniqueOrThrow({
    where: { id: expiring.invitationId },
  });
  check(
    "the renewal request IS recorded against the real invitation, so staff can act on it",
    renewedRow.renewalRequestedAt !== null && renewedRow.renewalCount === 1,
  );

  // ============================================================ POR01
  console.log("\nPOR01 — portal home shows the right things, and none of the wrong ones");

  const engagement = await prisma.engagement.create({
    data: {
      practiceId: practice.id,
      clientRelationshipId: relA.id,
      serviceCode: "GST_ANNUAL",
      templateVersion: "1",
      periodStart: d("2025-04-01"),
      periodEnd: d("2026-03-31"),
    },
  });

  const request = await prisma.clientRequest.create({
    data: {
      practiceId: practice.id,
      clientRelationshipId: relA.id,
      engagementId: engagement.id,
      title: "Documents for GST annual return",
      detail: "Please send the following for FY2025-26.",
      requestedItems: [],
      state: "SENT",
      sentAt: new Date(),
      dueDate: d("2099-01-31"),
    },
  });

  const item = await prisma.clientRequestItem.create({
    data: {
      practiceId: practice.id,
      requestId: request.id,
      sequence: 1,
      documentType: "Bank statement",
      description: "All accounts, full year.",
      periodLabel: "FY 2025-26",
      dueDate: d("2099-01-31"),
      // Internal ownership — the field POR01 says must not be exposed.
      ownerUserId: partner.id,
    },
  });

  // A draft request for the SAME client that has never been sent.
  await prisma.clientRequest.create({
    data: {
      practiceId: practice.id,
      clientRelationshipId: relA.id,
      title: "Internal draft — not sent",
      requestedItems: [],
      state: "OPEN",
    },
  });

  const homeWithWork = await loadPortalHome({
    contactId: cfo.id,
    practiceId: practice.id,
    clientRelationshipId: relA.id,
  });

  check(
    "the identified practice is shown, using the registered display name",
    homeWithWork.practice.name === tag("Fictional Associates Registered"),
    homeWithWork.practice.name,
  );
  check(
    "the sent request is listed with its item, service and period",
    homeWithWork.requests.length === 1 &&
      homeWithWork.requests[0].items.length === 1 &&
      homeWithWork.requests[0].serviceCode === "GST_ANNUAL" &&
      homeWithWork.requests[0].items[0].periodLabel === "FY 2025-26",
  );
  check(
    "a request that has NOT been sent is not shown to the client",
    !homeWithWork.requests.some((r) => r.title === "Internal draft — not sent"),
  );
  check(
    "POR01: no internal owner is exposed on a request item",
    !JSON.stringify(homeWithWork).includes(partner.id),
  );

  // Working paper vs deliverable.
  const workingPaper = await prisma.document.create({
    data: {
      practiceId: practice.id,
      clientRelationshipId: relA.id,
      title: "Internal audit working paper",
      kind: "INTERNAL",
      workingPaper: true,
    },
  });
  const wpVersion = await prisma.documentVersion.create({
    data: {
      practiceId: practice.id,
      documentId: workingPaper.id,
      versionNo: 1,
      storageObjectId: "unused",
      sha256: "0".repeat(64),
      mimeType: "application/pdf",
      sizeBytes: BigInt(10),
      source: "STAFF_UPLOAD",
      scanVerdict: "CLEAN",
      filename: "wp.pdf",
    },
  });
  const wpRelease = await prisma.documentRelease.create({
    data: {
      practiceId: practice.id,
      documentId: workingPaper.id,
      documentVersionId: wpVersion.id,
      releasedByUserId: partner.id,
      releasedByUserName: "Fictional Partner",
    },
  });
  await prisma.documentReleaseRecipient.create({
    data: {
      practiceId: practice.id,
      releaseId: wpRelease.id,
      contactId: cfo.id,
      clientRelationshipId: relA.id,
      contactNameAtRelease: cfo.fullName,
    },
  });

  const homeAfterWp = await loadPortalHome({
    contactId: cfo.id,
    practiceId: practice.id,
    clientRelationshipId: relA.id,
  });
  check(
    "DOC04: a working paper is withheld even when it has been released to this contact",
    !homeAfterWp.deliverables.some((dv) => dv.releaseId === wpRelease.id),
    `deliverables: ${homeAfterWp.deliverables.length}`,
  );

  // CONTROL: a genuine deliverable to the same contact DOES appear, so the
  // assertion above cannot be passing because deliverables are simply broken.
  const deliverable = await prisma.document.create({
    data: {
      practiceId: practice.id,
      clientRelationshipId: relA.id,
      title: "Signed accounts FY2024-25",
      kind: "APPROVED_DELIVERABLE",
      workingPaper: false,
    },
  });
  const dvVersion = await prisma.documentVersion.create({
    data: {
      practiceId: practice.id,
      documentId: deliverable.id,
      versionNo: 1,
      storageObjectId: "unused",
      sha256: "1".repeat(64),
      mimeType: "application/pdf",
      sizeBytes: BigInt(10),
      source: "STAFF_UPLOAD",
      scanVerdict: "CLEAN",
      filename: "accounts.pdf",
    },
  });
  const dvRelease = await prisma.documentRelease.create({
    data: {
      practiceId: practice.id,
      documentId: deliverable.id,
      documentVersionId: dvVersion.id,
      releasedByUserId: partner.id,
      releasedByUserName: "Fictional Partner",
    },
  });
  await prisma.documentReleaseRecipient.create({
    data: {
      practiceId: practice.id,
      releaseId: dvRelease.id,
      contactId: cfo.id,
      clientRelationshipId: relA.id,
      contactNameAtRelease: cfo.fullName,
    },
  });

  const homeWithDeliverable = await loadPortalHome({
    contactId: cfo.id,
    practiceId: practice.id,
    clientRelationshipId: relA.id,
  });
  check(
    "CONTROL — a genuine released deliverable IS shown",
    homeWithDeliverable.deliverables.some((dv) => dv.releaseId === dvRelease.id),
  );
  check(
    "a deliverable released for entity A does not appear under entity B",
    !(
      await loadPortalHome({
        contactId: cfo.id,
        practiceId: practice.id,
        clientRelationshipId: relB.id,
      })
    ).deliverables.some((dv) => dv.releaseId === dvRelease.id),
  );

  // Obligation dates: the agreed ones only.
  const obligationRule = await prisma.obligationRule.create({
    data: {
      code: tag("GSTR9"),
      version: 1,
      source: "CGST Act (fictional reference)",
      governingLaw: "CGST_ACT_2017",
      applicability: {} as never,
      effectiveFrom: d("2024-04-01"),
    },
  });
  await prisma.obligation.create({
    data: {
      practiceId: practice.id,
      clientRelationshipId: relA.id,
      ruleId: obligationRule.id,
      ruleVersion: 1,
      periodKey: "FY2025-26",
      originalStatutoryDate: d("2099-12-31"),
      currentStatutoryDate: d("2099-12-31"),
      clientDocumentCutoff: d("2099-11-30"),
      internalTargetDate: d("2099-10-15"),
      reviewTargetDate: d("2099-11-15"),
      status: "OPEN",
    },
  });

  const homeWithDates = await loadPortalHome({
    contactId: cfo.id,
    practiceId: practice.id,
    clientRelationshipId: relA.id,
  });
  check(
    "the statutory date and the client document cutoff are shown as agreed dates",
    homeWithDates.agreedDates.some((x) => x.kind === "STATUTORY_DUE") &&
      homeWithDates.agreedDates.some((x) => x.kind === "DOCUMENT_CUTOFF"),
  );
  check(
    "POR01: the firm's INTERNAL target and review dates are not exposed",
    !homeWithDates.agreedDates.some(
      (x) =>
        x.date.getTime() === d("2099-10-15").getTime() ||
        x.date.getTime() === d("2099-11-15").getTime(),
    ),
  );

  // ============================================== EVIDENCE 3 (POR03)
  console.log("\nEVIDENCE — interrupted upload resumes without duplicate originals");

  const fileBytes = pdfBytes(300_000);
  const fileDigest = sha256Hex(fileBytes);
  const PART = 128 * 1024;

  const begun = await beginPortalUpload({
    contactId: cfo.id,
    practiceId: practice.id,
    clientRelationshipId: relA.id,
    itemId: item.id,
    filename: "bank-statement.pdf",
    declaredMimeType: "application/pdf",
    expectedBytes: fileBytes.byteLength,
    expectedSha256: fileDigest,
  });
  check("upload begins and is not a resume", begun.resumed === false && begun.receivedBytes === 0);

  // --- the interruption: send part 0, then "lose the connection".
  const afterPart0 = await appendPortalUploadPart({
    uploadId: begun.uploadId,
    contactId: cfo.id,
    partNumber: 0,
    body: fileBytes.subarray(0, PART),
  });
  check(
    "part 0 is stored and counted",
    afterPart0.receivedBytes === PART && afterPart0.complete === false,
  );

  // --- the client comes back having lost the upload id, and re-declares the
  // same file. This is interruption case 2.
  const resumed = await beginPortalUpload({
    contactId: cfo.id,
    practiceId: practice.id,
    clientRelationshipId: relA.id,
    itemId: item.id,
    filename: "bank-statement.pdf",
    declaredMimeType: "application/pdf",
    expectedBytes: fileBytes.byteLength,
    expectedSha256: fileDigest,
  });
  check(
    "re-declaring the same file RESUMES the existing upload rather than starting a second",
    resumed.resumed === true && resumed.uploadId === begun.uploadId,
    `resumed=${resumed.resumed} sameId=${resumed.uploadId === begun.uploadId}`,
  );
  check(
    "the resume reports the bytes and parts already held",
    resumed.receivedBytes === PART && resumed.receivedParts.join(",") === "0",
  );

  // --- a retried part (the client was unsure whether part 0 landed) must not
  // double-count. This is interruption case 1.
  const retried = await appendPortalUploadPart({
    uploadId: resumed.uploadId,
    contactId: cfo.id,
    partNumber: 0,
    body: fileBytes.subarray(0, PART),
  });
  check(
    "re-sending a part already held does not double-count the bytes",
    retried.receivedBytes === PART,
    `receivedBytes=${retried.receivedBytes}, expected ${PART}`,
  );
  const partRows = await prisma.portalUploadPart.count({ where: { uploadId: resumed.uploadId } });
  check("re-sending a part updates one row rather than adding a second", partRows === 1);

  // --- send the rest.
  let offset = PART;
  let partNumber = 1;
  while (offset < fileBytes.byteLength) {
    const end = Math.min(offset + PART, fileBytes.byteLength);
    await appendPortalUploadPart({
      uploadId: resumed.uploadId,
      contactId: cfo.id,
      partNumber,
      body: fileBytes.subarray(offset, end),
    });
    offset = end;
    partNumber++;
  }

  const ready = await getPortalUploadStatus({ uploadId: resumed.uploadId, contactId: cfo.id });
  check("all bytes are accounted for before completion", ready.complete === true);

  const receipt = await completePortalUpload({ uploadId: resumed.uploadId, contactId: cfo.id });
  check("the upload completes and files a version", receipt.documentVersionId !== "");
  check("the assembled file has the digest the client declared", receipt.sha256 === fileDigest);
  check(
    "POR03: the receipt confirms intake only, and says so",
    receipt.receiptMessage === RECEIPT_MESSAGE &&
      /doesn't mean it has been\s+reviewed|does not mean/i.test(receipt.receiptMessage),
  );

  // --- THE HEADLINE: exactly one original exists for this file.
  const originals = await prisma.documentVersion.count({
    where: { practiceId: practice.id, sha256: fileDigest },
  });
  check(
    "EVIDENCE: after an interruption and a resume, exactly ONE original exists",
    originals === 1,
    `found ${originals}`,
  );

  const uploadsForFile = await prisma.portalUpload.count({
    where: {
      practiceId: practice.id,
      contactId: cfo.id,
      filename: "bank-statement.pdf",
    },
  });
  check(
    "and exactly ONE upload record was created across the interruption",
    uploadsForFile === 1,
    `found ${uploadsForFile}`,
  );

  // --- completing twice is a retry, not a second filing.
  const secondReceipt = await completePortalUpload({
    uploadId: resumed.uploadId,
    contactId: cfo.id,
  });
  check(
    "completing an already-completed upload returns the ORIGINAL receipt",
    secondReceipt.documentVersionId === receipt.documentVersionId,
  );
  const afterDoubleComplete = await prisma.documentVersion.count({
    where: { practiceId: practice.id, sha256: fileDigest },
  });
  check(
    "completing twice does not file a second version",
    afterDoubleComplete === 1,
    `found ${afterDoubleComplete}`,
  );

  // --- interruption case 3: the client gives up and re-sends the whole file.
  const restarted = await beginPortalUpload({
    contactId: cfo.id,
    practiceId: practice.id,
    clientRelationshipId: relA.id,
    itemId: item.id,
    filename: "bank-statement-again.pdf",
    declaredMimeType: "application/pdf",
    expectedBytes: fileBytes.byteLength,
    expectedSha256: fileDigest,
  });
  let restartOffset = 0;
  let restartPart = 0;
  while (restartOffset < fileBytes.byteLength) {
    const end = Math.min(restartOffset + PART, fileBytes.byteLength);
    await appendPortalUploadPart({
      uploadId: restarted.uploadId,
      contactId: cfo.id,
      partNumber: restartPart,
      body: fileBytes.subarray(restartOffset, end),
    });
    restartOffset = end;
    restartPart++;
  }
  const dedupReceipt = await completePortalUpload({
    uploadId: restarted.uploadId,
    contactId: cfo.id,
  });
  check(
    "re-sending identical content from scratch is recognised as a duplicate",
    dedupReceipt.duplicateOfExisting === true &&
      dedupReceipt.documentVersionId === receipt.documentVersionId,
  );
  const afterRestart = await prisma.documentVersion.count({
    where: { practiceId: practice.id, sha256: fileDigest },
  });
  check(
    "and STILL exactly one original exists",
    afterRestart === 1,
    `found ${afterRestart}`,
  );

  // --- CONTROL: a genuinely different file DOES create a second original, so
  // the dedup assertions above cannot be passing because filing is broken.
  const otherBytes = pdfBytes(200_000);
  const otherDigest = sha256Hex(otherBytes);
  const otherUpload = await beginPortalUpload({
    contactId: cfo.id,
    practiceId: practice.id,
    clientRelationshipId: relA.id,
    itemId: item.id,
    filename: "ledger.pdf",
    declaredMimeType: "application/pdf",
    expectedBytes: otherBytes.byteLength,
    expectedSha256: otherDigest,
  });
  let oOffset = 0;
  let oPart = 0;
  while (oOffset < otherBytes.byteLength) {
    const end = Math.min(oOffset + PART, otherBytes.byteLength);
    await appendPortalUploadPart({
      uploadId: otherUpload.uploadId,
      contactId: cfo.id,
      partNumber: oPart,
      body: otherBytes.subarray(oOffset, end),
    });
    oOffset = end;
    oPart++;
  }
  const otherReceipt = await completePortalUpload({
    uploadId: otherUpload.uploadId,
    contactId: cfo.id,
  });
  check(
    "CONTROL — a genuinely different file is filed as its own original",
    otherReceipt.duplicateOfExisting === false &&
      otherReceipt.documentVersionId !== receipt.documentVersionId,
  );

  // ------------------------------------------------------------- POR03 rules

  console.log("\nPOR03 — receipt is not acceptance, and the item reflects it");

  const itemAfter = await prisma.clientRequestItem.findUniqueOrThrow({ where: { id: item.id } });
  check(
    "a client upload moves the item to SUBMITTED, never ACCEPTED",
    itemAfter.state === "SUBMITTED",
    itemAfter.state,
  );
  check(
    "which the client sees as 'Received', not 'Accepted'",
    portalItemStatus(itemAfter.state) === "RECEIVED",
  );

  const responses = await prisma.clientRequestItemResponse.count({ where: { itemId: item.id } });
  check("each accepted upload records a response against the item", responses >= 1);

  const filedVersion = await prisma.documentVersion.findUniqueOrThrow({
    where: { id: receipt.documentVersionId },
  });
  check(
    "the filed version is marked as a portal upload, not a staff upload",
    filedVersion.source === "PORTAL_UPLOAD",
    filedVersion.source,
  );
  check(
    "DOC02: a client contact is not recorded as the PREPARER of the firm's work",
    filedVersion.preparedByUserId === null,
  );
  const filedDoc = await prisma.document.findUniqueOrThrow({
    where: { id: filedVersion.documentId },
  });
  check(
    "DOC04: a client's own upload is CLIENT_SUPPLIED and never a working paper",
    filedDoc.kind === "CLIENT_SUPPLIED" && filedDoc.workingPaper === false,
  );

  // A mismatched digest must fail rather than file something unvouched for.
  const liar = await beginPortalUpload({
    contactId: cfo.id,
    practiceId: practice.id,
    clientRelationshipId: relA.id,
    filename: "claims-to-be.pdf",
    declaredMimeType: "application/pdf",
    expectedBytes: otherBytes.byteLength,
    expectedSha256: fileDigest, // wrong digest for these bytes
  });
  let lOffset = 0;
  let lPart = 0;
  while (lOffset < otherBytes.byteLength) {
    const end = Math.min(lOffset + PART, otherBytes.byteLength);
    await appendPortalUploadPart({
      uploadId: liar.uploadId,
      contactId: cfo.id,
      partNumber: lPart,
      body: otherBytes.subarray(lOffset, end),
    });
    lOffset = end;
    lPart++;
  }
  const mismatch = await throws(
    () => completePortalUpload({ uploadId: liar.uploadId, contactId: cfo.id }),
    PortalUploadError,
  );
  check(
    "a digest mismatch fails the upload rather than filing an unverified document",
    mismatch !== null && mismatch.code === "DIGEST_MISMATCH",
    mismatch ? mismatch.code : "no error thrown",
  );

  // An incomplete upload cannot be completed.
  const partial = await beginPortalUpload({
    contactId: cfo.id,
    practiceId: practice.id,
    clientRelationshipId: relA.id,
    filename: "half.pdf",
    declaredMimeType: "application/pdf",
    expectedBytes: fileBytes.byteLength,
  });
  await appendPortalUploadPart({
    uploadId: partial.uploadId,
    contactId: cfo.id,
    partNumber: 0,
    body: fileBytes.subarray(0, PART),
  });
  const incomplete = await throws(
    () => completePortalUpload({ uploadId: partial.uploadId, contactId: cfo.id }),
    PortalUploadError,
  );
  check(
    "an incomplete upload cannot be completed",
    incomplete !== null && incomplete.code === "INCOMPLETE",
    incomplete ? incomplete.code : "no error thrown",
  );

  // Another contact cannot touch someone else's upload.
  const otherContact = await prisma.contact.create({
    data: { partyId: partyA.id, fullName: "Fictional Other Contact" },
  });
  await prisma.contactAuthority.create({
    data: {
      practiceId: practice.id,
      contactId: otherContact.id,
      clientRelationshipId: relA.id,
      authority: "UPLOAD",
      effectiveFrom: d("2024-04-01"),
    },
  });
  const stolen = await throws(
    () =>
      appendPortalUploadPart({
        uploadId: partial.uploadId,
        contactId: otherContact.id,
        partNumber: 1,
        body: fileBytes.subarray(PART, PART * 2),
      }),
    PortalUploadError,
  );
  check(
    "another contact — even one with upload rights on the same entity — cannot add to your upload",
    stolen !== null && stolen.status === 404,
    stolen ? `status ${stolen.status}` : "no error thrown",
  );

  // ------------------------------------------------------- revocation
  console.log("\nPOR02 — revoked authority ends access on the next request");

  await prisma.contactAuthority.updateMany({
    where: { contactId: cfo.id, practiceId: practice.id },
    data: { revokedAt: new Date() },
  });

  const afterRevoke = await throws(
    () => validatePortalSession(session.token),
    PortalAuthError,
  );
  check(
    "a live session ends as soon as the contact's last authority is revoked",
    afterRevoke !== null,
    "session still valid",
  );

  const revokedSession = await prisma.portalSession.findUniqueOrThrow({
    where: { id: session.sessionId },
  });
  check(
    "and the session is revoked server-side, not merely refused for this request",
    revokedSession.revokedAt !== null,
  );

  // ------------------------------------------------------------ POR05
  console.log("\nPOR05 — verified support details only");

  await prisma.practiceSupportContact.create({
    data: {
      practiceId: practice.id,
      label: "Unverified desk",
      phone: "+91 00000 00000",
      effectiveFrom: d("2024-04-01"),
      // verifiedAt deliberately null
    },
  });
  const verified = await prisma.practiceSupportContact.create({
    data: {
      practiceId: practice.id,
      label: "Client support",
      phone: "+91 11111 11111",
      email: `support-${RUN}@example.invalid`,
      hoursLabel: "Mon-Fri, 10am-6pm IST",
      verifiedAt: new Date(),
      verifiedBy: "Fictional Partner",
      effectiveFrom: d("2024-04-01"),
    },
  });

  const { listSupportContacts } = await import("../src/lib/portal");
  const support = await listSupportContacts(practice.id);
  check(
    "a verified support route is offered",
    support.some((s) => s.label === verified.label),
  );
  check(
    "an UNVERIFIED support route is withheld",
    !support.some((s) => s.label === "Unverified desk"),
    `got ${support.map((s) => s.label).join(", ")}`,
  );

  // ------------------------------------------------------------ summary
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
