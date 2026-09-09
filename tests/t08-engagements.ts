/**
 * T08 acceptance test — ENG01-04, ENG06 (PRD §12). ENG05 is R1.
 *
 * PRD acceptance evidence, verbatim:
 *   "Change an accepted annual retainer to add litigation work. The original
 *    scope stays intact; a new fee and authority review appears; existing GST
 *    jobs are not recreated. An independence block prevents activation until
 *    an eligible reviewer resolves it."
 *
 * Runs entirely against the library and database — no HTTP server needed.
 *
 * All fixture data is fictional.
 * Run: npm run test:t08
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  EngagementError,
  activateEngagement,
  approveEngagementChange,
  approveEngagementLetter,
  closeEngagement,
  closureTraceability,
  createEngagement,
  createServiceTemplate,
  generateEngagementLetter,
  raiseBlock,
  recordLetterAcceptance,
  requestEngagementChange,
  resolveBlock,
} from "../src/lib/engagements";

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

/** Refused for ANY reason. Use where several correct guards could fire. */
async function refused(fn: () => Promise<unknown>): Promise<Error | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e as Error;
  }
}

const RUN = Date.now();
const tag = (s: string) => `${s}-${RUN}`;

async function main() {
  console.log("\nT08 — engagements (PRD §12 ENG01-04, ENG06)\n");

  // ---------------------------------------------------------------- fixtures
  const tenant = await prisma.tenant.create({ data: { name: tag("T") } });
  const practice = await prisma.practice.create({
    data: {
      tenantId: tenant.id, name: tag("Company"), constitution: "LLP",
      documentNamespace: tag("co"), effectiveFrom: new Date("2024-04-01"),
    },
  });

  const partner = await prisma.user.create({
    data: { email: `partner-${RUN}@example.invalid`, fullName: "Fictional Partner", status: "ACTIVE" },
  });
  const manager = await prisma.user.create({
    data: { email: `manager-${RUN}@example.invalid`, fullName: "Fictional Manager", status: "ACTIVE" },
  });
  const partner2 = await prisma.user.create({
    data: { email: `partner2-${RUN}@example.invalid`, fullName: "Second Partner", status: "ACTIVE" },
  });
  const qualityReviewer = await prisma.user.create({
    data: { email: `qr-${RUN}@example.invalid`, fullName: "Quality Reviewer", status: "ACTIVE" },
  });
  const article = await prisma.user.create({
    data: { email: `article-${RUN}@example.invalid`, fullName: "Fictional Article", status: "ACTIVE" },
  });

  await prisma.practiceMembership.createMany({
    data: [
      { practiceId: practice.id, userId: partner.id, role: "PRACTICE_PARTNER", assignmentScope: "PRACTICE", effectiveFrom: new Date("2024-04-01") },
      { practiceId: practice.id, userId: partner2.id, role: "PRACTICE_PARTNER", assignmentScope: "PRACTICE", effectiveFrom: new Date("2024-04-01") },
      { practiceId: practice.id, userId: manager.id, role: "MANAGER", assignmentScope: "PRACTICE", effectiveFrom: new Date("2024-04-01") },
      { practiceId: practice.id, userId: qualityReviewer.id, role: "QUALITY_REVIEWER", assignmentScope: "PRACTICE", effectiveFrom: new Date("2024-04-01") },
      { practiceId: practice.id, userId: article.id, role: "STAFF_ARTICLE", assignmentScope: "OWN_WORK", effectiveFrom: new Date("2024-04-01") },
    ],
  });

  const party = await prisma.party.create({
    data: { tenantId: tenant.id, legalName: tag("Retainer Client Limited"), type: "COMPANY" },
  });
  const relationship = await prisma.clientRelationship.create({
    data: { practiceId: practice.id, partyId: party.id, acceptanceStatus: "ACCEPTED" },
  });
  await prisma.acceptanceCheck.create({
    data: {
      practiceId: practice.id, clientRelationshipId: relationship.id,
      scope: "Annual GST retainer", competenceAssessment: "Team competent",
      resourcesAssessment: "Resourced", ethicalThreats: "None",
      clientAuthority: "Board resolution (fictional)",
      conflictSummary: {} as never,
      decision: "ACCEPTED", partnerUserId: partner.id,
      partnerName: "Fictional Partner", decidedAt: new Date(),
    },
  });

  // ---------------------------------------------------------------- ENG01
  console.log("ENG01 — versioned service catalogue");

  const gstV1 = await createServiceTemplate({
    tenantId: tenant.id, code: "GST", version: 1, name: "GST compliance retainer",
    category: "TAX",
    documentChecklist: ["Sales register", "Purchase register"],
    steps: ["Collect data", "Prepare return", "Review", "File"],
    reviewGates: ["Reviewer signoff before filing"],
    deliverables: ["GSTR-1", "GSTR-3B"],
    feeModel: { basis: "MONTHLY_RETAINER", amount: "15000.00" },
    approvedByName: "Fictional Partner",
  });
  const gstV2 = await createServiceTemplate({
    tenantId: tenant.id, code: "GST", version: 2, name: "GST compliance retainer (rev)",
    category: "TAX", feeModel: { basis: "MONTHLY_RETAINER", amount: "18000.00" },
    approvedByName: "Fictional Partner",
  });
  await createServiceTemplate({
    tenantId: tenant.id, code: "AUDIT", version: 1, name: "Statutory audit",
    category: "ASSURANCE", feeModel: { basis: "FIXED" },
  });

  check("templates are versioned, not overwritten", gstV1.version === 1 && gstV2.version === 2);
  check(
    "a template defines checklist, steps, gates, deliverables and fee model",
    Array.isArray(gstV1.documentChecklist) &&
      Array.isArray(gstV1.steps) &&
      Array.isArray(gstV1.reviewGates) &&
      gstV1.feeModel !== null,
  );

  // ---------------------------------------------------------------- ENG02
  console.log("\nENG02 — engagement record");

  const ownerIsReviewer = await throws(
    () =>
      createEngagement({
        userId: manager.id, practiceId: practice.id, clientRelationshipId: relationship.id,
        templateCode: "GST", templateVersion: 1, kind: "ANNUAL_RETAINER",
        periodStart: new Date("2025-04-01"), periodEnd: new Date("2026-03-31"),
        scope: "Monthly GST compliance", feeBasis: "Monthly retainer INR 15,000",
        ownerUserId: manager.id, reviewerUserId: manager.id,
      }),
    EngagementError,
  );
  check("an engagement owner cannot also be its reviewer", ownerIsReviewer !== null);

  const retainer = await createEngagement({
    userId: manager.id,
    practiceId: practice.id,
    clientRelationshipId: relationship.id,
    templateCode: "GST",
    templateVersion: 1,
    kind: "ANNUAL_RETAINER",
    periodStart: new Date("2025-04-01"),
    periodEnd: new Date("2026-03-31"),
    scope: "Monthly GST compliance: GSTR-1 and GSTR-3B preparation and filing",
    exclusions: "Litigation, appeals and representation before authorities",
    feeBasis: "Monthly retainer INR 15,000",
    ownerUserId: manager.id,
    reviewerUserId: partner.id,
    plannedStartDate: new Date("2025-04-01"),
  });

  check("the engagement pins the template VERSION it was created from", retainer.templateVersion === "1");
  check("an annual retainer is distinguishable from ad hoc work", retainer.kind === "ANNUAL_RETAINER");
  check("scope, exclusions and fee basis are required particulars", !!retainer.scope && !!retainer.exclusions && !!retainer.feeBasis);

  // ---------------------------------------------------------------- ENG03
  console.log("\nENG03 — terms and authority");

  const letter = await generateEngagementLetter({
    userId: manager.id, practiceId: practice.id, engagementId: retainer.id,
  });
  check("a letter is generated from the engagement", letter.reviewState === "DRAFT");
  check("the generated body is hashed so the sent version is identifiable", letter.bodyHash.length === 64);

  const acceptBeforeApproval = await throws(
    () =>
      recordLetterAcceptance({
        letterId: letter.id, acceptanceKind: "TYPED_CONSENT",
        signatoryName: "Fictional Director", signatoryCapacity: "Director",
        evidence: {},
      }),
    EngagementError,
  );
  check("acceptance cannot be recorded before the draft is reviewed", acceptBeforeApproval !== null);

  // The manager is the owner AND lacks engagement.accept — either guard is a
  // correct refusal, so assert the outcome rather than a particular reason.
  const managerApprove = await refused(() =>
    approveEngagementLetter({
      letterId: letter.id, approverUserId: manager.id, approverName: "Fictional Manager",
    }),
  );
  check("the engagement owner cannot approve their own letter", managerApprove !== null);

  // Now the guard itself, with an actor who DOES hold engagement.accept:
  // a partner who owns an engagement still cannot approve its own letter.
  const partnerOwned = await createEngagement({
    userId: partner.id, practiceId: practice.id, clientRelationshipId: relationship.id,
    templateCode: "GST", templateVersion: 2, kind: "AD_HOC",
    periodStart: new Date("2025-04-01"), periodEnd: new Date("2026-03-31"),
    scope: "Ad hoc GST advisory", feeBasis: "Hourly",
    ownerUserId: partner.id, reviewerUserId: manager.id,
  });
  const partnerLetter = await generateEngagementLetter({
    userId: partner.id, practiceId: practice.id, engagementId: partnerOwned.id,
  });
  const partnerSelfApprove = await throws(
    () =>
      approveEngagementLetter({
        letterId: partnerLetter.id, approverUserId: partner.id, approverName: "Fictional Partner",
      }),
    EngagementError,
  );
  check(
    "even a partner WITH approval authority cannot approve a letter for their own engagement",
    partnerSelfApprove?.code === "SELF_APPROVAL",
    partnerSelfApprove?.code ?? "not refused",
  );

  // A second partner can, and does — leaving an ACCEPTED engagement to test
  // change control against later.
  await approveEngagementLetter({
    letterId: partnerLetter.id, approverUserId: partner2.id, approverName: "Second Partner",
  });
  await recordLetterAcceptance({
    letterId: partnerLetter.id, acceptanceKind: "ELECTRONIC_ACCEPTANCE",
    signatoryName: "Fictional Director", signatoryCapacity: "Director",
    evidence: { method: "portal click-through" },
  });
  const partnerOwnedAccepted = await prisma.engagement.findUniqueOrThrow({
    where: { id: partnerOwned.id },
  });
  check("a second partner can approve it", partnerOwnedAccepted.state === "ACCEPTED");

  await approveEngagementLetter({
    letterId: letter.id, approverUserId: partner.id, approverName: "Fictional Partner",
  });

  const accepted = await recordLetterAcceptance({
    letterId: letter.id,
    acceptanceKind: "ELECTRONIC_ACCEPTANCE",
    signatoryName: "Fictional Director",
    signatoryCapacity: "Director",
    evidence: { method: "portal click-through", ip: "203.0.113.10", at: new Date().toISOString() },
  });
  check(
    "the acceptance KIND is recorded distinctly, not flattened to a boolean",
    accepted.acceptanceKind === "ELECTRONIC_ACCEPTANCE",
  );
  check("the signatory's capacity is recorded", accepted.signatoryCapacity === "Director");

  // Signing method must suit the document type.
  const auditEngagement = await createEngagement({
    userId: manager.id, practiceId: practice.id, clientRelationshipId: relationship.id,
    templateCode: "AUDIT", templateVersion: 1, kind: "AD_HOC",
    periodStart: new Date("2025-04-01"), periodEnd: new Date("2026-03-31"),
    scope: "Statutory audit FY2025-26", feeBasis: "Fixed fee",
    ownerUserId: manager.id, reviewerUserId: partner.id,
  });
  const auditLetter = await generateEngagementLetter({
    userId: manager.id, practiceId: practice.id, engagementId: auditEngagement.id,
  });
  await approveEngagementLetter({
    letterId: auditLetter.id, approverUserId: partner.id, approverName: "Fictional Partner",
  });
  const typedForAudit = await throws(
    () =>
      recordLetterAcceptance({
        letterId: auditLetter.id, acceptanceKind: "TYPED_CONSENT",
        signatoryName: "Fictional Director", signatoryCapacity: "Director", evidence: {},
      }),
    EngagementError,
  );
  check(
    "typed consent is refused for a statutory audit — a name in a box is not a signature",
    typedForAudit?.code === "SIGNING_METHOD_NOT_APPROVED",
  );

  const retainerAfterAcceptance = await prisma.engagement.findUniqueOrThrow({
    where: { id: retainer.id },
  });
  check("acceptance freezes the accepted particulars", retainerAfterAcceptance.acceptedSnapshot !== null);
  check("the engagement is now ACCEPTED", retainerAfterAcceptance.state === "ACCEPTED");

  // Existing GST jobs, generated under the ORIGINAL retainer.
  const gstJobs = [];
  for (const month of ["2025-04", "2025-05", "2025-06"]) {
    gstJobs.push(
      await prisma.job.create({
        data: {
          practiceId: practice.id, engagementId: retainer.id,
          title: `GSTR-3B ${month}`, periodKey: month,
          dedupKey: `${retainer.id}:GSTR3B:${month}`, state: "COMPLETED",
          completedAt: new Date(),
        },
      }),
    );
  }
  check("three monthly GST jobs exist under the retainer", gstJobs.length === 3);

  // ------------------- ACCEPTANCE EVIDENCE: add litigation to the retainer
  console.log("\nAcceptance evidence — adding litigation work to an ACCEPTED retainer");

  const change = await requestEngagementChange({
    userId: manager.id,
    userName: "Fictional Manager",
    practiceId: practice.id,
    engagementId: retainer.id,
    changeType: "SCOPE",
    reason: "Client has received a GST show-cause notice and asks us to represent them",
    proposed: {
      scope:
        "Monthly GST compliance: GSTR-1 and GSTR-3B preparation and filing; " +
        "PLUS representation in GST litigation and appeals",
      feeBasis: "Monthly retainer INR 15,000 plus litigation billed hourly",
    },
  });

  check("a post-acceptance scope change raises a CHANGE, not an edit", change.status === "PENDING_REVIEW");
  check("the change requires a new FEE review", change.requiresFeeReview);
  check("the change requires a new AUTHORITY review", change.requiresAuthorityReview);

  const managerApproveChange = await refused(() =>
    approveEngagementChange({
      changeId: change.id, approverUserId: manager.id, approverName: "Fictional Manager",
    }),
  );
  check("the requester cannot approve their own change", managerApproveChange !== null);

  const revision = await approveEngagementChange({
    changeId: change.id, approverUserId: partner.id, approverName: "Fictional Partner",
  });

  // THE ORIGINAL MUST BE INTACT.
  const originalAfter = await prisma.engagement.findUniqueOrThrow({ where: { id: retainer.id } });
  check(
    "the ORIGINAL scope is unchanged",
    originalAfter.scope === "Monthly GST compliance: GSTR-1 and GSTR-3B preparation and filing",
    originalAfter.scope ?? "",
  );
  check(
    "the original still excludes litigation, as accepted",
    (originalAfter.exclusions ?? "").includes("Litigation"),
  );
  check("the original's fee basis is unchanged", originalAfter.feeBasis === "Monthly retainer INR 15,000");
  check(
    "the original's accepted snapshot is untouched",
    JSON.stringify(originalAfter.acceptedSnapshot) ===
      JSON.stringify(retainerAfterAcceptance.acceptedSnapshot),
  );
  check("the original is marked superseded, not deleted", originalAfter.supersededAt !== null);

  // THE REVISION carries the new scope.
  check("a revision engagement was created", revision.parentEngagementId === retainer.id);
  check("the revision is numbered", revision.revisionNumber === 1);
  check("the revision carries the combined scope", (revision.scope ?? "").includes("litigation"));
  check(
    "the revision is NOT automatically accepted — the client must accept revised terms",
    revision.state === "PENDING_ACCEPTANCE",
    revision.state,
  );

  // THE REVIEWS must be visible as blocks.
  const revisionBlocks = await prisma.engagementBlock.findMany({
    where: { engagementId: revision.id, resolvedAt: null },
  });
  check(
    "a fee review appears against the revision",
    revisionBlocks.some((b) => b.kind === "FEE_APPROVAL"),
  );
  check(
    "an authority review appears against the revision",
    revisionBlocks.some((b) => b.kind === "AUTHORITY"),
  );

  // EXISTING GST JOBS MUST NOT BE RECREATED.
  const jobsOnOriginal = await prisma.job.count({ where: { engagementId: retainer.id } });
  const jobsOnRevision = await prisma.job.count({ where: { engagementId: revision.id } });
  check("the three existing GST jobs stay on the original engagement", jobsOnOriginal === 3);
  check(
    "NO GST jobs were recreated on the revision",
    jobsOnRevision === 0,
    `${jobsOnRevision} jobs found on the revision`,
  );
  const allGstJobs = await prisma.job.count({
    where: { practiceId: practice.id, title: { startsWith: "GSTR-3B" } },
  });
  check("there are still exactly three GST jobs in total, not six", allGstJobs === 3, `${allGstJobs}`);

  // A partner who requests a change cannot approve it either — this is the
  // self-approval guard proper, with an actor who holds engagement.accept.
  const partnerChange = await requestEngagementChange({
    userId: partner.id, userName: "Fictional Partner", practiceId: practice.id,
    engagementId: partnerOwnedAccepted.id, changeType: "FEE",
    reason: "Rate revision agreed with the client",
    proposed: { feeBasis: "Hourly, revised rate" },
  });
  const partnerSelfApproveChange = await throws(
    () =>
      approveEngagementChange({
        changeId: partnerChange.id, approverUserId: partner.id, approverName: "Fictional Partner",
      }),
    EngagementError,
  );
  check(
    "even a partner WITH approval authority cannot approve their own change request",
    partnerSelfApproveChange?.code === "SELF_APPROVAL",
    partnerSelfApproveChange?.code ?? "not refused",
  );

  // ------------------------------------- ENG04: practice reassignment
  console.log("\nENG04 — reassigning the responsible practice needs more than a dropdown");

  const otherPractice = await prisma.practice.create({
    data: {
      tenantId: tenant.id, name: tag("Associates"), constitution: "PARTNERSHIP",
      documentNamespace: tag("as"), effectiveFrom: new Date("2024-04-01"),
    },
  });

  // The audit engagement must be ACCEPTED first — otherwise the "not yet
  // accepted, just edit it" guard fires and we would not be testing the rule
  // we claim to be testing.
  await recordLetterAcceptance({
    letterId: auditLetter.id,
    acceptanceKind: "LEGALLY_EFFECTIVE_SIGNATURE",
    signatoryName: "Fictional Director",
    signatoryCapacity: "Director",
    evidence: { method: "DSC-signed PDF", certificateSerial: "FICTIONAL-SERIAL" },
  });

  const noArrangements = await throws(
    () =>
      requestEngagementChange({
        userId: manager.id, userName: "Fictional Manager", practiceId: practice.id,
        engagementId: auditEngagement.id, changeType: "PRACTICE",
        reason: "Move to the other practice",
        proposed: { targetPracticeId: otherPractice.id },
      }),
    EngagementError,
  );
  check(
    "a practice reassignment without documented client arrangements is refused",
    noArrangements?.code === "CLIENT_ARRANGEMENTS_REQUIRED",
    noArrangements?.code ?? "not refused",
  );

  const withArrangements = await requestEngagementChange({
    userId: manager.id, userName: "Fictional Manager", practiceId: practice.id,
    engagementId: auditEngagement.id, changeType: "PRACTICE",
    reason: "Client restructuring; work moves to the other practice",
    proposed: { targetPracticeId: otherPractice.id },
    clientArrangementsEvidence: "Signed client consent letter ref FICTIONAL-3, new authority obtained",
  });
  check(
    "with documented client arrangements it is accepted for review",
    withArrangements.requiresClientArrangements && withArrangements.requiresAuthorityReview,
  );

  // ------------------ ACCEPTANCE EVIDENCE: independence block blocks activation
  console.log("\nAcceptance evidence — an independence block prevents activation");

  const block = await raiseBlock({
    practiceId: practice.id,
    engagementId: auditEngagement.id,
    kind: "INDEPENDENCE",
    reason: "Firm provides bookkeeping to a related entity — self-review threat to assess",
    raisedByName: "Fictional Manager",
  });

  const blockedActivation = await throws(
    () =>
      activateEngagement({
        userId: manager.id, practiceId: practice.id, engagementId: auditEngagement.id,
      }),
    EngagementError,
  );
  check("activation is refused while an independence block is open", blockedActivation?.code === "BLOCKED");
  check(
    "the refusal names the independence issue",
    (blockedActivation?.message ?? "").includes("INDEPENDENCE"),
  );

  // Only an ELIGIBLE reviewer may clear it.
  const ownerClears = await throws(
    () =>
      resolveBlock({
        blockId: block.id, resolverUserId: manager.id, resolverName: "Fictional Manager",
        resolution: "I consider us independent",
      }),
    EngagementError,
  );
  check(
    "the engagement OWNER cannot clear their own independence block",
    ownerClears?.code === "NOT_ELIGIBLE_REVIEWER",
  );

  const articleClears = await throws(
    () =>
      resolveBlock({
        blockId: block.id, resolverUserId: article.id, resolverName: "Fictional Article",
        resolution: "Looks fine",
      }),
    EngagementError,
  );
  check("an article is not an eligible reviewer either", articleClears?.code === "NOT_ELIGIBLE_REVIEWER");

  const noReason = await throws(
    () =>
      resolveBlock({
        blockId: block.id, resolverUserId: qualityReviewer.id,
        resolverName: "Quality Reviewer", resolution: "   ",
      }),
    EngagementError,
  );
  check("a resolution must state a professional conclusion", noReason?.code === "RESOLUTION_REQUIRED");

  const stillBlocked = await throws(
    () =>
      activateEngagement({
        userId: manager.id, practiceId: practice.id, engagementId: auditEngagement.id,
      }),
    EngagementError,
  );
  check("activation is still refused after the failed attempts", stillBlocked?.code === "BLOCKED");

  await resolveBlock({
    blockId: block.id,
    resolverUserId: qualityReviewer.id,
    resolverName: "Quality Reviewer",
    resolution:
      "Bookkeeping for the related entity is performed by a separate team with no audit involvement; " +
      "safeguards documented. Independence concluded.",
  });

  const activatedAudit = await activateEngagement({
    userId: manager.id, practiceId: practice.id, engagementId: auditEngagement.id,
  });
  check(
    "once an eligible reviewer resolves it, activation proceeds",
    activatedAudit.state === "ACTIVE",
    activatedAudit.state,
  );

  const resolvedBlock = await prisma.engagementBlock.findUniqueOrThrow({ where: { id: block.id } });
  check("the resolution and its author are retained", (resolvedBlock.resolution ?? "").length > 0 && resolvedBlock.resolvedByName === "Quality Reviewer");

  // ---------------------------------------------------------------- ENG06
  console.log("\nENG06 — closure and termination");

  const openJob = await prisma.job.create({
    data: {
      practiceId: practice.id, engagementId: auditEngagement.id,
      title: "Audit fieldwork", periodKey: "2025-26",
      dedupKey: `${auditEngagement.id}:FIELDWORK:2025-26`, state: "IN_PROGRESS",
    },
  });

  const prematureClose = await throws(
    () =>
      closeEngagement({
        userId: manager.id, userName: "Fictional Manager", practiceId: practice.id,
        engagementId: auditEngagement.id, closureKind: "COMPLETION",
        reason: "Done",
      }),
    EngagementError,
  );
  check(
    "an engagement cannot be closed as COMPLETION with work still open",
    prematureClose?.code === "WORK_INCOMPLETE",
  );

  // A termination is available, but must be authorised and reasoned.
  const noReasonClose = await throws(
    () =>
      closeEngagement({
        userId: manager.id, userName: "Fictional Manager", practiceId: practice.id,
        engagementId: auditEngagement.id, closureKind: "WITHDRAWAL", reason: "  ",
      }),
    EngagementError,
  );
  check("a termination without a reason is refused", noReasonClose?.code === "REASON_REQUIRED");

  const withdrawn = await closeEngagement({
    userId: manager.id, userName: "Fictional Manager", practiceId: practice.id,
    engagementId: auditEngagement.id, closureKind: "WITHDRAWAL",
    reason: "Client did not provide records; withdrawal authorised by engagement partner",
  });
  check("withdrawal is distinguished from completion", withdrawn.closureKind === "WITHDRAWAL");
  check("a terminated engagement is TERMINATED, not CLOSED", withdrawn.state === "TERMINATED");
  check("the authoriser is named", withdrawn.closureAuthorisedByName === "Fictional Manager");

  // Completion works once the work is finished.
  await prisma.job.update({ where: { id: openJob.id }, data: { state: "COMPLETED", completedAt: new Date() } });
  const completed = await closeEngagement({
    userId: manager.id, userName: "Fictional Manager", practiceId: practice.id,
    engagementId: retainer.id, closureKind: "COMPLETION",
    reason: "All monthly returns filed and reviewed",
  });
  check("completion succeeds when the work is finished", completed.state === "CLOSED" && completed.closureKind === "COMPLETION");

  // Outstanding fees must remain traceable after closure.
  const series = await prisma.invoiceSeries.create({
    data: { practiceId: practice.id, code: tag("CO"), fiscalPeriod: "2025-26" },
  });
  const invoice = await prisma.invoice.create({
    data: {
      practiceId: practice.id, seriesId: series.id, clientRelationshipId: relationship.id,
      engagementId: retainer.id, sequenceNumber: 1, status: "ISSUED",
      issuedAt: new Date(), total: "45000.00",
    },
  });
  const receipt = await prisma.receipt.create({
    data: {
      practiceId: practice.id, clientRelationshipId: relationship.id,
      amount: "20000.00", receivedAt: new Date(), method: "NEFT",
    },
  });
  await prisma.receiptAllocation.create({
    data: {
      practiceId: practice.id, receiptId: receipt.id, invoiceId: invoice.id,
      kind: "PAYMENT", amount: "20000.00",
    },
  });

  const trace = await closureTraceability(retainer.id, practice.id);
  check(
    "an unpaid balance is still traceable after closure",
    trace.outstandingTotal === 25000,
    `outstanding ${trace.outstandingTotal}`,
  );
  check("the outstanding invoice is identified", trace.outstandingInvoices.length === 1);

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
