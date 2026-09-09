/**
 * T12 acceptance test — COM01-04 (PRD §16). COM05 is R1, COM06 is R2.
 *
 * PRD acceptance evidence, verbatim:
 *   "Trigger the same reminder through two workers and send one logical
 *    message. A client corrects an item and only that request clears. A staff
 *    member switching practice cannot send a Company invoice from an
 *    Associates identity."
 *
 * The three evidence points are the sections marked EVIDENCE below. Everything
 * else covers the rules those headlines sit on: the visibility preview
 * (COM01), the outbound safeguards (COM03) and the six separate delivery
 * states (COM04).
 *
 * Library level — no HTTP server required. All fixture data is fictional.
 * Run: npm run test:t12
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { PermissionDeniedError } from "../src/lib/permissions";
import {
  CommunicationError,
  acceptItemResponse,
  addRequestItems,
  buildDigest,
  buildOutboundPreview,
  buildReminderDedupKey,
  clientVisibleMessages,
  commitVisibilityChange,
  createThread,
  deliveryEvidence,
  inQuietHours,
  outstandingItems,
  postMessage,
  previewVisibilityChange,
  recordDeliveryConfirmation,
  recordDeliveryUncertain,
  recordFailure,
  recordProviderAcceptance,
  rejectItemResponse,
  renderTemplate,
  sendOutbound,
  submitItemResponse,
  verifyRecipientAddress,
} from "../src/lib/communication";

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

async function main() {
  console.log("\nT12 — communication and client requests (PRD §16 COM01-04)\n");

  // ------------------------------------------------------------ fixtures
  const tenant = await prisma.tenant.create({ data: { name: tag("BHV") } });

  const company = await prisma.practice.create({
    data: {
      tenantId: tenant.id,
      name: tag("Fictional Company LLP"),
      registeredDisplayName: tag("Fictional Company LLP"),
      constitution: "LLP",
      documentNamespace: tag("co"),
      effectiveFrom: d("2024-04-01"),
    },
  });
  const associates = await prisma.practice.create({
    data: {
      tenantId: tenant.id,
      name: tag("Fictional Associates"),
      registeredDisplayName: tag("Fictional Associates"),
      constitution: "PARTNERSHIP",
      documentNamespace: tag("as"),
      effectiveFrom: d("2024-04-01"),
    },
  });

  const partner = await prisma.user.create({
    data: { email: `p-${RUN}@example.invalid`, fullName: "Fictional Partner", status: "ACTIVE" },
  });
  const reviewer = await prisma.user.create({
    data: { email: `r-${RUN}@example.invalid`, fullName: "Fictional Reviewer", status: "ACTIVE" },
  });
  const article = await prisma.user.create({
    data: { email: `a-${RUN}@example.invalid`, fullName: "Fictional Article", status: "ACTIVE" },
  });

  await prisma.practiceMembership.createMany({
    data: [
      // The dual-firm staff member the acceptance evidence is about.
      { practiceId: company.id, userId: partner.id, role: "PRACTICE_PARTNER", assignmentScope: "PRACTICE", effectiveFrom: d("2024-04-01") },
      { practiceId: associates.id, userId: partner.id, role: "PRACTICE_PARTNER", assignmentScope: "PRACTICE", effectiveFrom: d("2024-04-01") },
      { practiceId: company.id, userId: reviewer.id, role: "REVIEWER", assignmentScope: "PRACTICE", effectiveFrom: d("2024-04-01") },
      { practiceId: company.id, userId: article.id, role: "STAFF_ARTICLE", assignmentScope: "OWN_WORK", effectiveFrom: d("2024-04-01") },
    ],
  });

  // One party, a relationship with BOTH practices — the ORG01 shape the whole
  // project is built around, restated here for correspondence.
  const party = await prisma.party.create({
    data: { tenantId: tenant.id, legalName: tag("Fictional Client Private Limited"), type: "COMPANY" },
  });
  const coRel = await prisma.clientRelationship.create({
    data: { practiceId: company.id, partyId: party.id, acceptanceStatus: "ACCEPTED" },
  });
  const asRel = await prisma.clientRelationship.create({
    data: { practiceId: associates.id, partyId: party.id, acceptanceStatus: "ACCEPTED" },
  });

  const cfo = await prisma.contact.create({
    data: {
      partyId: party.id,
      fullName: "Fictional CFO",
      email: `cfo-${RUN}@example.invalid`,
      emailVerificationStatus: "VERIFIED",
    },
  });
  const accountant = await prisma.contact.create({
    data: {
      partyId: party.id,
      fullName: "Fictional Accountant",
      email: `acct-${RUN}@example.invalid`,
      emailVerificationStatus: "VERIFIED",
    },
  });
  const outsider = await prisma.contact.create({
    data: {
      partyId: party.id,
      fullName: "Fictional Unauthorised Person",
      email: `out-${RUN}@example.invalid`,
    },
  });

  await prisma.contactAuthority.createMany({
    data: [
      { practiceId: company.id, contactId: cfo.id, clientRelationshipId: coRel.id, authority: "APPROVE", effectiveFrom: d("2024-04-01") },
      { practiceId: company.id, contactId: accountant.id, clientRelationshipId: coRel.id, authority: "UPLOAD", effectiveFrom: d("2024-04-01") },
      { practiceId: associates.id, contactId: cfo.id, clientRelationshipId: asRel.id, authority: "VIEW_ONLY", effectiveFrom: d("2024-04-01") },
    ],
  });

  // ================================================================ COM01
  console.log("COM01 — unified context and the visibility preview");

  const thread = await createThread({
    practiceId: company.id,
    actorUserId: partner.id,
    clientRelationshipId: coRel.id,
    subject: "GST annual return queries",
  });
  check("a thread starts INTERNAL by default", thread.visibility === "INTERNAL");

  const internalNote = await postMessage({
    practiceId: company.id,
    threadId: thread.id,
    direction: "INTERNAL_NOTE",
    channel: "NOTE",
    visibility: "INTERNAL",
    body: "Reviewer's private concern about the reconciliation — not for the client.",
    actorUserId: reviewer.id,
  });
  const clientNote = await postMessage({
    practiceId: company.id,
    threadId: thread.id,
    direction: "OUTBOUND_TO_CLIENT",
    channel: "PORTAL",
    visibility: "CLIENT_VISIBLE",
    body: "Please send the reconciliation working for Q1.",
    actorUserId: partner.id,
  });
  await postMessage({
    practiceId: company.id,
    threadId: thread.id,
    direction: "INTERNAL_NOTE",
    channel: "EMAIL_REFERENCE",
    visibility: "INTERNAL",
    body: "See mail thread in the practice mailbox.",
    actorUserId: partner.id,
    externalReference: "mailbox:fictional-ref-001",
  });

  check("the author's name is denormalised onto the message (DAT02)", internalNote.authorName === "Fictional Reviewer");
  const refWritten = await prisma.message.findFirst({
    where: { threadId: thread.id, channel: "EMAIL_REFERENCE" },
    select: { externalReference: true, body: true },
  });
  check(
    "an email reference is stored as a POINTER, not a scraped copy",
    refWritten?.externalReference === "mailbox:fictional-ref-001",
  );

  // A cross-practice thread read must fail even with the right id.
  const wrongPractice = await throws(
    () =>
      postMessage({
        practiceId: associates.id,
        threadId: thread.id,
        direction: "INTERNAL_NOTE",
        channel: "NOTE",
        visibility: "INTERNAL",
        body: "Should never land",
        actorUserId: partner.id,
      }),
    CommunicationError,
  );
  check(
    "a Company thread is not reachable through an Associates scope",
    wrongPractice?.code === "THREAD_NOT_FOUND",
  );
  check("...and the refusal is a 404, not a 403 that confirms existence", wrongPractice?.status === 404);

  // An article may note internally but not write to the client.
  const articleInternal = await postMessage({
    practiceId: company.id,
    threadId: thread.id,
    direction: "INTERNAL_NOTE",
    channel: "NOTE",
    visibility: "INTERNAL",
    body: "Tie-out done for April.",
    actorUserId: article.id,
  });
  check("an article can record an internal note", articleInternal.id.length > 0);
  const articleToClient = await throws(
    () =>
      postMessage({
        practiceId: company.id,
        threadId: thread.id,
        direction: "OUTBOUND_TO_CLIENT",
        channel: "PORTAL",
        visibility: "CLIENT_VISIBLE",
        body: "Direct to client from an article",
        actorUserId: article.id,
      }),
    PermissionDeniedError,
  );
  check("...but cannot write to the client", articleToClient?.action === "message.send_client");

  // No preview, no change.
  const noPreview = await throws(
    () =>
      commitVisibilityChange({
        practiceId: company.id,
        actorUserId: partner.id,
        threadId: thread.id,
        previewId: "00000000-0000-0000-0000-000000000000",
        expectedVersion: thread.version,
      }),
    CommunicationError,
  );
  check("visibility cannot change without a preview", noPreview?.code === "PREVIEW_REQUIRED");

  const preview = await previewVisibilityChange({
    practiceId: company.id,
    actorUserId: partner.id,
    threadId: thread.id,
    toVisibility: "CLIENT_VISIBLE",
  });
  check("the preview shows every message in the thread", preview.messages.length === 4);
  check(
    "...and calls out the 3 internal ones the client would gain sight of",
    preview.internalMessagesExposed.length === 3,
  );

  // An article's preview is refused outright.
  const articlePreview = await throws(
    () =>
      previewVisibilityChange({
        practiceId: company.id,
        actorUserId: article.id,
        threadId: thread.id,
        toVisibility: "CLIENT_VISIBLE",
      }),
    PermissionDeniedError,
  );
  check("an article cannot preview a visibility change", articlePreview?.action === "thread.change_visibility");

  // Someone else's preview cannot be redeemed.
  const notYours = await throws(
    () =>
      commitVisibilityChange({
        practiceId: company.id,
        actorUserId: reviewer.id,
        threadId: thread.id,
        previewId: preview.previewId,
        expectedVersion: preview.threadVersion,
      }),
    CommunicationError,
  );
  check("a preview cannot be committed by someone who did not review it", notYours?.code === "PREVIEW_NOT_YOURS");

  // THE COM01 RULE: content added after the preview invalidates it.
  await postMessage({
    practiceId: company.id,
    threadId: thread.id,
    direction: "INTERNAL_NOTE",
    channel: "NOTE",
    visibility: "INTERNAL",
    body: "Late note the reviewer never saw in the preview.",
    actorUserId: reviewer.id,
  });
  const stale = await throws(
    () =>
      commitVisibilityChange({
        practiceId: company.id,
        actorUserId: partner.id,
        threadId: thread.id,
        previewId: preview.previewId,
        expectedVersion: preview.threadVersion,
      }),
    CommunicationError,
  );
  check("a message added after the preview makes the change STALE", stale?.code === "PREVIEW_STALE");

  const stillInternal = await prisma.messageThread.findUniqueOrThrow({ where: { id: thread.id } });
  check("...and the thread is still INTERNAL", stillInternal.visibility === "INTERNAL");
  const abandoned = await prisma.threadVisibilityChange.findUniqueOrThrow({
    where: { id: preview.previewId },
  });
  check("...and the abandoned preview records why", (abandoned.refusalReason ?? "").includes("re-preview"));

  const preview2 = await previewVisibilityChange({
    practiceId: company.id,
    actorUserId: partner.id,
    threadId: thread.id,
    toVisibility: "CLIENT_VISIBLE",
  });
  check("re-previewing sees the added message", preview2.messages.length === 5);
  check("...and produces a different digest", preview2.contentDigest !== preview.contentDigest);

  const versionConflict = await throws(
    () =>
      commitVisibilityChange({
        practiceId: company.id,
        actorUserId: partner.id,
        threadId: thread.id,
        previewId: preview2.previewId,
        expectedVersion: preview2.threadVersion + 5,
      }),
    CommunicationError,
  );
  check("a stale thread version is refused (API02)", versionConflict?.code === "VERSION_CONFLICT");

  const committed = await commitVisibilityChange({
    practiceId: company.id,
    actorUserId: partner.id,
    threadId: thread.id,
    previewId: preview2.previewId,
    expectedVersion: preview2.threadVersion,
  });
  check("a matching preview commits the change", committed.visibility === "CLIENT_VISIBLE");
  check("...and bumps the thread version", committed.version === preview2.threadVersion + 1);

  const spent = await throws(
    () =>
      commitVisibilityChange({
        practiceId: company.id,
        actorUserId: partner.id,
        threadId: thread.id,
        previewId: preview2.previewId,
        expectedVersion: committed.version,
      }),
    CommunicationError,
  );
  check("a spent preview cannot be replayed", spent?.code === "PREVIEW_SPENT");

  // Publishing the thread must NOT declassify the internal notes inside it.
  const clientView = await clientVisibleMessages({
    practiceId: company.id,
    threadId: thread.id,
    contactId: cfo.id,
  });
  check("the client can now see the thread", clientView !== null);
  check(
    "...but sees ONLY the client-visible message, not the 4 internal ones",
    clientView?.messages.length === 1 && clientView.messages[0].id === clientNote.id,
  );
  const outsiderView = await clientVisibleMessages({
    practiceId: company.id,
    threadId: thread.id,
    contactId: outsider.id,
  });
  check("a contact with no authority sees nothing at all", outsiderView === null);

  const auditedChange = await prisma.event.findFirst({
    where: { targetType: "MessageThread", targetId: thread.id, action: "THREAD_VISIBILITY_CHANGED" },
  });
  check("the committed change is audited with its digest", auditedChange !== null);
  check(
    "...at the exact version it applied to (SEC04)",
    auditedChange?.targetVersion === committed.version,
  );

  // ================================================================ COM02
  console.log("\nCOM02 — structured requests, one item at a time");

  const request = await prisma.clientRequest.create({
    data: {
      practiceId: company.id,
      clientRelationshipId: coRel.id,
      title: "Q1 GST working papers",
      requestedItems: [],
      closeRule: "ON_ACCEPTANCE",
      state: "SENT",
      sentAt: new Date(),
    },
  });

  const items = await addRequestItems({
    practiceId: company.id,
    actorUserId: partner.id,
    requestId: request.id,
    items: [
      { documentType: "Bank statement", periodLabel: "FY 2025-26 Q1", dueDate: d("2026-07-10") },
      { documentType: "Sales register", periodLabel: "FY 2025-26 Q1", dueDate: d("2026-07-10") },
      { documentType: "Purchase register", periodLabel: "FY 2025-26 Q1", dueDate: d("2026-07-10") },
    ],
  });
  check("a request itemises what is wanted", items.length === 3);
  check("...each with its own type, period and due date", items[0].documentType === "Bank statement" && items[0].periodLabel === "FY 2025-26 Q1");

  const noItems = await throws(
    () => addRequestItems({ practiceId: company.id, actorUserId: partner.id, requestId: request.id, items: [] }),
    CommunicationError,
  );
  check("an empty itemisation is refused", noItems?.code === "NO_ITEMS");

  // A contact with only VIEW authority in the OTHER practice cannot upload here.
  const notAuthorised = await throws(
    () =>
      submitItemResponse({
        practiceId: company.id,
        itemId: items[0].id,
        kind: "DOCUMENT",
        documentVersionId: "fictional-version-1",
        respondedByContactId: outsider.id,
      }),
    CommunicationError,
  );
  check("an unauthorised contact cannot respond", notAuthorised?.code === "CONTACT_NOT_AUTHORISED");

  // The CFO holds APPROVE (which implies upload authority); the accountant UPLOAD.
  const bankResponse = await submitItemResponse({
    practiceId: company.id,
    itemId: items[0].id,
    kind: "DOCUMENT",
    documentVersionId: "fictional-version-bank-1",
    respondedByContactId: accountant.id,
  });
  check("a document response moves that item to SUBMITTED", bankResponse.item.state === "SUBMITTED");
  check(
    "...but under ON_ACCEPTANCE its reminder does NOT stop on receipt",
    bankResponse.item.remindersStoppedAt === null,
  );

  let stillOutstanding = await outstandingItems(company.id, request.id);
  check("all three items still generate reminders", stillOutstanding.length === 3);

  // ---- EVIDENCE 2: "A client corrects an item and only that request clears."
  console.log("\n  EVIDENCE — a client corrects one item and only that one clears");

  const rejected = await rejectItemResponse({
    practiceId: company.id,
    actorUserId: partner.id,
    responseId: bankResponse.response.id,
    reason: "Statement covers Q2, not Q1",
  });
  check("a rejected response returns the item to OUTSTANDING", rejected.state === "OUTSTANDING");
  check("...and its reminder RESTARTS", rejected.remindersStoppedAt === null);

  const corrected = await submitItemResponse({
    practiceId: company.id,
    itemId: items[0].id,
    kind: "DOCUMENT",
    documentVersionId: "fictional-version-bank-2",
    respondedByContactId: accountant.id,
  });
  const accepted = await acceptItemResponse({
    practiceId: company.id,
    actorUserId: partner.id,
    responseId: corrected.response.id,
  });
  check("the corrected item is ACCEPTED", accepted.state === "ACCEPTED");
  check("...and only now do its reminders stop", accepted.remindersStoppedAt !== null);

  stillOutstanding = await outstandingItems(company.id, request.id);
  check(
    "ONE upload cleared exactly ONE item — the other two are still outstanding",
    stillOutstanding.length === 2,
    `outstanding=${stillOutstanding.map((i) => i.documentType).join(", ")}`,
  );
  const siblings = await prisma.clientRequestItem.findMany({
    where: { requestId: request.id, id: { in: [items[1].id, items[2].id] } },
  });
  check(
    "...and the siblings are untouched: still OUTSTANDING with reminders live",
    siblings.every((s) => s.state === "OUTSTANDING" && s.remindersStoppedAt === null),
  );

  const parent = await prisma.clientRequest.findUniqueOrThrow({ where: { id: request.id } });
  check("the parent request reports PARTIALLY_RECEIVED, not closed", parent.state === "PARTIALLY_RECEIVED");
  check("...and carries no receivedAt while anything is outstanding", parent.receivedAt === null);

  // The other two responses: non-availability and a question are legitimate
  // answers, and neither is a delivered document.
  const unavailable = await submitItemResponse({
    practiceId: company.id,
    itemId: items[1].id,
    kind: "NOT_AVAILABLE_EXPLANATION",
    explanation: "Register was destroyed in the office flood; affidavit to follow.",
    respondedByContactId: cfo.id,
  });
  check("a client can explain non-availability", unavailable.item.state === "NOT_AVAILABLE");
  check("...and that alone does not stop the reminder", unavailable.item.remindersStoppedAt === null);

  const question = await submitItemResponse({
    practiceId: company.id,
    itemId: items[2].id,
    kind: "QUESTION",
    explanation: "Do you need the GST-inclusive or exclusive register?",
    respondedByContactId: cfo.id,
  });
  check("a client can ask a question against an item", question.item.state === "QUESTION_RAISED");

  const emptyDoc = await throws(
    () =>
      submitItemResponse({
        practiceId: company.id,
        itemId: items[1].id,
        kind: "DOCUMENT",
        respondedByContactId: accountant.id,
      }),
    CommunicationError,
  );
  check("a document response must name the version received", emptyDoc?.code === "NO_DOCUMENT_VERSION");

  // The ON_RECEIPT rule, on a second request, so both configurations are proven.
  const receiptRequest = await prisma.clientRequest.create({
    data: {
      practiceId: company.id,
      clientRelationshipId: coRel.id,
      title: "Acknowledgement copies",
      requestedItems: [],
      closeRule: "ON_RECEIPT",
      state: "SENT",
    },
  });
  const [receiptItem] = await addRequestItems({
    practiceId: company.id,
    actorUserId: partner.id,
    requestId: receiptRequest.id,
    items: [{ documentType: "Filed acknowledgement" }],
  });
  const onReceipt = await submitItemResponse({
    practiceId: company.id,
    itemId: receiptItem.id,
    kind: "DOCUMENT",
    documentVersionId: "fictional-version-ack-1",
    respondedByContactId: accountant.id,
  });
  check(
    "under ON_RECEIPT the same act DOES stop the reminder",
    onReceipt.item.remindersStoppedAt !== null,
  );
  check(
    "...proving the close rule, not the upload, decides — the two requests behaved differently on identical input",
    onReceipt.item.remindersStoppedAt !== null && bankResponse.item.remindersStoppedAt === null,
  );

  const staleItem = await throws(
    () =>
      submitItemResponse({
        practiceId: company.id,
        itemId: receiptItem.id,
        kind: "DOCUMENT",
        documentVersionId: "fictional-version-ack-2",
        respondedByContactId: accountant.id,
        expectedVersion: 0,
      }),
    CommunicationError,
  );
  check("a stale item version is refused (API02)", staleItem?.code === "VERSION_CONFLICT");

  // ================================================================ COM03
  console.log("\nCOM03 — outbound safeguards");

  const template = await prisma.messageTemplate.create({
    data: {
      tenantId: tenant.id,
      code: tag("REMINDER"),
      name: "Document reminder",
      subject: "Outstanding documents",
      body: "Dear {{contact.name}}, {{item.count}} item(s) remain outstanding for {{period.label}}.",
    },
  });
  check("a stored template holds placeholders, not client data", !template.body.includes("Fictional Client"));

  const rendered = renderTemplate(template.body, {
    "contact.name": "Fictional CFO",
    "item.count": "2",
    "period.label": "FY 2025-26 Q1",
  });
  check("rendering happens at send time, in scope", rendered.includes("Fictional CFO") && rendered.includes("2 item(s)"));
  let unresolved: unknown = null;
  try {
    renderTemplate(template.body, { "contact.name": "Fictional CFO" });
  } catch (e) {
    unresolved = e;
  }
  check(
    "a placeholder with no authorised value is refused, not silently blanked",
    unresolved instanceof CommunicationError && unresolved.code === "UNRESOLVED_PLACEHOLDER",
  );

  const previewOut = await buildOutboundPreview({
    practiceId: company.id,
    actorUserId: partner.id,
    kind: "CLIENT_MESSAGE",
    clientRelationshipId: coRel.id,
    subject: "Outstanding documents",
    body: rendered,
    contactIds: [cfo.id],
  });
  check("the preview names the sending practice", previewOut.sendingPracticeName === company.registeredDisplayName);
  check("...the From and Reply-to identity", previewOut.fromIdentity.startsWith(company.documentNamespace));
  check("...the recipients with the authority that justified each", previewOut.recipients[0].authorityBasis === "ContactAuthority:APPROVE");
  check("...and hashes what was shown", previewOut.previewHash.length === 64);

  const withOutsider = await buildOutboundPreview({
    practiceId: company.id,
    actorUserId: partner.id,
    kind: "CLIENT_MESSAGE",
    clientRelationshipId: coRel.id,
    subject: "Outstanding documents",
    body: rendered,
    contactIds: [cfo.id, outsider.id],
  });
  check(
    "the preview flags a recipient with no live authority BEFORE sending",
    withOutsider.unauthorisedContactIds.includes(outsider.id),
  );
  const unauthorisedSend = await throws(
    () =>
      sendOutbound({
        practiceId: company.id,
        actorUserId: partner.id,
        kind: "CLIENT_MESSAGE",
        clientRelationshipId: coRel.id,
        subject: "Outstanding documents",
        body: rendered,
        contactIds: [cfo.id, outsider.id],
        confirmedPreviewHash: withOutsider.previewHash,
        dedupKey: tag("unauth"),
      }),
    CommunicationError,
  );
  check("...and refuses the send", unauthorisedSend?.code === "RECIPIENT_NOT_AUTHORISED");

  // What was confirmed must be what leaves.
  const tampered = await throws(
    () =>
      sendOutbound({
        practiceId: company.id,
        actorUserId: partner.id,
        kind: "CLIENT_MESSAGE",
        clientRelationshipId: coRel.id,
        subject: "Outstanding documents",
        body: `${rendered} PS: also transfer the balance to the account below.`,
        contactIds: [cfo.id],
        confirmedPreviewHash: previewOut.previewHash,
        dedupKey: tag("tamper"),
      }),
    CommunicationError,
  );
  check(
    "a body changed after confirmation is refused on the hash",
    tampered?.code === "PREVIEW_MISMATCH",
  );

  // A changed external recipient needs its own verification.
  const newAddress = `cfo-personal-${RUN}@example.invalid`;
  const changedPreview = await buildOutboundPreview({
    practiceId: company.id,
    actorUserId: partner.id,
    kind: "CLIENT_MESSAGE",
    clientRelationshipId: coRel.id,
    subject: "Outstanding documents",
    body: rendered,
    contactIds: [cfo.id],
    overrideAddresses: { [cfo.id]: newAddress },
  });
  check("the preview marks a changed external recipient", changedPreview.changedRecipients.length === 1);

  const unverifiedSend = await throws(
    () =>
      sendOutbound({
        practiceId: company.id,
        actorUserId: partner.id,
        kind: "CLIENT_MESSAGE",
        clientRelationshipId: coRel.id,
        subject: "Outstanding documents",
        body: rendered,
        contactIds: [cfo.id],
        overrideAddresses: { [cfo.id]: newAddress },
        confirmedPreviewHash: changedPreview.previewHash,
        dedupKey: tag("changed"),
      }),
    CommunicationError,
  );
  check("...and an unverified changed address is refused", unverifiedSend?.code === "RECIPIENT_UNVERIFIED");

  const verification = await prisma.recipientVerification.create({
    data: {
      practiceId: company.id,
      contactId: cfo.id,
      address: newAddress,
      previousAddress: cfo.email,
      proposedByUserId: partner.id,
      proposedByName: "Fictional Partner",
    },
  });
  const selfVerify = await throws(
    () =>
      verifyRecipientAddress({
        practiceId: company.id,
        actorUserId: partner.id,
        verificationId: verification.id,
        method: "Telephone call",
        evidence: "Called the number on file",
      }),
    CommunicationError,
  );
  check(
    "the user who proposed a new address cannot verify it themselves",
    selfVerify?.code === "SELF_VERIFICATION",
  );

  await verifyRecipientAddress({
    practiceId: company.id,
    actorUserId: reviewer.id,
    verificationId: verification.id,
    method: "Telephone call to the number on record",
    evidence: "Confirmed by Fictional CFO on a call-back to the recorded number",
  });
  const verifiedSend = await sendOutbound({
    practiceId: company.id,
    actorUserId: partner.id,
    kind: "CLIENT_MESSAGE",
    clientRelationshipId: coRel.id,
    subject: "Outstanding documents",
    body: rendered,
    contactIds: [cfo.id],
    overrideAddresses: { [cfo.id]: newAddress },
    confirmedPreviewHash: changedPreview.previewHash,
    dedupKey: tag("changed"),
  });
  check("...once separately verified, the send is allowed", verifiedSend.message.state === "QUEUED");
  const changedRecipientRow = await prisma.outboundRecipient.findFirstOrThrow({
    where: { messageId: verifiedSend.message.id },
  });
  check(
    "and the record shows this was a changed address, not the usual one",
    changedRecipientRow.wasChangedRecipient === true && changedRecipientRow.address === newAddress,
  );

  // Sensitive material goes as a portal link, never as an attachment.
  const workingPaper = await prisma.document.create({
    data: {
      practiceId: company.id,
      clientRelationshipId: coRel.id,
      title: "Internal audit working paper",
      classification: "RESTRICTED",
      workingPaper: true,
      kind: "INTERNAL",
    },
  });
  const wpVersion = await prisma.documentVersion.create({
    data: {
      practiceId: company.id,
      documentId: workingPaper.id,
      versionNo: 1,
      storageObjectId: tag("obj-wp"),
      sha256: "0".repeat(64),
      mimeType: "application/pdf",
      sizeBytes: BigInt(1024),
      source: "STAFF_UPLOAD",
    },
  });
  const sensitivePreview = await buildOutboundPreview({
    practiceId: company.id,
    actorUserId: partner.id,
    kind: "CLIENT_MESSAGE",
    clientRelationshipId: coRel.id,
    subject: "Working paper",
    body: "Attached.",
    contactIds: [cfo.id],
    attachedVersionIds: [wpVersion.id],
  });
  check(
    "the preview warns that an above-NORMAL attachment should be a portal link",
    sensitivePreview.sensitiveAttachmentVersionIds.includes(wpVersion.id),
  );
  const sensitiveSend = await throws(
    () =>
      sendOutbound({
        practiceId: company.id,
        actorUserId: partner.id,
        kind: "CLIENT_MESSAGE",
        clientRelationshipId: coRel.id,
        subject: "Working paper",
        body: "Attached.",
        contactIds: [cfo.id],
        attachedVersionIds: [wpVersion.id],
        confirmedPreviewHash: sensitivePreview.previewHash,
        dedupKey: tag("sensitive"),
      }),
    CommunicationError,
  );
  check("...and the send is refused", sensitiveSend?.code === "SENSITIVE_ATTACHMENT");

  // ---- EVIDENCE 3: the practice identity binding.
  console.log("\n  EVIDENCE — a Company invoice cannot leave under an Associates identity");

  const series = await prisma.invoiceSeries.create({
    data: { practiceId: company.id, code: tag("CO"), fiscalPeriod: "2026-27" },
  });
  const companyInvoice = await prisma.invoice.create({
    data: {
      practiceId: company.id,
      seriesId: series.id,
      clientRelationshipId: coRel.id,
      sequenceNumber: 1,
      status: "ISSUED",
      total: "10000.00",
      issuedAt: new Date(),
    },
  });

  // The partner is a live PRACTICE_PARTNER in BOTH firms, so nothing about
  // their role or membership stops this — only the subject-identity check does.
  const asPreview = await buildOutboundPreview({
    practiceId: associates.id,
    actorUserId: partner.id,
    kind: "CLIENT_MESSAGE",
    clientRelationshipId: asRel.id,
    subject: "Invoice",
    body: "Please find our invoice.",
    contactIds: [cfo.id],
  });
  check(
    "the partner genuinely has send authority in Associates (so the refusal below is not a role failure)",
    asPreview.recipients.length === 1,
  );

  const wrongIdentity = await throws(
    () =>
      sendOutbound({
        practiceId: associates.id,
        actorUserId: partner.id,
        kind: "INVOICE",
        subjectId: companyInvoice.id,
        clientRelationshipId: asRel.id,
        subject: "Invoice",
        body: "Please find our invoice.",
        contactIds: [cfo.id],
        confirmedPreviewHash: asPreview.previewHash,
        dedupKey: tag("wrong-identity"),
      }),
    CommunicationError,
  );
  check(
    "a Company invoice sent from the Associates identity is REFUSED",
    wrongIdentity?.code === "WRONG_PRACTICE_IDENTITY",
    `got ${wrongIdentity?.code ?? "no CommunicationError"}`,
  );
  const leaked = await prisma.outboundMessage.findUnique({ where: { dedupKey: tag("wrong-identity") } });
  check("...and nothing was queued", leaked === null);

  const refusalAudited = await prisma.event.findFirst({
    where: { action: "OUTBOUND_SEND_REFUSED", practiceId: associates.id },
  });
  check("...though the attempt is on the audit trail", refusalAudited !== null);

  // The same invoice from its OWN practice is fine — proving the refusal was
  // about identity, not about invoices being unsendable.
  const coInvoicePreview = await buildOutboundPreview({
    practiceId: company.id,
    actorUserId: partner.id,
    kind: "INVOICE",
    clientRelationshipId: coRel.id,
    subject: "Invoice",
    body: "Please find our invoice.",
    contactIds: [cfo.id],
  });
  const rightIdentity = await sendOutbound({
    practiceId: company.id,
    actorUserId: partner.id,
    kind: "INVOICE",
    subjectId: companyInvoice.id,
    clientRelationshipId: coRel.id,
    subject: "Invoice",
    body: "Please find our invoice.",
    contactIds: [cfo.id],
    confirmedPreviewHash: coInvoicePreview.previewHash,
    dedupKey: tag("right-identity"),
  });
  check(
    "the same invoice sends normally from the practice that owns it",
    rightIdentity.message.sendingPracticeName === company.registeredDisplayName,
  );

  // ================================================================ COM04
  console.log("\nCOM04 — reminder engine");

  // ---- EVIDENCE 1: two workers, one logical message.
  console.log("\n  EVIDENCE — the same reminder through two workers sends once");

  const reminderKey = buildReminderDedupKey({
    practiceId: company.id,
    kind: "DOCUMENT_REQUEST_REMINDER",
    subjectId: request.id,
    occurrence: "2026-07-08",
    recipientIds: [cfo.id],
  });
  const reminderKeyReordered = buildReminderDedupKey({
    practiceId: company.id,
    kind: "DOCUMENT_REQUEST_REMINDER",
    subjectId: request.id,
    occurrence: "2026-07-08",
    recipientIds: [cfo.id],
  });
  check("two workers computing the key independently agree", reminderKey === reminderKeyReordered);

  const remPreview = await buildOutboundPreview({
    practiceId: company.id,
    actorUserId: partner.id,
    kind: "DOCUMENT_REQUEST_REMINDER",
    clientRelationshipId: coRel.id,
    subject: "2 documents still outstanding",
    body: "Two items remain outstanding for FY 2025-26 Q1.",
    contactIds: [cfo.id],
  });

  const sendOnce = () =>
    sendOutbound({
      practiceId: company.id,
      actorUserId: partner.id,
      kind: "DOCUMENT_REQUEST_REMINDER",
      clientRelationshipId: coRel.id,
      subject: "2 documents still outstanding",
      body: "Two items remain outstanding for FY 2025-26 Q1.",
      contactIds: [cfo.id],
      confirmedPreviewHash: remPreview.previewHash,
      dedupKey: reminderKey,
    });

  // Genuinely concurrent — both promises are in flight before either resolves.
  const [workerA, workerB] = await Promise.all([sendOnce(), sendOnce()]);

  const rows = await prisma.outboundMessage.findMany({ where: { dedupKey: reminderKey } });
  check("two concurrent workers create exactly ONE message row", rows.length === 1, `found ${rows.length}`);
  check(
    "...both workers return the same message id",
    workerA.message.id === workerB.message.id,
  );
  check(
    "...and exactly one of them reports it as a duplicate rather than a failure",
    [workerA.duplicateOf, workerB.duplicateOf].filter((x) => x !== null).length === 1,
  );
  const recipientRows = await prisma.outboundRecipient.count({ where: { messageId: rows[0].id } });
  check("...with one recipient row, not two", recipientRows === 1);

  // A third, later worker is still deduplicated.
  const workerC = await sendOnce();
  check("a later retry is deduplicated too", workerC.message.id === rows[0].id && workerC.duplicateOf !== null);

  // Quiet hours.
  check("quiet hours 22:00-08:00 catch 23:30", inQuietHours(23 * 60 + 30, 1320, 480));
  check("...and 02:00", inQuietHours(120, 1320, 480));
  check("...but not 10:00", !inQuietHours(600, 1320, 480));
  check("a non-wrapping window 09:00-17:00 catches 12:00", inQuietHours(720, 540, 1020));
  check("...and not 20:00", !inQuietHours(1200, 540, 1020));

  // A window anchored on the CURRENT local minute, so the assertion means the
  // same thing whatever time the suite runs at. An earlier version used
  // 00:00-23:59 as "the whole day" — which excludes 23:59 itself, and so
  // silently turned both this check and the exemption check below into
  // no-ops for one minute a day.
  const istMinuteNow = (() => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    return h * 60 + m;
  })();

  await prisma.notificationPreference.create({
    data: {
      practiceId: company.id,
      contactId: accountant.id,
      quietFromMinute: istMinuteNow,
      quietToMinute: (istMinuteNow + 60) % 1440,
      timeZone: "Asia/Kolkata",
      quietHoursOverrideKinds: ["DEADLINE_REMINDER"],
    },
  });

  const quietPreview = await buildOutboundPreview({
    practiceId: company.id,
    actorUserId: partner.id,
    kind: "DOCUMENT_REQUEST_REMINDER",
    clientRelationshipId: coRel.id,
    subject: "Quiet hours test",
    body: "Body",
    contactIds: [accountant.id],
  });
  const quietSend = await sendOutbound({
    practiceId: company.id,
    actorUserId: partner.id,
    kind: "DOCUMENT_REQUEST_REMINDER",
    clientRelationshipId: coRel.id,
    subject: "Quiet hours test",
    body: "Body",
    contactIds: [accountant.id],
    confirmedPreviewHash: quietPreview.previewHash,
    dedupKey: tag("quiet"),
  });
  check(
    "a message inside quiet hours is HELD, not dropped",
    quietSend.message.state === "HELD_QUIET_HOURS",
    `state=${quietSend.message.state}, window=${istMinuteNow}-${(istMinuteNow + 60) % 1440}`,
  );
  check(
    "...with a time to release it, after the window closes",
    quietSend.message.scheduledFor !== null && quietSend.message.scheduledFor > new Date(),
  );

  const urgentPreview = await buildOutboundPreview({
    practiceId: company.id,
    actorUserId: partner.id,
    kind: "DEADLINE_REMINDER",
    clientRelationshipId: coRel.id,
    subject: "Statutory deadline",
    body: "Body",
    contactIds: [accountant.id],
  });
  const urgentSend = await sendOutbound({
    practiceId: company.id,
    actorUserId: partner.id,
    kind: "DEADLINE_REMINDER",
    clientRelationshipId: coRel.id,
    subject: "Statutory deadline",
    body: "Body",
    contactIds: [accountant.id],
    confirmedPreviewHash: urgentPreview.previewHash,
    dedupKey: tag("urgent"),
  });
  check(
    "an explicitly exempted kind passes through the SAME quiet window",
    urgentSend.message.state === "QUEUED" && quietSend.message.state === "HELD_QUIET_HOURS",
    `urgent=${urgentSend.message.state}, ordinary=${quietSend.message.state}`,
  );

  // Delivery states, kept separate.
  const target = rows[0].id;
  const submitted = await recordProviderAcceptance({
    practiceId: company.id,
    messageId: target,
    providerReference: "fictional-provider-ref-1",
  });
  check("provider acceptance records SUBMITTED", submitted.state === "SUBMITTED");
  check("...and does NOT set deliveredAt", submitted.deliveredAt === null);

  let evidence = await deliveryEvidence(company.id, target);
  check("acceptance is reported as acceptance", evidence.acceptedByProvider === true);
  check("...not as delivery", evidence.confirmedDeliveredByChannel === false);
  check("...and never as receipt by a person", evidence.provesReceiptByRecipient === false);
  check("...nor as reading", evidence.provesReading === false);
  check("...nor as filing", evidence.provesFiling === false);

  const delivered = await recordDeliveryConfirmation({ practiceId: company.id, messageId: target });
  check("an explicit channel confirmation sets DELIVERED", delivered.state === "DELIVERED");
  evidence = await deliveryEvidence(company.id, target);
  check("...and even DELIVERED does not prove the recipient read it", evidence.provesReading === false);

  const alreadyDelivered = await throws(
    () => recordProviderAcceptance({ practiceId: company.id, messageId: target, providerReference: "x" }),
    CommunicationError,
  );
  check("a delivered message cannot be walked backwards", alreadyDelivered?.code === "ALREADY_DELIVERED");

  // Retry limit.
  const retryTarget = urgentSend.message.id;
  const attempt1 = await recordFailure({
    practiceId: company.id,
    messageId: retryTarget,
    detail: "Temporary provider error",
  });
  check("a transient failure requeues for retry", attempt1.state === "QUEUED" && attempt1.attemptCount === 1);
  await recordFailure({ practiceId: company.id, messageId: retryTarget, detail: "Temporary provider error" });
  const attempt3 = await recordFailure({
    practiceId: company.id,
    messageId: retryTarget,
    detail: "Temporary provider error",
  });
  check("the retry limit turns it FAILED, not an endless loop", attempt3.state === "FAILED" && attempt3.attemptCount === 3);
  const attemptRows = await prisma.deliveryAttempt.count({ where: { messageId: retryTarget } });
  check("...and every attempt is kept", attemptRows === 3);

  // Bounce.
  const bouncePreview = await buildOutboundPreview({
    practiceId: company.id,
    actorUserId: partner.id,
    kind: "CLIENT_MESSAGE",
    clientRelationshipId: coRel.id,
    subject: "Bounce test",
    body: "Body",
    contactIds: [accountant.id],
  });
  const bounceSend = await sendOutbound({
    practiceId: company.id,
    actorUserId: partner.id,
    kind: "CLIENT_MESSAGE",
    clientRelationshipId: coRel.id,
    subject: "Bounce test",
    body: "Body",
    contactIds: [accountant.id],
    confirmedPreviewHash: bouncePreview.previewHash,
    dedupKey: tag("bounce"),
  });
  const bounced = await recordFailure({
    practiceId: company.id,
    messageId: bounceSend.message.id,
    detail: "550 mailbox does not exist",
    isBounce: true,
    bounceKind: "HARD",
  });
  check("a hard bounce is terminal on the first attempt", bounced.state === "FAILED" && bounced.attemptCount === 1);
  const bounceEvidence = await deliveryEvidence(company.id, bounceSend.message.id);
  check("a bounce is recorded as a bounce", bounceEvidence.bounced === true);
  check("...and is never evidence of receipt", bounceEvidence.provesReceiptByRecipient === false);
  const bouncedContact = await prisma.contact.findUniqueOrThrow({ where: { id: accountant.id } });
  check(
    "...and the bounced channel stops being VERIFIED",
    bouncedContact.emailVerificationStatus === "UNVERIFIED",
  );

  // Delivery uncertain — its own state, neither optimistic nor pessimistic.
  const uncertainPreview = await buildOutboundPreview({
    practiceId: company.id,
    actorUserId: partner.id,
    kind: "CLIENT_MESSAGE",
    clientRelationshipId: coRel.id,
    subject: "Uncertain test",
    body: "Body",
    contactIds: [cfo.id],
  });
  const uncertainSend = await sendOutbound({
    practiceId: company.id,
    actorUserId: partner.id,
    kind: "CLIENT_MESSAGE",
    clientRelationshipId: coRel.id,
    subject: "Uncertain test",
    body: "Body",
    contactIds: [cfo.id],
    confirmedPreviewHash: uncertainPreview.previewHash,
    dedupKey: tag("uncertain"),
  });
  const uncertain = await recordDeliveryUncertain({
    practiceId: company.id,
    messageId: uncertainSend.message.id,
    detail: "Provider timed out with no response",
  });
  check("a silent channel is DELIVERY_UNCERTAIN", uncertain.state === "DELIVERY_UNCERTAIN");
  const uncertainEvidence = await deliveryEvidence(company.id, uncertainSend.message.id);
  check(
    "...which claims neither delivery nor failure",
    uncertainEvidence.confirmedDeliveredByChannel === false && uncertainEvidence.bounced === false,
  );

  // Digest.
  const digestContact = await prisma.contact.create({
    data: {
      partyId: party.id,
      fullName: "Fictional Digest Recipient",
      email: `dig-${RUN}@example.invalid`,
      emailVerificationStatus: "VERIFIED",
    },
  });
  await prisma.contactAuthority.create({
    data: {
      practiceId: company.id,
      contactId: digestContact.id,
      clientRelationshipId: coRel.id,
      authority: "VIEW_ONLY",
      effectiveFrom: d("2024-04-01"),
    },
  });
  await prisma.notificationPreference.create({
    data: { practiceId: company.id, contactId: digestContact.id, digestMode: "DAILY_DIGEST" },
  });

  for (const n of [1, 2, 3]) {
    const p = await buildOutboundPreview({
      practiceId: company.id,
      actorUserId: partner.id,
      kind: "DOCUMENT_REQUEST_REMINDER",
      clientRelationshipId: coRel.id,
      subject: `Outstanding item ${n}`,
      body: "Body",
      contactIds: [digestContact.id],
    });
    await sendOutbound({
      practiceId: company.id,
      actorUserId: partner.id,
      kind: "DOCUMENT_REQUEST_REMINDER",
      clientRelationshipId: coRel.id,
      subject: `Outstanding item ${n}`,
      body: "Body",
      contactIds: [digestContact.id],
      confirmedPreviewHash: p.previewHash,
      dedupKey: tag(`digest-${n}`),
    });
  }

  const digest = await buildDigest({ practiceId: company.id, contactId: digestContact.id });
  check("three pending reminders collapse into one digest", digest !== null && digest.kind === "DIGEST");
  check("...listing all three", (digest?.renderedBody.match(/Outstanding item/g) ?? []).length === 3);
  const folded = await prisma.outboundMessage.findMany({
    where: { practiceId: company.id, dedupKey: { in: [tag("digest-1"), tag("digest-2"), tag("digest-3")] } },
  });
  check(
    "...and the originals are SUPPRESSED, not deleted — the record still shows what was owed",
    folded.length === 3 && folded.every((m) => m.state === "SUPPRESSED"),
  );

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error("\nTEST RUN ERROR:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
