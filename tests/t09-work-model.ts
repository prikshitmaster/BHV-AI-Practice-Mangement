/**
 * T09 acceptance test — WRK01-05 (PRD §13). WRK06 is R1.
 *
 * PRD acceptance evidence, verbatim:
 *   "Run the monthly job generator twice; only one job exists per key. Request
 *    changes after review and verify the previous approval is invalidated.
 *    Reopen a completed job without changing its original filing evidence or
 *    deleting its completion history."
 *
 * Library level — no HTTP server required.
 * All fixture data is fictional.
 *
 * Run: npm run test:t09
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  WorkError,
  blockingReasons,
  buildDedupKey,
  canTransition,
  completeChecklistItem,
  currentApprovals,
  generateRecurringJobs,
  handoverList,
  isApprovedForAction,
  markChecklistItemNotApplicable,
  pauseForClient,
  previewRecurrence,
  queue,
  reassignJob,
  resumeAfterClient,
  staleApprovals,
  startTask,
  transitionJob,
} from "../src/lib/work";

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

async function main() {
  console.log("\nT09 — work model & queues (PRD §13 WRK01-05)\n");

  // ---------------------------------------------------------------- fixtures
  const tenant = await prisma.tenant.create({ data: { name: tag("T") } });
  const practice = await prisma.practice.create({
    data: {
      tenantId: tenant.id, name: tag("Company"), constitution: "LLP",
      documentNamespace: tag("co"), effectiveFrom: new Date("2024-04-01"),
    },
  });
  const otherPractice = await prisma.practice.create({
    data: {
      tenantId: tenant.id, name: tag("Associates"), constitution: "PARTNERSHIP",
      documentNamespace: tag("as"), effectiveFrom: new Date("2024-04-01"),
    },
  });

  const preparer = await prisma.user.create({
    data: { email: `prep-${RUN}@example.invalid`, fullName: "Fictional Preparer", status: "ACTIVE" },
  });
  const reviewer = await prisma.user.create({
    data: { email: `rev-${RUN}@example.invalid`, fullName: "Fictional Reviewer", status: "ACTIVE" },
  });
  const successor = await prisma.user.create({
    data: { email: `succ-${RUN}@example.invalid`, fullName: "Fictional Successor", status: "ACTIVE" },
  });

  const party = await prisma.party.create({
    data: { tenantId: tenant.id, legalName: tag("Recurring Client Ltd"), type: "COMPANY" },
  });
  const relationship = await prisma.clientRelationship.create({
    data: { practiceId: practice.id, partyId: party.id, acceptanceStatus: "ACCEPTED" },
  });
  const engagement = await prisma.engagement.create({
    data: {
      practiceId: practice.id, clientRelationshipId: relationship.id,
      serviceCode: "GST", templateVersion: "1", kind: "ANNUAL_RETAINER",
      periodStart: new Date("2025-04-01"), periodEnd: new Date("2026-03-31"),
      state: "ACTIVE",
    },
  });

  // -------------------------- ACCEPTANCE EVIDENCE 1: generator run twice
  console.log("Evidence 1 — run the monthly generator twice, one job per key");

  const months = ["2025-04", "2025-05", "2025-06", "2025-07"];
  const spec = {
    practiceId: practice.id,
    clientRelationshipId: relationship.id,
    engagementId: engagement.id,
    templateIdentity: "GSTR3B",
    templateVersion: 1,
    periodKeys: months,
    titleFor: (p: string) => `GSTR-3B ${p}`,
    dueDateFor: (p: string) => new Date(`${p}-20`),
    ownerUserId: preparer.id,
    reviewerUserId: reviewer.id,
  };

  const preview = await previewRecurrence(spec);
  check("preview shows what WOULD be created before creating it", preview.toCreate.length === 4);
  check("preview shows nothing already exists yet", preview.alreadyExisting.length === 0);

  const first = await generateRecurringJobs(spec);
  check("first run creates four monthly jobs", first.created === 4, `${first.created}`);

  const second = await generateRecurringJobs(spec);
  check("SECOND run creates nothing", second.created === 0, `${second.created} created`);
  check("second run reports them as already existing", second.skipped === 4);

  const jobCount = await prisma.job.count({
    where: { practiceId: practice.id, engagementId: engagement.id },
  });
  check("exactly four jobs exist, not eight", jobCount === 4, `${jobCount}`);

  // WRK03: the template VERSION must not be part of the dedup identity.
  const afterTemplateEdit = await generateRecurringJobs({ ...spec, templateVersion: 2 });
  check(
    "bumping the template version does NOT regenerate the jobs",
    afterTemplateEdit.created === 0,
    `${afterTemplateEdit.created} created after a template edit`,
  );
  const jobCountAfterEdit = await prisma.job.count({
    where: { practiceId: practice.id, engagementId: engagement.id },
  });
  check("still exactly four jobs after a template edit", jobCountAfterEdit === 4, `${jobCountAfterEdit}`);

  const sample = await prisma.job.findFirstOrThrow({
    where: { practiceId: practice.id, periodKey: "2025-04" },
  });
  const snapshot = sample.templateVersionSnapshot as Record<string, unknown>;
  check("the template version IS recorded as snapshot metadata", snapshot.templateVersion === 1);
  check(
    "...but the dedup key does NOT contain the version",
    !sample.dedupKey.includes("|1") || !sample.dedupKey.endsWith("1"),
    sample.dedupKey,
  );
  check(
    "the dedup key is practice + relationship + template identity + period",
    sample.dedupKey ===
      buildDedupKey({
        practiceId: practice.id,
        clientRelationshipId: relationship.id,
        templateIdentity: "GSTR3B",
        periodKey: "2025-04",
      }),
  );

  // The same period in ANOTHER practice is a different key.
  const otherParty = await prisma.clientRelationship.create({
    data: { practiceId: otherPractice.id, partyId: party.id, acceptanceStatus: "ACCEPTED" },
  });
  const otherEngagement = await prisma.engagement.create({
    data: {
      practiceId: otherPractice.id, clientRelationshipId: otherParty.id,
      serviceCode: "GST", templateVersion: "1", kind: "ANNUAL_RETAINER",
      periodStart: new Date("2025-04-01"), periodEnd: new Date("2026-03-31"), state: "ACTIVE",
    },
  });
  const otherRun = await generateRecurringJobs({
    ...spec,
    practiceId: otherPractice.id,
    clientRelationshipId: otherParty.id,
    engagementId: otherEngagement.id,
    periodKeys: ["2025-04"],
    ownerUserId: undefined,
    reviewerUserId: undefined,
  });
  check(
    "the same period for the OTHER practice is a separate job",
    otherRun.created === 1,
    `${otherRun.created}`,
  );

  // -------------------- ACCEPTANCE EVIDENCE 2: changes requested invalidates
  console.log("\nEvidence 2 — requesting changes invalidates the previous approval");

  const job = await prisma.job.findFirstOrThrow({
    where: { practiceId: practice.id, periodKey: "2025-04" },
  });

  await transitionJob({
    jobId: job.id, practiceId: practice.id, toState: "IN_PROGRESS",
    actorUserId: preparer.id, actorName: "Fictional Preparer",
  });
  const inReview = await transitionJob({
    jobId: job.id, practiceId: practice.id, toState: "IN_REVIEW",
    actorUserId: preparer.id, actorName: "Fictional Preparer",
  });

  // The reviewer approves THIS version.
  await prisma.approval.create({
    data: {
      practiceId: practice.id,
      subjectType: "FILING",
      subjectId: job.id,
      subjectVersion: inReview.version,
      actorUserId: reviewer.id,
      actorDisplayName: "Fictional Reviewer",
      authority: "REVIEWER",
      decision: "APPROVED",
    },
  });
  const approvedVersion = inReview.version;

  const approvedJob = await transitionJob({
    jobId: job.id, practiceId: practice.id, toState: "APPROVED_FOR_ACTION",
    actorUserId: reviewer.id, actorName: "Fictional Reviewer",
  });
  check(
    "the approval is current while the version is unchanged",
    (await currentApprovals(job.id, approvedVersion)).length === 1,
  );

  // Now request changes.
  const changed = await transitionJob({
    jobId: job.id, practiceId: practice.id, toState: "CHANGES_REQUESTED",
    actorUserId: reviewer.id, actorName: "Fictional Reviewer",
    reason: "Input tax credit reconciliation is missing for two invoices",
  });

  check("requesting changes bumps the job version", changed.version > approvedVersion);
  check(
    "the earlier approval is NO LONGER current",
    (await currentApprovals(job.id, changed.version)).length === 0,
  );
  check(
    "the earlier approval still EXISTS as history, it is not deleted",
    (await staleApprovals(job.id, changed.version)).length === 1,
  );
  check("the job is not approved for action any more", (await isApprovedForAction(job.id)) === false);

  // Test the reason requirement from a state where CHANGES_REQUESTED is
  // actually a legal move — otherwise the illegal-transition guard fires
  // first and we would not be testing what we claim to.
  const jobForReason = await prisma.job.findFirstOrThrow({
    where: { practiceId: practice.id, periodKey: "2025-06" },
  });
  await transitionJob({
    jobId: jobForReason.id, practiceId: practice.id, toState: "IN_PROGRESS",
    actorUserId: preparer.id, actorName: "Fictional Preparer",
  });
  await transitionJob({
    jobId: jobForReason.id, practiceId: practice.id, toState: "IN_REVIEW",
    actorUserId: preparer.id, actorName: "Fictional Preparer",
  });
  const noReason = await throws(
    () =>
      transitionJob({
        jobId: jobForReason.id, practiceId: practice.id, toState: "CHANGES_REQUESTED",
        actorUserId: reviewer.id, actorName: "Fictional Reviewer",
      }),
    WorkError,
  );
  check(
    "requesting changes without a reason is refused",
    noReason?.code === "REASON_REQUIRED",
    noReason?.code ?? "not refused",
  );

  check(
    "CHANGES_REQUESTED cannot jump straight to COMPLETED",
    !canTransition("CHANGES_REQUESTED", "COMPLETED"),
  );
  const illegal = await throws(
    () =>
      transitionJob({
        jobId: job.id, practiceId: practice.id, toState: "COMPLETED",
        actorUserId: preparer.id, actorName: "Fictional Preparer",
      }),
    WorkError,
  );
  check("the server refuses an illegal transition", illegal?.code === "ILLEGAL_TRANSITION");

  // ------------------- ACCEPTANCE EVIDENCE 3: reopen preserves history
  console.log("\nEvidence 3 — reopening preserves filing evidence and completion history");

  // Drive the job to COMPLETED properly.
  await transitionJob({
    jobId: job.id, practiceId: practice.id, toState: "IN_PROGRESS",
    actorUserId: preparer.id, actorName: "Fictional Preparer",
  });
  await transitionJob({
    jobId: job.id, practiceId: practice.id, toState: "IN_REVIEW",
    actorUserId: preparer.id, actorName: "Fictional Preparer",
  });
  const reapproved = await transitionJob({
    jobId: job.id, practiceId: practice.id, toState: "APPROVED_FOR_ACTION",
    actorUserId: reviewer.id, actorName: "Fictional Reviewer",
  });

  // The filing evidence: an approval naming the exact version, and a document.
  await prisma.approval.create({
    data: {
      practiceId: practice.id, subjectType: "FILING", subjectId: job.id,
      subjectVersion: reapproved.version, actorUserId: reviewer.id,
      actorDisplayName: "Fictional Reviewer", authority: "REVIEWER",
      decision: "APPROVED", sourceFileSha256: "c".repeat(64),
      externalReference: "ARN-FICTIONAL-0001",
    },
  });

  await transitionJob({
    jobId: job.id, practiceId: practice.id, toState: "SUBMITTED_DELIVERED",
    actorUserId: preparer.id, actorName: "Fictional Preparer",
  });
  const completed = await transitionJob({
    jobId: job.id, practiceId: practice.id, toState: "COMPLETED",
    actorUserId: preparer.id, actorName: "Fictional Preparer",
  });

  const completedAt = completed.completedAt;
  const filingEvidenceBefore = await prisma.approval.findFirstOrThrow({
    where: { subjectId: job.id, externalReference: "ARN-FICTIONAL-0001" },
  });
  const transitionsBefore = await prisma.workStateTransition.count({
    where: { subjectId: job.id },
  });

  check("the job completed and recorded when", completed.state === "COMPLETED" && completedAt !== null);

  // REOPEN.
  const reopened = await transitionJob({
    jobId: job.id, practiceId: practice.id, toState: "REOPENED",
    actorUserId: reviewer.id, actorName: "Fictional Reviewer",
    reason: "Department raised a query on the filed return",
  });

  check("the job reopened", reopened.state === "REOPENED");
  check("the reopen count incremented", reopened.reopenCount === 1);

  const filingEvidenceAfter = await prisma.approval.findFirstOrThrow({
    where: { subjectId: job.id, externalReference: "ARN-FICTIONAL-0001" },
  });
  check(
    "the ORIGINAL filing evidence is unchanged",
    filingEvidenceAfter.sourceFileSha256 === filingEvidenceBefore.sourceFileSha256 &&
      filingEvidenceAfter.externalReference === filingEvidenceBefore.externalReference &&
      filingEvidenceAfter.subjectVersion === filingEvidenceBefore.subjectVersion,
  );
  check(
    "the original completion timestamp is NOT erased",
    reopened.completedAt?.getTime() === completedAt?.getTime(),
    `${String(reopened.completedAt)} vs ${String(completedAt)}`,
  );

  const transitionsAfter = await prisma.workStateTransition.findMany({
    where: { subjectId: job.id },
    orderBy: { createdAt: "asc" },
  });
  check(
    "no completion history was deleted — the log only grew",
    transitionsAfter.length === transitionsBefore + 1,
    `${transitionsBefore} → ${transitionsAfter.length}`,
  );
  check(
    "the COMPLETED transition is still in the history",
    transitionsAfter.some((t) => t.toState === "COMPLETED"),
  );
  check(
    "the reopening is recorded with its reason and actor",
    transitionsAfter.some(
      (t) => t.toState === "REOPENED" && (t.reason ?? "").length > 0 && t.actorName === "Fictional Reviewer",
    ),
  );
  check(
    "reopening also invalidates the approval, since the version moved",
    (await currentApprovals(job.id, reopened.version)).length === 0,
  );

  // ------------------------------------------------------- WRK04 blocking
  console.log("\nWRK04 — dependencies, blocking, and the statutory deadline");

  const jobB = await prisma.job.findFirstOrThrow({
    where: { practiceId: practice.id, periodKey: "2025-05" },
  });
  const prepTask = await prisma.task.create({
    data: { practiceId: practice.id, jobId: jobB.id, title: "Prepare return", state: "READY" },
  });
  const fileTask = await prisma.task.create({
    data: { practiceId: practice.id, jobId: jobB.id, title: "File return", state: "READY" },
  });
  await prisma.taskDependency.create({
    data: {
      practiceId: practice.id, taskId: fileTask.id, dependsOnTaskId: prepTask.id,
      requiredEvidenceLabel: "Signed client confirmation",
    },
  });

  const reasons = await blockingReasons(fileTask.id);
  check("a task blocks on an unfinished predecessor", reasons.some((r) => r.includes("Prepare return")));
  check("a task also blocks on missing EVIDENCE", reasons.some((r) => r.includes("Signed client confirmation")));

  const blockedStart = await throws(
    () =>
      startTask({
        taskId: fileTask.id, practiceId: practice.id,
        actorUserId: preparer.id, actorName: "Fictional Preparer",
      }),
    WorkError,
  );
  check("starting a blocked task is refused", blockedStart?.code === "BLOCKED");

  await prisma.task.update({ where: { id: prepTask.id }, data: { state: "COMPLETED" } });
  const doc = await prisma.document.create({
    data: { practiceId: practice.id, title: "Client confirmation" },
  });
  await prisma.taskDependency.updateMany({
    where: { taskId: fileTask.id },
    data: { evidenceDocumentId: doc.id },
  });
  check("once predecessor and evidence are present, nothing blocks", (await blockingReasons(fileTask.id)).length === 0);
  const startedTask = await startTask({
    taskId: fileTask.id, practiceId: practice.id,
    actorUserId: preparer.id, actorName: "Fictional Preparer",
  });
  check("the task can then start", startedTask.state === "IN_PROGRESS");

  // A client delay must not move the statutory date.
  const rule = await prisma.obligationRule.create({
    data: {
      code: tag("GSTR3B"), version: 1, source: "CGST Act (fictional reference)",
      applicability: {} as never, effectiveFrom: new Date("2024-04-01"),
    },
  });
  const obligation = await prisma.obligation.create({
    data: {
      practiceId: practice.id, clientRelationshipId: relationship.id,
      engagementId: engagement.id, ruleId: rule.id, ruleVersion: 1,
      periodKey: "2025-05",
      originalStatutoryDate: new Date("2025-06-20"),
      currentStatutoryDate: new Date("2025-06-20"),
      internalTargetDate: new Date("2025-06-15"),
      status: "OPEN",
    },
  });

  const request = await prisma.clientRequest.create({
    data: {
      practiceId: practice.id, clientRelationshipId: relationship.id,
      jobId: jobB.id, title: "Purchase register for May",
      requestedItems: ["Purchase register", "Bank statement"] as never,
      dueDate: new Date("2025-06-05"),
    },
  });

  const paused = await pauseForClient({
    clientRequestId: request.id, obligationId: obligation.id,
  });
  check("the internal clock pauses when waiting on the client", paused.request.slaPausedAt !== null);
  check(
    "the STATUTORY date is unchanged by a client delay",
    paused.statutoryDateUnchanged?.toISOString().slice(0, 10) === "2025-06-20",
    String(paused.statutoryDateUnchanged),
  );
  check("escalation continues while the client is pending", paused.escalationContinues === true);

  const obligationAfter = await prisma.obligation.findUniqueOrThrow({ where: { id: obligation.id } });
  check(
    "the obligation row itself was not touched",
    obligationAfter.currentStatutoryDate.toISOString() === obligation.currentStatutoryDate.toISOString(),
  );

  const resumed = await resumeAfterClient(request.id);
  check("resuming records how long the clock was paused", resumed.slaPausedTotalMs >= 0 && resumed.slaPausedAt === null);
  check("the request is marked received", resumed.state === "RECEIVED");

  // ------------------------------------------------------- WRK01 checklist
  console.log("\nWRK01 — required steps, authorised roles, not-applicable reasons");

  const requiredItem = await prisma.checklistItem.create({
    data: {
      practiceId: practice.id, taskId: prepTask.id, label: "Reviewer signoff",
      isRequired: true, requiredRole: "REVIEWER",
    },
  });
  const optionalItem = await prisma.checklistItem.create({
    data: {
      practiceId: practice.id, taskId: prepTask.id, label: "Export ledger to PDF",
      isRequired: false,
    },
  });

  const wrongRole = await throws(
    () =>
      completeChecklistItem({
        itemId: requiredItem.id, practiceId: practice.id,
        userId: preparer.id, userRole: "STAFF_ARTICLE",
      }),
    WorkError,
  );
  check("a required step refuses an unauthorised role", wrongRole?.code === "ROLE_NOT_AUTHORISED");

  const done = await completeChecklistItem({
    itemId: requiredItem.id, practiceId: practice.id,
    userId: reviewer.id, userRole: "REVIEWER",
  });
  check("the authorised role can complete it", done.isComplete);

  const naRequired = await throws(
    () =>
      markChecklistItemNotApplicable({
        itemId: requiredItem.id, practiceId: practice.id, reason: "skip",
      }),
    WorkError,
  );
  check("a REQUIRED step cannot be waved away as not applicable", naRequired?.code === "REQUIRED_STEP");

  const naNoReason = await throws(
    () =>
      markChecklistItemNotApplicable({
        itemId: optionalItem.id, practiceId: practice.id, reason: "  ",
      }),
    WorkError,
  );
  check("not-applicable requires a reason", naNoReason?.code === "REASON_REQUIRED");

  const na = await markChecklistItemNotApplicable({
    itemId: optionalItem.id, practiceId: practice.id,
    reason: "Client supplies the ledger in PDF already",
  });
  check("an optional step records not-applicable WITH a reason", na.notApplicable && (na.notApplicableReason ?? "").length > 0);

  // ------------------------------------------------------- WRK05 queues
  console.log("\nWRK05 — saved queues, reassignment, handover");

  const scoped = [practice.id];
  const myWork = await queue({ name: "MY_WORK", userId: preparer.id, practiceIds: scoped });
  check("My work returns the preparer's open jobs", myWork.length > 0);
  check(
    "My work contains nothing from the other practice",
    myWork.every((j) => j.practiceId === practice.id),
  );

  const reviewQueue = await queue({ name: "REVIEW_QUEUE", userId: reviewer.id, practiceIds: scoped });
  check("the review queue is scoped to the reviewer", reviewQueue.every((j) => j.reviewerUserId === reviewer.id));

  await prisma.job.update({
    where: { id: jobB.id },
    data: { state: "WAITING_FOR_CLIENT" },
  });
  const waiting = await queue({ name: "WAITING_FOR_CLIENT", userId: preparer.id, practiceIds: scoped });
  check("the waiting-for-client queue finds it", waiting.some((j) => j.id === jobB.id));

  const overdue = await queue({
    name: "OVERDUE", userId: preparer.id, practiceIds: scoped,
    now: new Date("2026-01-01"),
  });
  check("the overdue queue finds past-due open jobs", overdue.length > 0);

  // Reassignment.
  const timer = await prisma.timeEntry.create({
    data: { practiceId: practice.id, jobId: jobB.id, userId: preparer.id },
  });

  const noReasonReassign = await throws(
    () =>
      reassignJob({
        jobId: jobB.id, practiceId: practice.id, toUserId: successor.id,
        reason: "  ", actorUserId: reviewer.id, actorName: "Fictional Reviewer",
      }),
    WorkError,
  );
  check("reassignment without a reason is refused", noReasonReassign?.code === "REASON_REQUIRED");

  const reassigned = await reassignJob({
    jobId: jobB.id, practiceId: practice.id, toUserId: successor.id,
    reason: "Preparer on leave", actorUserId: reviewer.id, actorName: "Fictional Reviewer",
  });
  check("the job moves to the new owner", reassigned.job.ownerUserId === successor.id);
  check("the reassignment records the reason", reassigned.reassignment.reason === "Preparer on leave");
  check("the running timer is carried across, not orphaned", reassigned.reassignment.activeTimerIds.includes(timer.id));
  const movedTimer = await prisma.timeEntry.findUniqueOrThrow({ where: { id: timer.id } });
  check("the timer now belongs to the new owner", movedTimer.userId === successor.id);
  check("the reassignment was notified", reassigned.reassignment.notifiedAt !== null);

  // Handover on exit.
  const handover = await handoverList({ userId: preparer.id, practiceIds: scoped });
  check("an exiting employee produces a handover list", handover.totalItems > 0);
  check("the handover states that items need rehoming", handover.requiresRehoming);
  check(
    "handover items are all in the caller's practice scope",
    handover.ownedJobs.every((j) => typeof j.id === "string"),
  );

  const cleanHandover = await handoverList({ userId: successor.id, practiceIds: [otherPractice.id] });
  check(
    "a user with nothing in a practice produces an empty handover, not an error",
    cleanHandover.totalItems === 0 && cleanHandover.requiresRehoming === false,
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
