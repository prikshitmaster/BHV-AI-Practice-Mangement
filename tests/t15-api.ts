/**
 * T15 acceptance test — API01, API02, API03 (PRD §34).
 * API04 (integration access, versioned public APIs, webhook signatures) is R1
 * and not covered.
 *
 * PRD acceptance evidence, verbatim:
 *   "Two reviewers approve different versions simultaneously: only the current
 *    version can be approved. Two invoice issue clicks create one invoice. A
 *    delayed queue message after role revocation cannot export previously
 *    accessible files."
 *
 * All three are the sections marked EVIDENCE below. Everything else covers the
 * rules those headlines rest on, and each headline is paired with a CONTROL so
 * it cannot pass with the mechanism switched off.
 *
 * The two "simultaneously" clauses are run as REAL races — both calls in
 * flight at once through Promise.allSettled, not one after the other. A
 * sequential version of this test passes against a read-check-write
 * implementation that the concurrent version catches.
 *
 * Library level — no HTTP server required, no object store required.
 * All fixture data is fictional. Run: npm run test:t15
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { recordApproval, ApprovalError } from "../src/lib/approvals";
import {
  VersionConflictError,
  SubjectNotFoundError,
  updateWithVersion,
} from "../src/lib/concurrency";
import {
  emitEvent,
  dispatchOutbox,
  deadLetters,
  type OutboxConsumer,
} from "../src/lib/outbox";
import {
  withCorrelationId,
  correlationIdFrom,
  currentCorrelationId,
  CORRELATION_HEADER,
} from "../src/lib/correlation";
import { errorResponse, badRequest } from "../src/lib/api";
import { transitionJob } from "../src/lib/work";
import { recordEvent } from "../src/lib/audit";
import {
  createInvoiceSeries,
  draftInvoice,
  approveInvoice,
  issueInvoice,
} from "../src/lib/invoicing";
import { suspendUser, assertStillAuthorised } from "../src/lib/user-lifecycle";

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
  console.log("\nT15 — API contracts and concurrency (PRD §34 API01, API02, API03)\n");

  // ------------------------------------------------------------ fixtures

  const tenant = await prisma.tenant.create({ data: { name: tag("BHV") } });

  const practice = await prisma.practice.create({
    data: {
      tenantId: tenant.id,
      name: tag("Fictional Alpha & Co"),
      registeredDisplayName: tag("Fictional Alpha Registered"),
      constitution: "PARTNERSHIP",
      documentNamespace: `t15a-${RUN}`.toLowerCase(),
      effectiveFrom: d("2024-04-01"),
    },
  });

  const otherPractice = await prisma.practice.create({
    data: {
      tenantId: tenant.id,
      name: tag("Fictional Beta Associates"),
      registeredDisplayName: tag("Fictional Beta Registered"),
      constitution: "PARTNERSHIP",
      documentNamespace: `t15b-${RUN}`.toLowerCase(),
      effectiveFrom: d("2024-04-01"),
    },
  });

  async function makeUser(label: string) {
    return prisma.user.create({
      data: {
        email: `${label}-${RUN}@example.invalid`,
        fullName: `Fictional ${label}`,
        status: "ACTIVE",
      },
    });
  }

  // Two reviewers, because the headline evidence is two of them approving at
  // the same moment, and one preparer who authors the work.
  const preparer = await makeUser("Preparer");
  const reviewerA = await makeUser("ReviewerA");
  const reviewerB = await makeUser("ReviewerB");
  const leaver = await makeUser("Leaver");
  const partner = await makeUser("Partner");

  for (const user of [preparer, reviewerA, reviewerB, leaver, partner]) {
    await prisma.practiceMembership.create({
      data: {
        practiceId: practice.id,
        userId: user.id,
        role: "PRACTICE_PARTNER",
        assignmentScope: "PRACTICE",
        effectiveFrom: d("2024-04-01"),
      },
    });
  }

  const party = await prisma.party.create({
    data: { tenantId: tenant.id, legalName: tag("Fictional Client Private Limited"), type: "COMPANY" },
  });
  const relationship = await prisma.clientRelationship.create({
    data: { practiceId: practice.id, partyId: party.id, acceptanceStatus: "ACCEPTED" },
  });
  const engagement = await prisma.engagement.create({
    data: {
      practiceId: practice.id,
      clientRelationshipId: relationship.id,
      serviceCode: "GST_ANNUAL",
      templateVersion: "1",
      periodStart: d("2025-04-01"),
      periodEnd: d("2026-03-31"),
    },
  });

  async function makeJob(label: string) {
    return prisma.job.create({
      data: {
        practiceId: practice.id,
        engagementId: engagement.id,
        title: tag(label),
        periodKey: "2025-04",
        dedupKey: `${label}-${RUN}`,
        state: "READY",
      },
    });
  }

  // =========================================================== EVIDENCE 1
  console.log("API02 EVIDENCE — two reviewers approve different versions at once");

  const job = await makeJob("Fictional GST annual filing");

  await transitionJob({
    jobId: job.id,
    practiceId: practice.id,
    toState: "IN_PROGRESS",
    actorUserId: preparer.id,
    actorName: "Fictional Preparer",
  });
  // Reviewer A opens the job here and holds this version on their screen.
  const seenByA = await transitionJob({
    jobId: job.id,
    practiceId: practice.id,
    toState: "IN_REVIEW",
    actorUserId: preparer.id,
    actorName: "Fictional Preparer",
  });

  // The preparer sends it back and resubmits: the job moves on while A is
  // still looking at the older version.
  await transitionJob({
    jobId: job.id,
    practiceId: practice.id,
    toState: "CHANGES_REQUESTED",
    actorUserId: preparer.id,
    actorName: "Fictional Preparer",
    reason: "Fictional rework",
  });
  await transitionJob({
    jobId: job.id,
    practiceId: practice.id,
    toState: "IN_PROGRESS",
    actorUserId: preparer.id,
    actorName: "Fictional Preparer",
  });
  const seenByB = await transitionJob({
    jobId: job.id,
    practiceId: practice.id,
    toState: "IN_REVIEW",
    actorUserId: preparer.id,
    actorName: "Fictional Preparer",
  });

  check(
    "fixture: reviewer A holds an older version than reviewer B",
    seenByA.version < seenByB.version,
    `A saw ${seenByA.version}, B saw ${seenByB.version}`,
  );

  // Both fired at once. Not sequentially — a sequential test passes against a
  // read-check-write implementation this one is meant to catch.
  const [outcomeA, outcomeB] = await Promise.allSettled([
    recordApproval({
      practiceId: practice.id,
      subjectType: "FILING",
      subjectId: job.id,
      expectedVersion: seenByA.version,
      decision: "APPROVED",
      approverUserId: reviewerA.id,
      approverDisplayName: "Fictional ReviewerA",
      authority: "REVIEWER",
    }),
    recordApproval({
      practiceId: practice.id,
      subjectType: "FILING",
      subjectId: job.id,
      expectedVersion: seenByB.version,
      decision: "APPROVED",
      approverUserId: reviewerB.id,
      approverDisplayName: "Fictional ReviewerB",
      authority: "REVIEWER",
    }),
  ]);

  check(
    "EVIDENCE: the reviewer holding the STALE version is refused",
    outcomeA.status === "rejected" &&
      outcomeA.reason instanceof VersionConflictError,
    outcomeA.status === "rejected"
      ? `${(outcomeA.reason as Error).name}`
      : "the stale approval succeeded",
  );

  check(
    "EVIDENCE: the reviewer holding the CURRENT version is accepted",
    outcomeB.status === "fulfilled" && outcomeB.value.subjectVersion === seenByB.version,
    outcomeB.status === "rejected" ? String(outcomeB.reason) : "",
  );

  const approvalsOnJob = await prisma.approval.findMany({
    where: { practiceId: practice.id, subjectType: "FILING", subjectId: job.id },
  });
  check(
    "EVIDENCE: exactly one approval exists, and it names the current version",
    approvalsOnJob.length === 1 && approvalsOnJob[0].subjectVersion === seenByB.version,
    `${approvalsOnJob.length} approvals`,
  );

  // API02's second half: the loser must be given something to DO, or they
  // simply re-approve over the winner, which is last-write-wins with extra
  // steps.
  const conflict =
    outcomeA.status === "rejected" && outcomeA.reason instanceof VersionConflictError
      ? outcomeA.reason.comparison
      : null;
  check(
    "API02: the refusal carries a comparison naming both versions",
    conflict?.expectedVersion === seenByA.version && conflict?.currentVersion === seenByB.version,
    conflict ? `${conflict.expectedVersion} vs ${conflict.currentVersion}` : "no comparison",
  );
  check(
    "API02: the comparison names who moved the record last",
    !!conflict?.lastChange && conflict.lastChange.actorUserId === preparer.id,
    conflict?.lastChange ? conflict.lastChange.action : "no lastChange",
  );
  check(
    "API02: reload is offered as the resolution",
    !!conflict?.resolutions.includes("reload"),
    conflict ? conflict.resolutions.join(",") : "",
  );

  // CONTROL — the same reviewer, the same subject, naming the current version.
  const controlApproval = await recordApproval({
    practiceId: practice.id,
    subjectType: "FILING",
    subjectId: job.id,
    expectedVersion: seenByB.version,
    decision: "APPROVED",
    approverUserId: reviewerA.id,
    approverDisplayName: "Fictional ReviewerA",
    authority: "REVIEWER",
  });
  check(
    "CONTROL — the refused reviewer succeeds once they reload the current version",
    controlApproval.subjectVersion === seenByB.version && !controlApproval.duplicate,
  );

  // A second click is the same decision, not a second one.
  const secondClick = await recordApproval({
    practiceId: practice.id,
    subjectType: "FILING",
    subjectId: job.id,
    expectedVersion: seenByB.version,
    decision: "APPROVED",
    approverUserId: reviewerA.id,
    approverDisplayName: "Fictional ReviewerA",
    authority: "REVIEWER",
  });
  check(
    "API02: a repeated click records one approval, not two",
    secondClick.duplicate && secondClick.approvalId === controlApproval.approvalId,
  );

  // An approval must name a version — it can never be defaulted.
  const noVersion = await throws(
    () =>
      recordApproval({
        practiceId: practice.id,
        subjectType: "FILING",
        subjectId: job.id,
        expectedVersion: -1,
        decision: "APPROVED",
        approverUserId: reviewerB.id,
        approverDisplayName: "Fictional ReviewerB",
        authority: "REVIEWER",
      }),
    ApprovalError,
  );
  check(
    "API02: an approval with no stated version is refused",
    noVersion?.code === "EXPECTED_VERSION_REQUIRED",
    noVersion?.code ?? "no error",
  );

  // API01: a subject in another practice is NOT FOUND, never FORBIDDEN.
  const crossPractice = await throws(
    () =>
      recordApproval({
        practiceId: otherPractice.id,
        subjectType: "FILING",
        subjectId: job.id,
        expectedVersion: seenByB.version,
        decision: "APPROVED",
        approverUserId: reviewerB.id,
        approverDisplayName: "Fictional ReviewerB",
        authority: "REVIEWER",
      }),
    SubjectNotFoundError,
  );
  check(
    "API01/ORG04: approving another practice's subject is 404, not 403",
    crossPractice !== null && crossPractice.status === 404,
    crossPractice ? "" : "no SubjectNotFoundError",
  );

  // ---------------------------------------------------- API02 generally
  console.log("\nAPI02 — the version check as a general property");

  const staleUpdate = await throws(
    () =>
      updateWithVersion({
        delegate: prisma.job as never,
        subjectType: "Job",
        subjectId: job.id,
        scope: { practiceId: practice.id },
        expectedVersion: seenByA.version,
        data: { title: tag("Stale rename") },
      }),
    VersionConflictError,
  );
  check(
    "API02: a stale update is refused rather than applied",
    staleUpdate !== null,
    staleUpdate ? "" : "the stale write went through",
  );
  check(
    "API02: the comparison lists the field that would have been clobbered",
    !!staleUpdate?.comparison.differences.some((diff) => diff.field === "title"),
    staleUpdate?.comparison.differences.map((x) => x.field).join(",") ?? "",
  );
  check(
    "API02: merge is NOT offered when the two edits collide",
    staleUpdate?.comparison.resolutions.includes("merge") === false,
    staleUpdate?.comparison.resolutions.join(",") ?? "",
  );

  const jobBeforeControl = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
  const newVersion = await updateWithVersion({
    delegate: prisma.job as never,
    subjectType: "Job",
    subjectId: job.id,
    scope: { practiceId: practice.id },
    expectedVersion: jobBeforeControl.version,
    data: { title: tag("Current rename") },
  });
  check(
    "CONTROL — an update naming the current version applies and bumps it",
    newVersion === jobBeforeControl.version + 1,
    `got ${newVersion}`,
  );

  const outOfScope = await throws(
    () =>
      updateWithVersion({
        delegate: prisma.job as never,
        subjectType: "Job",
        subjectId: job.id,
        // Right record, wrong practice: the scope is part of the WHERE, so
        // this must fail as NOT FOUND and never as a conflict.
        scope: { practiceId: otherPractice.id },
        expectedVersion: newVersion,
        data: { title: tag("Cross practice rename") },
      }),
    SubjectNotFoundError,
  );
  check(
    "API01: a versioned update outside the caller's practice is 404",
    outOfScope !== null,
    outOfScope ? "" : "no SubjectNotFoundError",
  );

  // =========================================================== EVIDENCE 2
  console.log("\nAPI02 EVIDENCE — two invoice issue clicks create one invoice");

  const series = await createInvoiceSeries({
    userId: preparer.id,
    practiceId: practice.id,
    code: "T15",
    fiscalPeriod: "2025-26",
    numberFormat: "{code}/{fiscalPeriod}/{number}",
    startAt: 1,
  });

  const draft = await draftInvoice({
    userId: preparer.id,
    practiceId: practice.id,
    seriesId: series.id,
    clientRelationshipId: relationship.id,
    engagementId: engagement.id,
    lines: [{ description: "Fictional professional fees", quantity: 1, unitAmount: 10000 }],
  });

  const approved = await approveInvoice({
    userId: reviewerA.id,
    approverName: "Fictional ReviewerA",
    practiceId: practice.id,
    invoiceId: draft.id,
    expectedVersion: draft.version,
  });

  const seriesBefore = await prisma.invoiceSeries.findUniqueOrThrow({
    where: { id: series.id },
    select: { nextNumber: true },
  });

  // Two clicks on one screen: same invoice, same version, both in flight.
  const clicks = await Promise.allSettled([
    issueInvoice({
      userId: reviewerA.id,
      practiceId: practice.id,
      invoiceId: draft.id,
      expectedVersion: approved.version,
    }),
    issueInvoice({
      userId: reviewerA.id,
      practiceId: practice.id,
      invoiceId: draft.id,
      expectedVersion: approved.version,
    }),
  ]);

  const succeeded = clicks.filter((c) => c.status === "fulfilled");
  check(
    "EVIDENCE: exactly one of two simultaneous issue clicks succeeds",
    succeeded.length === 1,
    `${succeeded.length} succeeded`,
  );

  const issued = await prisma.invoice.findUniqueOrThrow({ where: { id: draft.id } });
  check(
    "EVIDENCE: the invoice carries exactly one number",
    issued.status === "ISSUED" && !!issued.displayNumber,
    `${issued.status} / ${issued.displayNumber}`,
  );

  const seriesAfter = await prisma.invoiceSeries.findUniqueOrThrow({
    where: { id: series.id },
    select: { nextNumber: true },
  });
  check(
    "EVIDENCE: the losing click burns no invoice number",
    seriesAfter.nextNumber === seriesBefore.nextNumber + 1,
    `${seriesBefore.nextNumber} → ${seriesAfter.nextNumber}`,
  );

  const issueEvents = await prisma.outboxEvent.findMany({
    where: { subjectType: "Invoice", subjectId: draft.id, eventType: "INVOICE_ISSUED" },
  });
  check(
    "API03: issuing commits exactly one INVOICE_ISSUED outbox event",
    issueEvents.length === 1,
    `${issueEvents.length} events`,
  );
  check(
    "API03: the event names the version it describes",
    issueEvents[0]?.subjectVersion === issued.version,
    `event ${issueEvents[0]?.subjectVersion} vs invoice ${issued.version}`,
  );

  // CONTROL — a retried click on an ALREADY issued invoice returns the same
  // issued record rather than a second number (API §34's own words:
  // "retry returns the same issued record").
  const retry = await issueInvoice({
    userId: reviewerA.id,
    practiceId: practice.id,
    invoiceId: draft.id,
    expectedVersion: issued.version,
  });
  check(
    "CONTROL — a retry after issue returns the same number, not a new one",
    retry.displayNumber === issued.displayNumber,
    `${retry.displayNumber} vs ${issued.displayNumber}`,
  );

  // ------------------------------------------------------------- API03
  console.log("\nAPI03 — the outbox");

  const outboxJob = await makeJob("Fictional outbox subject");

  // The event and the business change commit together, or not at all.
  let rolledBackEventId: string | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      const e = await emitEvent(tx, {
        eventType: "JOB_STATE_CHANGED",
        subjectType: "Job",
        subjectId: outboxJob.id,
        subjectVersion: 0,
        practiceId: practice.id,
        actionKey: `rollback:${RUN}`,
        payload: { note: "this transaction is about to fail" },
      });
      rolledBackEventId = e.id;
      throw new Error("deliberate rollback");
    });
  } catch {
    // expected
  }
  const rolledBack = rolledBackEventId
    ? await prisma.outboxEvent.findUnique({ where: { id: rolledBackEventId } })
    : null;
  check(
    "API03: an event emitted in a transaction that rolls back does not exist",
    rolledBack === null,
    rolledBack ? "the event survived the rollback" : "",
  );

  // The same intent, twice.
  const firstEmit = await prisma.$transaction((tx) =>
    emitEvent(tx, {
      eventType: "JOB_STATE_CHANGED",
      subjectType: "Job",
      subjectId: outboxJob.id,
      subjectVersion: 0,
      practiceId: practice.id,
      actionKey: `dedupe:${RUN}`,
      payload: { click: 1 },
    }),
  );
  const secondEmit = await prisma.$transaction((tx) =>
    emitEvent(tx, {
      eventType: "JOB_STATE_CHANGED",
      subjectType: "Job",
      subjectId: outboxJob.id,
      subjectVersion: 0,
      practiceId: practice.id,
      actionKey: `dedupe:${RUN}`,
      payload: { click: 2 },
    }),
  );
  check(
    "API03: the same action key emits one event, and the second caller sees the first",
    secondEmit.duplicate && secondEmit.id === firstEmit.id,
  );

  // Consumers run at most once, ever — even when the event is redelivered.
  // Scoped to THIS event: job transitions elsewhere in the fixture emit
  // JOB_STATE_CHANGED too, and counting those would measure the fixture rather
  // than the property under test — that one event runs its consumer once, ever.
  let sideEffectRuns = 0;
  const counting: OutboxConsumer = {
    name: `t15-counting-${RUN}`,
    handles: (t) => t === "JOB_STATE_CHANGED",
    handle: async (event) => {
      if (event.id !== firstEmit.id) return;
      sideEffectRuns += 1;
    },
  };

  const firstPass = await dispatchOutbox({ consumers: [counting], limit: 200 });
  check(
    "API03: a due event is dispatched",
    firstPass.dispatched >= 1 && sideEffectRuns === 1,
    `dispatched ${firstPass.dispatched}, runs ${sideEffectRuns}`,
  );

  // Force a redelivery of the same event, as a crashed dispatcher would.
  await prisma.outboxEvent.update({
    where: { id: firstEmit.id },
    data: { state: "PENDING", claimedAt: null },
  });
  await dispatchOutbox({ consumers: [counting], limit: 200 });
  check(
    "API03: a redelivered event does not run the consumer a second time",
    sideEffectRuns === 1,
    `runs ${sideEffectRuns}`,
  );

  const dispatched = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: firstEmit.id } });
  check(
    "API03: scheduled time and executed time are both preserved, separately",
    !!dispatched.executedAt && dispatched.scheduledFor <= dispatched.executedAt,
    `scheduled ${dispatched.scheduledFor?.toISOString()} executed ${dispatched.executedAt?.toISOString()}`,
  );

  // A failing side effect must not touch the business record.
  const failingJob = await makeJob("Fictional failing side effect");
  const approvedFailing = await recordApproval({
    practiceId: practice.id,
    subjectType: "FILING",
    subjectId: failingJob.id,
    expectedVersion: 0,
    decision: "APPROVED",
    approverUserId: reviewerB.id,
    approverDisplayName: "Fictional ReviewerB",
    authority: "REVIEWER",
  });

  const exploding: OutboxConsumer = {
    name: `t15-exploding-${RUN}`,
    handles: (t) => t === "APPROVAL_RECORDED",
    handle: async (event) => {
      if (event.subjectId !== failingJob.id) return;
      throw new Error("fictional mail server is down");
    },
  };

  await dispatchOutbox({ consumers: [exploding], limit: 200 });

  const stillApproved = await prisma.approval.findFirst({
    where: { id: approvedFailing.approvalId },
  });
  check(
    "EVIDENCE (API03): a failed side effect leaves the approval standing",
    stillApproved !== null && stillApproved.decision === "APPROVED",
    stillApproved ? "" : "the approval disappeared",
  );

  const failedEvent = await prisma.outboxEvent.findUniqueOrThrow({
    where: { id: approvedFailing.outboxEventId },
  });
  check(
    "API03: the failed event is retained, marked FAILED, with the reason and a retry time",
    failedEvent.state === "FAILED" &&
      failedEvent.attempts === 1 &&
      !!failedEvent.lastError &&
      failedEvent.scheduledFor > dispatched.scheduledFor,
    `${failedEvent.state} attempts=${failedEvent.attempts}`,
  );

  // Exhausting the retries ends at a visible dead letter, never a silent drop.
  await prisma.outboxEvent.update({
    where: { id: failedEvent.id },
    data: { attempts: 4, maxAttempts: 5, scheduledFor: new Date(Date.now() - 1000) },
  });
  await dispatchOutbox({ consumers: [exploding], limit: 200 });
  const deadEvent = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: failedEvent.id } });
  check(
    "API03: an undeliverable event ends DEAD and visible, not deleted",
    deadEvent.state === "DEAD",
    deadEvent.state,
  );
  const dead = await deadLetters(practice.id);
  check(
    "API03: dead letters are listable without a database console",
    dead.some((x) => x.id === failedEvent.id),
  );

  // =========================================================== EVIDENCE 3
  console.log("\nAPI03 EVIDENCE — a delayed queue message after revocation cannot export");

  // The export is requested while the user is still authorised, and the event
  // sits in the outbox — as a real one would while the queue drains.
  const exportJob = await prisma.queuedJob.create({
    data: {
      practiceId: practice.id,
      requestedByUserId: leaver.id,
      kind: "EXPORT",
      payload: { report: "fictional client files" },
      state: "QUEUED",
    },
  });

  const exportedFiles: string[] = [];
  const exporter: OutboxConsumer = {
    name: `t15-exporter-${RUN}`,
    handles: (t) => t === "DOCUMENT_RELEASED",
    handle: async (event) => {
      const payload = event.payload as { queuedJobId: string; file: string };
      // IAM01/IAM05: the consumer re-checks authority at EXECUTION time. The
      // check made when the message was queued is worthless by now.
      await assertStillAuthorised(payload.queuedJobId);
      exportedFiles.push(payload.file);
    },
  };

  const exportEvent = await prisma.$transaction((tx) =>
    emitEvent(tx, {
      eventType: "DOCUMENT_RELEASED",
      subjectType: "QueuedJob",
      subjectId: exportJob.id,
      practiceId: practice.id,
      actionKey: `export:${RUN}`,
      payload: { queuedJobId: exportJob.id, file: "fictional-workpapers.zip" },
    }),
  );

  // The role is revoked while the message is still in the queue.
  await suspendUser({
    userId: leaver.id,
    reason: "Fictional departure",
    actorUserId: partner.id,
    actorName: "Fictional Partner",
  });

  await dispatchOutbox({ consumers: [exporter], limit: 200 });

  check(
    "EVIDENCE: the delayed message exports nothing after revocation",
    exportedFiles.length === 0,
    exportedFiles.join(","),
  );

  const exportAfter = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: exportEvent.id } });
  check(
    "EVIDENCE: the refused export is recorded, not silently dropped",
    exportAfter.state !== "DISPATCHED" && !!exportAfter.lastError,
    `${exportAfter.state}`,
  );

  const exportJobAfter = await prisma.queuedJob.findUniqueOrThrow({ where: { id: exportJob.id } });
  check(
    "EVIDENCE: the queued export itself is cancelled",
    exportJobAfter.state === "CANCELLED",
    exportJobAfter.state,
  );

  // CONTROL — the identical message for a still-authorised requester exports.
  const okJob = await prisma.queuedJob.create({
    data: {
      practiceId: practice.id,
      requestedByUserId: partner.id,
      kind: "EXPORT",
      payload: { report: "fictional client files" },
      state: "QUEUED",
    },
  });
  await prisma.$transaction((tx) =>
    emitEvent(tx, {
      eventType: "DOCUMENT_RELEASED",
      subjectType: "QueuedJob",
      subjectId: okJob.id,
      practiceId: practice.id,
      actionKey: `export-ok:${RUN}`,
      payload: { queuedJobId: okJob.id, file: "fictional-permitted.zip" },
    }),
  );
  await dispatchOutbox({ consumers: [exporter], limit: 200 });
  check(
    "CONTROL — the same message for a still-authorised requester does export",
    exportedFiles.includes("fictional-permitted.zip"),
    exportedFiles.join(","),
  );

  // ------------------------------------------------------------- API01
  console.log("\nAPI01 — common controls");

  const conflictResponse = errorResponse(
    (outcomeA.status === "rejected" ? outcomeA.reason : new Error("x")) as unknown,
  );
  const conflictBody = (await conflictResponse.json()) as Record<string, unknown>;
  check(
    "API01: a refusal carries a stable code and a correlation ID",
    conflictResponse.status === 409 &&
      conflictBody.code === "VERSION_CONFLICT" &&
      typeof conflictBody.correlationId === "string",
    `${conflictResponse.status} ${String(conflictBody.code)}`,
  );
  check(
    "API01: the correlation ID is also on the response header",
    conflictResponse.headers.get(CORRELATION_HEADER) === conflictBody.correlationId,
  );
  check(
    "API02: the 409 body carries the comparison a screen needs to offer reload",
    !!(conflictBody.conflict as { currentVersion?: number })?.currentVersion,
  );

  const notFoundResponse = errorResponse(new SubjectNotFoundError());
  const notFoundBody = (await notFoundResponse.json()) as Record<string, unknown>;
  check(
    "API01: an inaccessible record is a bare 404 that describes nothing",
    notFoundResponse.status === 404 &&
      notFoundBody.error === "Not found" &&
      notFoundBody.code === "NOT_FOUND",
    `${notFoundResponse.status} ${String(notFoundBody.error)}`,
  );

  const badResponse = badRequest("expectedVersion is required");
  const badBody = (await badResponse.json()) as Record<string, unknown>;
  check(
    "API01: input validation refusals use the same envelope",
    badResponse.status === 400 &&
      badBody.code === "BAD_REQUEST" &&
      typeof badBody.correlationId === "string",
  );

  const supplied = "t15-correlation-0001";
  const honoured = correlationIdFrom(
    new Request("https://example.invalid/", { headers: { [CORRELATION_HEADER]: supplied } }),
  );
  check("API01: a well-formed inbound correlation ID is honoured", honoured === supplied);

  const hostile = correlationIdFrom(
    new Request("https://example.invalid/", {
      headers: { [CORRELATION_HEADER]: "<script>alert(1)</script>" },
    }),
  );
  check(
    "API01: a hostile inbound correlation ID is replaced, not echoed",
    hostile !== "<script>alert(1)</script>" && hostile.length > 0,
    hostile,
  );

  // The ID has to reach the audit trail, or it answers no support question.
  const correlated = `t15-trace-${RUN}`;
  await withCorrelationId(correlated, async () => {
    check("API01: the correlation ID is visible to everything in the request", currentCorrelationId() === correlated);
    await recordEvent({
      action: "EXPORT_RUN",
      targetType: "Job",
      targetId: job.id,
      result: "SUCCESS",
      actorUserId: partner.id,
      practiceId: practice.id,
    });
  });
  const correlatedEvent = await prisma.event.findFirst({
    where: { correlationId: correlated },
  });
  check(
    "API01: an audit event written during the request inherits its correlation ID",
    correlatedEvent !== null,
    correlatedEvent ? "" : "no event carried the ID",
  );

  const approvalEvent = await prisma.outboxEvent.findFirst({
    where: { subjectId: failingJob.id, eventType: "APPROVAL_RECORDED" },
    select: { correlationId: true },
  });
  check(
    "API01: an outbox event emitted outside a request has no invented ID",
    approvalEvent !== null && approvalEvent.correlationId === null,
    String(approvalEvent?.correlationId),
  );

  // ------------------------------------------- API01 route contract
  //
  // "All endpoints authenticate, authorise and validate input server side …
  //  Use consistent error codes with safe human messages and a correlation ID."
  //
  // Asserted over EVERY route file rather than the handful this test drives.
  // The failure this catches is a new endpoint added months from now that
  // quietly skips the gate — no behavioural test would notice, because nobody
  // writes a test for the route they forgot to protect.
  console.log("\nAPI01 — the route contract, across every endpoint");

  const apiRoot = path.join(process.cwd(), "src", "app", "api");
  const routeFiles = listRouteFiles(apiRoot);
  check(
    "API01: the route scan found the endpoints",
    routeFiles.length >= 40,
    `${routeFiles.length} routes`,
  );

  // Endpoints that are unauthenticated BY DESIGN, each with the reason. A new
  // route cannot join this list by accident — it has to be typed here.
  const PUBLIC_BY_DESIGN: Record<string, string> = {
    "health/route.ts": "liveness probe; returns no record data",
    "auth/login/route.ts": "the login endpoint itself",
    "auth/mfa/verify/route.ts": "second factor, before a session exists",
    "auth/logout/route.ts": "ending a session must work even with a dead one",
    "portal/logout/route.ts": "same, for a portal contact",
    "portal/invitations/accept/route.ts": "redeems a single-use invitation token",
    "portal/invitations/renew/route.ts": "requests a fresh link for a dead one",
    // Mid-login, before any session exists. Gated by the signed single-use
    // login challenge instead, which is also why CSRF does not apply: there is
    // no ambient cookie for another origin to ride on.
    "auth/mfa/enrol/begin/route.ts": "first-time MFA enrolment during login",
    "auth/mfa/enrol/confirm/route.ts": "first-time MFA enrolment during login",
    // DOC04 link redemption. The token in the URL IS the credential, and
    // `redeemAccessToken` re-authorises it against live state on every read.
    "documents/link/route.ts": "signed document link, re-checked on redemption",
  };

  const AUTH_GATES = ["requireUserId", "requireActor", "requirePortalContact"];
  const MUTATING = /export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)\b/;
  const ADHOC_ERROR = /NextResponse\.json\(\s*\{[^{}]*error:/;

  const unauthenticated: string[] = [];
  const unprotected: string[] = [];
  const adhocErrors: string[] = [];

  for (const file of routeFiles) {
    const rel = path.relative(apiRoot, file).split(path.sep).join("/");
    const src = fs.readFileSync(file, "utf8");

    const authenticates = AUTH_GATES.some((gate) => src.includes(gate));
    if (!authenticates && !(rel in PUBLIC_BY_DESIGN)) unauthenticated.push(rel);

    if (MUTATING.test(src) && !src.includes("assertCsrf") && !(rel in PUBLIC_BY_DESIGN)) {
      unprotected.push(rel);
    }

    // A refusal built by hand is a refusal with no code and no correlation ID.
    if (ADHOC_ERROR.test(src)) adhocErrors.push(rel);
  }

  check(
    "API01: every endpoint authenticates, or is public by design with a stated reason",
    unauthenticated.length === 0,
    unauthenticated.join(", "),
  );
  check(
    "SEC03: every mutating endpoint carries the CSRF check",
    unprotected.length === 0,
    unprotected.join(", "),
  );
  check(
    "API01: no endpoint hand-rolls an error body outside the shared envelope",
    adhocErrors.length === 0,
    adhocErrors.join(", "),
  );

  // The proxy is what puts a correlation ID on responses from routes this test
  // never touches — without it the contract holds only where it was wired.
  const proxySource = fs.readFileSync(path.join(process.cwd(), "src", "proxy.ts"), "utf8");
  check(
    "API01: the proxy stamps a correlation ID on every request and response",
    proxySource.includes("x-correlation-id") &&
      proxySource.includes("requestHeaders") &&
      proxySource.includes("response.headers.set"),
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

/** Every `route.ts` under src/app/api, so the contract cannot be scoped away. */
function listRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listRouteFiles(full));
    else if (entry.name === "route.ts") out.push(full);
  }
  return out;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
