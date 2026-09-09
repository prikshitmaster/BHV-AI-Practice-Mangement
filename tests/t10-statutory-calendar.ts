/**
 * T10 acceptance test — DUE01-04, DUE06 (PRD §14). DUE05 is R1.
 *
 * PRD acceptance evidence, verbatim:
 *   "An extension applicable only to one taxpayer class changes only those
 *    open obligations. The audit trail shows both dates. An obligation with an
 *    unknown form or category remains visible in Review required. A bounced
 *    reminder never becomes evidence of client receipt."
 *
 * Also covers the section's closing requirement: both income tax regimes must
 * coexist, with law, assessment year and tax year stored independently —
 * "Filing date alone must not choose the Act."
 *
 * Library level — no HTTP server required. All fixture data is fictional.
 * Run: npm run test:t10
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  CalendarError,
  acknowledgeAlert,
  activateRule,
  applyExtension,
  createObligationInstance,
  createObligationRule,
  dateHistory,
  generateAlerts,
  isEvidenceOfReceipt,
  markFiled,
  previewExtension,
  recordAlertDelivery,
  resolveReviewRequired,
  reviewRule,
  shiftInternalReminderForHolidays,
} from "../src/lib/statutory-calendar";

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
const day = (x: Date) => x.toISOString().slice(0, 10);

async function main() {
  console.log("\nT10 — statutory calendar (PRD §14 DUE01-04, DUE06)\n");

  const tenant = await prisma.tenant.create({ data: { name: tag("T") } });
  const practice = await prisma.practice.create({
    data: {
      tenantId: tenant.id, name: tag("Company"), constitution: "LLP",
      documentNamespace: tag("co"), effectiveFrom: d("2024-04-01"),
    },
  });
  const reviewerUser = await prisma.user.create({
    data: { email: `rev-${RUN}@example.invalid`, fullName: "Fictional Reviewer", status: "ACTIVE" },
  });

  async function makeClient(name: string) {
    const party = await prisma.party.create({
      data: { tenantId: tenant.id, legalName: tag(name), type: "COMPANY" },
    });
    return prisma.clientRelationship.create({
      data: { practiceId: practice.id, partyId: party.id, acceptanceStatus: "ACCEPTED" },
    });
  }

  // ---------------------------------------------------------------- DUE01
  console.log("DUE01 — obligation rule lifecycle");

  const rule = await createObligationRule({
    code: tag("ITR6"),
    version: 1,
    source: "Income-tax Act 1961 s.139(1) (fictional citation)",
    governingLaw: "INCOME_TAX_ACT_1961",
    service: "ITR",
    relevantPeriod: "AY 2026-27",
    formVersion: "ITR-6 v1",
    dueDateExpression: "31 October of the assessment year for audit cases",
    authoritativeSource: "https://example.invalid/notification/fictional-1",
    sourceDate: d("2025-04-01"),
    applicability: { auditCase: true },
    effectiveFrom: d("2025-04-01"),
  });

  check("a new rule starts in DRAFT", rule.status === "DRAFT");
  check("the rule stores its governing law", rule.governingLaw === "INCOME_TAX_ACT_1961");
  check("the rule stores the due-date EXPRESSION, not just a date", (rule.dueDateExpression ?? "").length > 0);
  check("the rule records its authoritative source and date", !!rule.authoritativeSource && !!rule.sourceDate);

  const notReviewed = await throws(
    () => activateRule({ ruleId: rule.id, approvingCaName: "Fictional CA" }),
    CalendarError,
  );
  check("a DRAFT rule cannot be activated directly", notReviewed?.code === "NOT_REVIEWED");

  await reviewRule(rule.id);
  const noApprover = await throws(
    () => activateRule({ ruleId: rule.id, approvingCaName: "  " }),
    CalendarError,
  );
  check("activation must name the approving CA", noApprover?.code === "APPROVER_REQUIRED");

  const active = await activateRule({ ruleId: rule.id, approvingCaName: "Fictional CA" });
  check("a reviewed rule can be activated", active.status === "ACTIVE");
  check("the approving CA is recorded", active.approvingCaName === "Fictional CA");

  // A v2 supersedes v1.
  const ruleV2 = await createObligationRule({
    code: rule.code, version: 2, source: "Amended (fictional)",
    governingLaw: "INCOME_TAX_ACT_1961", formVersion: "ITR-6 v2",
    effectiveFrom: d("2026-04-01"),
  });
  await reviewRule(ruleV2.id);
  await activateRule({ ruleId: ruleV2.id, approvingCaName: "Fictional CA" });
  const v1After = await prisma.obligationRule.findUniqueOrThrow({ where: { id: rule.id } });
  check("activating v2 supersedes v1 rather than deleting it", v1After.status === "SUPERSEDED");

  // ---------------------------------------------------------------- DUE02
  console.log("\nDUE02 — the dates are separate, and both regimes coexist");

  const auditClient = await makeClient("Audit Case Ltd");
  const auditObligation = await createObligationInstance({
    practiceId: practice.id,
    clientRelationshipId: auditClient.id,
    ruleId: rule.id,
    periodKey: "AY2026-27",
    statutoryDate: d("2026-10-31"),
    internalTargetDate: d("2026-10-10"),
    reviewTargetDate: d("2026-10-20"),
    clientDocumentCutoff: d("2026-09-15"),
    paymentDeadline: d("2026-10-31"),
    taxpayerCategory: "AUDIT_CASE",
    governingLaw: "INCOME_TAX_ACT_1961",
    assessmentYear: "AY 2026-27",
  });

  check(
    "statutory, internal, review, client-cutoff and payment dates are all distinct fields",
    day(auditObligation.currentStatutoryDate) === "2026-10-31" &&
      day(auditObligation.internalTargetDate!) === "2026-10-10" &&
      day(auditObligation.reviewTargetDate!) === "2026-10-20" &&
      day(auditObligation.clientDocumentCutoff!) === "2026-09-15" &&
      day(auditObligation.paymentDeadline!) === "2026-10-31",
  );
  check("the instance opens in OPEN, not review", auditObligation.status === "OPEN");

  // Both regimes, distinguished by stored law — not by filing date.
  const newRegimeRule = await createObligationRule({
    code: tag("ITR-TY"), version: 1, source: "Income-tax Act 2025 (fictional citation)",
    governingLaw: "INCOME_TAX_ACT_2025", service: "ITR", formVersion: "ITR-TY v1",
    effectiveFrom: d("2026-04-01"),
  });
  await reviewRule(newRegimeRule.id);
  await activateRule({ ruleId: newRegimeRule.id, approvingCaName: "Fictional CA" });

  const newRegimeClient = await makeClient("New Regime Ltd");
  const newRegimeObligation = await createObligationInstance({
    practiceId: practice.id,
    clientRelationshipId: newRegimeClient.id,
    ruleId: newRegimeRule.id,
    periodKey: "TY2026-27",
    statutoryDate: d("2027-10-31"),
    taxpayerCategory: "COMPANY_PRIVATE",
    governingLaw: "INCOME_TAX_ACT_2025",
    taxYear: "TY 2026-27",
  });

  check(
    "the 1961-Act obligation stores an ASSESSMENT year and no tax year",
    auditObligation.assessmentYear === "AY 2026-27" && auditObligation.taxYear === null,
  );
  check(
    "the 2025-Act obligation stores a TAX year and no assessment year",
    newRegimeObligation.taxYear === "TY 2026-27" && newRegimeObligation.assessmentYear === null,
  );
  check(
    "the governing law is stored independently of the dates",
    auditObligation.governingLaw === "INCOME_TAX_ACT_1961" &&
      newRegimeObligation.governingLaw === "INCOME_TAX_ACT_2025",
  );
  check(
    "two obligations filed in overlapping years are under DIFFERENT Acts — the date did not choose",
    auditObligation.governingLaw !== newRegimeObligation.governingLaw,
  );

  // --------------- ACCEPTANCE EVIDENCE: unknown stays in Review required
  console.log("\nEvidence — an unknown form or category stays in Review required");

  const unknownClient = await makeClient("Unknown Category Ltd");
  const unknownRule = await createObligationRule({
    code: tag("UNKNOWN"), version: 1, source: "Uncertain (fictional)",
    governingLaw: "OTHER", effectiveFrom: d("2025-04-01"),
  });
  await reviewRule(unknownRule.id);
  await activateRule({ ruleId: unknownRule.id, approvingCaName: "Fictional CA" });

  const unknownObligation = await createObligationInstance({
    practiceId: practice.id,
    clientRelationshipId: unknownClient.id,
    ruleId: unknownRule.id,
    periodKey: "2025-26",
    // No category, no form version, no statutory date — genuinely unknown.
  });

  check(
    "an obligation with unknown category/form stays in REVIEW_REQUIRED",
    unknownObligation.status === "REVIEW_REQUIRED",
    unknownObligation.status,
  );
  check(
    "it is NOT silently marked Not applicable",
    unknownObligation.status !== "NOT_APPLICABLE",
  );

  const stillVisible = await prisma.obligation.findMany({
    where: { practiceId: practice.id, status: "REVIEW_REQUIRED" },
  });
  check("it remains VISIBLE in a Review required queue", stillVisible.some((o) => o.id === unknownObligation.id));

  const reviewLogged = await prisma.event.count({
    where: { action: "OBLIGATION_REVIEW_REQUIRED", targetId: unknownObligation.id },
  });
  check("the reason it needs review is recorded", reviewLogged === 1);

  const halfResolved = await throws(
    () =>
      resolveReviewRequired({
        obligationId: unknownObligation.id,
        taxpayerCategory: "COMPANY_PRIVATE",
        actorName: "Fictional Reviewer",
      }),
    CalendarError,
  );
  check(
    "a partial resolution is refused — you cannot half-know an obligation",
    halfResolved?.code === "INCOMPLETE_RESOLUTION",
  );

  const noDetermination = await throws(
    () =>
      resolveReviewRequired({
        obligationId: unknownObligation.id,
        notApplicableReason: "   ",
        actorName: "Fictional Reviewer",
      }),
    CalendarError,
  );
  check("dismissing it as not applicable requires a stated determination", noDetermination?.code === "REASON_REQUIRED");

  const resolved = await resolveReviewRequired({
    obligationId: unknownObligation.id,
    taxpayerCategory: "COMPANY_PRIVATE",
    formVersion: "FORM-X v1",
    statutoryDate: d("2026-03-31"),
    actorName: "Fictional Reviewer",
  });
  check("supplying the missing particulars moves it to OPEN", resolved.status === "OPEN");

  // ---------- ACCEPTANCE EVIDENCE: extension affects ONE taxpayer class
  console.log("\nEvidence — an extension for ONE taxpayer class changes only those");

  // Three more obligations on the SAME original date, different categories.
  const nonAuditClient = await makeClient("Non Audit Ltd");
  const nonAuditObligation = await createObligationInstance({
    practiceId: practice.id, clientRelationshipId: nonAuditClient.id, ruleId: rule.id,
    periodKey: "AY2026-27", statutoryDate: d("2026-10-31"),
    taxpayerCategory: "NON_AUDIT_CASE", governingLaw: "INCOME_TAX_ACT_1961",
    assessmentYear: "AY 2026-27",
  });

  const audit2Client = await makeClient("Audit Case Two Ltd");
  const audit2Obligation = await createObligationInstance({
    practiceId: practice.id, clientRelationshipId: audit2Client.id, ruleId: rule.id,
    periodKey: "AY2026-27", statutoryDate: d("2026-10-31"),
    taxpayerCategory: "AUDIT_CASE", governingLaw: "INCOME_TAX_ACT_1961",
    assessmentYear: "AY 2026-27",
  });

  // An ALREADY FILED audit case — must not be reopened by the extension.
  const filedClient = await makeClient("Already Filed Ltd");
  const filedObligation = await createObligationInstance({
    practiceId: practice.id, clientRelationshipId: filedClient.id, ruleId: rule.id,
    periodKey: "AY2026-27", statutoryDate: d("2026-10-31"),
    taxpayerCategory: "AUDIT_CASE", governingLaw: "INCOME_TAX_ACT_1961",
    assessmentYear: "AY 2026-27",
  });
  await markFiled({
    obligationId: filedObligation.id, practiceId: practice.id,
    acknowledgementReference: "ACK-FICTIONAL-0001", filedAt: d("2026-10-15"),
    reviewerUserId: reviewerUser.id, reviewerName: "Fictional Reviewer",
  });

  const extension = await prisma.statutoryExtension.create({
    data: {
      tenantId: tenant.id,
      notificationReference: "CBDT Notification FICTIONAL/2026",
      authoritativeSource: "https://example.invalid/notification/fictional-2",
      sourceDate: d("2026-10-01"),
      jurisdiction: "IN",
      governingLaw: "INCOME_TAX_ACT_1961",
      ruleCode: rule.code,
      // Only audit cases.
      taxpayerCategory: "AUDIT_CASE",
      periodKey: "AY2026-27",
      originalDate: d("2026-10-31"),
      extendedDate: d("2026-11-30"),
    },
  });

  // A DIFFERENT tenant, with an identical audit case on the identical date
  // under the identical rule. A notification issued for our tenant must not
  // see it, count it, or move it.
  const otherTenant = await prisma.tenant.create({ data: { name: tag("OtherTenant") } });
  const otherTenantPractice = await prisma.practice.create({
    data: {
      tenantId: otherTenant.id, name: tag("OtherFirm"), constitution: "LLP",
      documentNamespace: tag("other"), effectiveFrom: d("2024-04-01"),
    },
  });
  const otherTenantParty = await prisma.party.create({
    data: { tenantId: otherTenant.id, legalName: tag("Other Tenant Audit Ltd"), type: "COMPANY" },
  });
  const otherTenantRel = await prisma.clientRelationship.create({
    data: { practiceId: otherTenantPractice.id, partyId: otherTenantParty.id, acceptanceStatus: "ACCEPTED" },
  });
  const otherTenantObligation = await createObligationInstance({
    practiceId: otherTenantPractice.id, clientRelationshipId: otherTenantRel.id, ruleId: rule.id,
    periodKey: "AY2026-27", statutoryDate: d("2026-10-31"),
    taxpayerCategory: "AUDIT_CASE", governingLaw: "INCOME_TAX_ACT_1961",
    assessmentYear: "AY 2026-27",
  });

  const notPreviewed = await throws(
    () => applyExtension({ extensionId: extension.id, approvedByName: "Fictional CA" }),
    CalendarError,
  );
  check("an extension cannot be applied before it is previewed", notPreviewed?.code === "PREVIEW_REQUIRED");

  const preview = await previewExtension(extension.id);
  check(
    "the preview shows exactly the two OPEN audit cases",
    preview.affectedCount === 2,
    `${preview.affectedCount} affected`,
  );
  check(
    "the preview excludes the non-audit case",
    !preview.affected.some((a) => a.id === nonAuditObligation.id),
  );
  check(
    "the preview reports the completed filing it deliberately left out",
    preview.excludedBecauseCompleted === 1,
    `${preview.excludedBecauseCompleted}`,
  );
  check(
    "the preview does NOT include the other tenant's identical obligation",
    !preview.affected.some((a) => a.id === otherTenantObligation.id) &&
      !preview.affected.some((a) => a.practiceId === otherTenantPractice.id),
  );

  await applyExtension({ extensionId: extension.id, approvedByName: "Fictional CA" });

  const auditAfter = await prisma.obligation.findUniqueOrThrow({ where: { id: auditObligation.id } });
  const audit2After = await prisma.obligation.findUniqueOrThrow({ where: { id: audit2Obligation.id } });
  const nonAuditAfter = await prisma.obligation.findUniqueOrThrow({ where: { id: nonAuditObligation.id } });
  const filedAfter = await prisma.obligation.findUniqueOrThrow({ where: { id: filedObligation.id } });

  check(
    "both open AUDIT cases moved to the extended date",
    day(auditAfter.currentStatutoryDate) === "2026-11-30" &&
      day(audit2After.currentStatutoryDate) === "2026-11-30",
  );
  check(
    "the NON-AUDIT case did NOT move",
    day(nonAuditAfter.currentStatutoryDate) === "2026-10-31",
    day(nonAuditAfter.currentStatutoryDate),
  );
  check(
    "the already-FILED case was not reopened and did not move",
    filedAfter.status === "FILED" && day(filedAfter.currentStatutoryDate) === "2026-10-31",
    `${filedAfter.status} / ${day(filedAfter.currentStatutoryDate)}`,
  );
  check(
    "an obligation under the OTHER Act was untouched",
    day(
      (await prisma.obligation.findUniqueOrThrow({ where: { id: newRegimeObligation.id } }))
        .currentStatutoryDate,
    ) === "2027-10-31",
  );
  const otherTenantAfter = await prisma.obligation.findUniqueOrThrow({
    where: { id: otherTenantObligation.id },
  });
  check(
    "the OTHER TENANT's identical obligation did not move",
    day(otherTenantAfter.currentStatutoryDate) === "2026-10-31",
    day(otherTenantAfter.currentStatutoryDate),
  );

  // ----------------- ACCEPTANCE EVIDENCE: the audit trail shows BOTH dates
  console.log("\nEvidence — the audit trail shows BOTH dates");

  check(
    "the ORIGINAL statutory date is preserved on the record",
    day(auditAfter.originalStatutoryDate) === "2026-10-31",
    day(auditAfter.originalStatutoryDate),
  );
  check("...while the CURRENT date is the extended one", day(auditAfter.currentStatutoryDate) === "2026-11-30");

  const history = await dateHistory(auditObligation.id);
  check("the revision history records the change", history.revisions.length === 1);
  const rev = history.revisions[0];
  const beforeMeta = rev.beforeMeta as Record<string, string>;
  const afterMeta = rev.afterMeta as Record<string, string>;
  check(
    "the revision shows the old AND new current date",
    beforeMeta.currentStatutoryDate === "2026-10-31" && afterMeta.currentStatutoryDate === "2026-11-30",
  );
  check(
    "the revision shows the original date unchanged throughout",
    beforeMeta.originalStatutoryDate === "2026-10-31" && afterMeta.originalStatutoryDate === "2026-10-31",
  );
  check("the revision links the authorising source", (rev.sourceReference ?? "").includes("fictional-2"));
  check("the revision names who applied it", rev.changedByName === "Fictional CA");

  const auditEvent = await prisma.event.findFirst({
    where: { action: "OBLIGATION_DATE_EXTENDED", targetId: auditObligation.id },
  });
  const eventAfter = auditEvent?.afterMeta as Record<string, string>;
  check(
    "the append-only audit trail also carries both dates",
    eventAfter?.currentStatutoryDate === "2026-11-30" &&
      eventAfter?.originalStatutoryDatePreserved === "2026-10-31",
  );

  // ------------- ACCEPTANCE EVIDENCE: a bounced reminder is not receipt
  console.log("\nEvidence — a bounced reminder is never evidence of client receipt");

  const alerts = await generateAlerts({ practiceId: practice.id, now: d("2026-11-20") });
  check("alerts are generated as the date approaches", alerts.created > 0, `${alerts.created}`);

  // DUE06: rerunning after a missed scheduler run must not duplicate.
  const rerun = await generateAlerts({ practiceId: practice.id, now: d("2026-11-20") });
  check("a repeated scheduler run creates NO duplicate alerts", rerun.created === 0, `${rerun.created}`);

  const alert = await prisma.obligationAlert.findFirstOrThrow({
    where: { obligationId: auditObligation.id },
  });

  const bounced = await recordAlertDelivery({
    alertId: alert.id, state: "BOUNCED", detail: "550 mailbox unavailable",
  });
  check(
    "a bounced reminder is NOT evidence of receipt",
    isEvidenceOfReceipt(bounced) === false,
  );
  const ackBounced = await throws(
    () => acknowledgeAlert({ alertId: alert.id, name: "Client" }),
    CalendarError,
  );
  check("a bounced reminder cannot even be acknowledged", ackBounced?.code === "NOT_DELIVERED");

  const delivered = await recordAlertDelivery({ alertId: alert.id, state: "DELIVERED" });
  check(
    "delivery alone is still not evidence of receipt without acknowledgement",
    isEvidenceOfReceipt(delivered) === false,
  );

  const acknowledged = await acknowledgeAlert({
    alertId: alert.id, userId: reviewerUser.id, name: "Fictional Client Contact",
  });
  check(
    "delivered AND acknowledged is evidence of receipt",
    isEvidenceOfReceipt(acknowledged) === true,
  );

  check(
    "escalation targets a responsible role",
    (await prisma.obligationAlert.findMany({ where: { obligationId: auditObligation.id } }))
      .every((a) => a.responsibleRole !== null),
  );

  // ------------------------------- DUE04: filing needs evidence + reviewer
  console.log("\nDUE04 — filing completion needs a reference AND reviewer confirmation");

  const noRef = await throws(
    () =>
      markFiled({
        obligationId: audit2Obligation.id, practiceId: practice.id,
        acknowledgementReference: "  ", filedAt: d("2026-11-25"),
        reviewerName: "Fictional Reviewer",
      }),
    CalendarError,
  );
  check("filing without an acknowledgement reference is refused", noRef?.code === "ACKNOWLEDGEMENT_REQUIRED");

  const noReviewer = await throws(
    () =>
      markFiled({
        obligationId: audit2Obligation.id, practiceId: practice.id,
        acknowledgementReference: "ACK-FICTIONAL-0002", filedAt: d("2026-11-25"),
        reviewerName: "   ",
      }),
    CalendarError,
  );
  check("filing without reviewer confirmation is refused", noReviewer?.code === "REVIEWER_REQUIRED");

  const filed = await markFiled({
    obligationId: audit2Obligation.id, practiceId: practice.id,
    acknowledgementReference: "ACK-FICTIONAL-0002", filedAt: d("2026-11-25"),
    reviewerUserId: reviewerUser.id, reviewerName: "Fictional Reviewer",
    sourceFileSha256: "d".repeat(64),
  });
  check("with both, the filing completes", filed.obligation.status === "FILED");
  check("the acknowledgement reference is stored as evidence", filed.evidence.acknowledgementReference === "ACK-FICTIONAL-0002");
  check("the reviewer confirmation is timestamped", filed.evidence.reviewerConfirmedAt !== null);

  // ---------------------------------------------------------------- DUE06
  console.log("\nDUE06 — holidays move internal reminders, never statutory dates");

  const shifted = shiftInternalReminderForHolidays(d("2026-11-14"), ["2026-11-14"]);
  check("an internal reminder falling on a holiday moves", shifted.movedBecauseOfHoliday);
  check("it moves EARLIER, never later than the statutory date", shifted.shifted < shifted.original);

  const beforeStatutory = auditAfter.currentStatutoryDate;
  const afterShift = await prisma.obligation.findUniqueOrThrow({ where: { id: auditObligation.id } });
  check(
    "the statutory date is untouched by holiday handling",
    day(afterShift.currentStatutoryDate) === day(beforeStatutory),
  );

  const notMoved = shiftInternalReminderForHolidays(d("2026-11-18"), ["2026-11-14"]);
  check("a working day is not moved", notMoved.movedBecauseOfHoliday === false);

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
