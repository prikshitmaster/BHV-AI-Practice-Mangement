/**
 * T17 acceptance test — REP01 (PRD §40).
 * REP02 (combined reports) and REP03 (targets and baseline) are R1 and not
 * covered.
 *
 * PRD acceptance evidence, verbatim:
 *   "Drill from a chart to its underlying authorised records and reconcile
 *    totals to an exported report. A deadline extension applies the documented
 *    current date policy while retaining a historical snapshot for prior
 *    reports."
 *
 * Both are the sections marked EVIDENCE below. Everything else covers the
 * rules those headlines rest on — above all the one that is easiest to get
 * wrong and worst to get wrong: an empty denominator is NOT AVAILABLE, never
 * zero. Each headline is paired with a CONTROL so it cannot pass with the
 * mechanism switched off.
 *
 * The extension leg drives the REAL `applyExtension`, not a hand-written
 * ObligationChange row. A fixture that invents the shape of the record it
 * later reads proves only that the test agrees with itself.
 *
 * Library level — no HTTP server required, no object store required.
 * All fixture data is fictional. Run: npm run test:t17
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  DATE_POLICY,
  drillThrough,
  formatMeasure,
  listReportDefinitions,
  runReport,
  toCsv,
  type Measure,
} from "../src/lib/report-catalogue";
import { PracticeAccessError } from "../src/lib/practice-scope";
import { PermissionDeniedError } from "../src/lib/permissions";
import {
  activateRule,
  applyExtension,
  createObligationInstance,
  createObligationRule,
  markFiled,
  previewExtension,
  reviewRule,
} from "../src/lib/statutory-calendar";
import { transitionJob } from "../src/lib/work";
import {
  approveInvoice,
  createInvoiceSeries,
  draftInvoice,
  issueInvoice,
} from "../src/lib/invoicing";
import { allocateReceipt, recordReceipt } from "../src/lib/receipts";

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

function measure(measures: Measure[], label: string): Measure {
  const found = measures.find((m) => m.label === label);
  if (!found) throw new Error(`No measure "${label}" — got ${measures.map((m) => m.label).join(", ")}`);
  return found;
}

async function main() {
  console.log("\nT17 — reports, definitions and drill-through (PRD §40 REP01)\n");

  // ------------------------------------------------------------ fixtures

  const tenant = await prisma.tenant.create({ data: { name: tag("BHV") } });

  async function makePractice(name: string, ns: string) {
    return prisma.practice.create({
      data: {
        tenantId: tenant.id,
        name: tag(name),
        registeredDisplayName: tag(`${name} Registered`),
        constitution: "PARTNERSHIP",
        documentNamespace: `${ns}-${RUN}`.toLowerCase(),
        effectiveFrom: d("2024-04-01"),
      },
    });
  }
  // Two practices: one carrying the data, one empty. The empty one is not
  // decoration — it is how "no denominator" is proved to read as Not
  // available rather than 0%.
  const company = await makePractice("Fictional Company LLP", "t17co");
  const associates = await makePractice("Fictional Associates", "t17as");

  async function makeUser(label: string) {
    return prisma.user.create({
      data: {
        email: `${label}-${RUN}@example.invalid`,
        fullName: `Fictional ${label}`,
        status: "ACTIVE",
      },
    });
  }
  const partner = await makeUser("Partner");
  const outsider = await makeUser("Outsider");
  const article = await makeUser("Article");
  // A separate drafter: IAM04 bars the partner from approving an invoice they
  // drafted themselves, which the first run of this test proved by refusing.
  const biller = await makeUser("Biller");

  await prisma.practiceMembership.createMany({
    data: [
      { practiceId: company.id, userId: partner.id, role: "PRACTICE_PARTNER", assignmentScope: "PRACTICE", effectiveFrom: d("2024-04-01") },
      { practiceId: associates.id, userId: partner.id, role: "PRACTICE_PARTNER", assignmentScope: "PRACTICE", effectiveFrom: d("2024-04-01") },
      // In Associates ONLY: must never see a Company figure.
      { practiceId: associates.id, userId: outsider.id, role: "PRACTICE_PARTNER", assignmentScope: "PRACTICE", effectiveFrom: d("2024-04-01") },
      // An article holds job.read but not invoice.read (IAM02).
      { practiceId: company.id, userId: article.id, role: "STAFF_ARTICLE", assignmentScope: "OWN_WORK", effectiveFrom: d("2024-04-01") },
      { practiceId: company.id, userId: biller.id, role: "FINANCE", assignmentScope: "PRACTICE", effectiveFrom: d("2024-04-01") },
    ],
  });

  const party = await prisma.party.create({
    data: { tenantId: tenant.id, legalName: tag("Fictional Client Private Limited"), type: "COMPANY" },
  });
  const client = await prisma.clientRelationship.create({
    data: { practiceId: company.id, partyId: party.id, acceptanceStatus: "ACCEPTED" },
  });
  const engagement = await prisma.engagement.create({
    data: {
      practiceId: company.id,
      clientRelationshipId: client.id,
      serviceCode: "GST_ANNUAL",
      templateVersion: "1",
      periodStart: d("2025-04-01"),
      periodEnd: d("2026-03-31"),
      state: "ACTIVE",
    },
  });

  // ---------------------------------------------------------- the registry
  console.log("REP01 — every report states its own definition");

  const definitions = listReportDefinitions();
  check("the catalogue registers the R0 reports", definitions.length === 4, `${definitions.length}`);
  check(
    "every report carries a formula, a required permission and a filter surface",
    definitions.every(
      (def) => def.formula.length > 30 && !!def.requires && def.supportedFilters.length > 0,
    ),
    definitions.filter((def) => def.formula.length <= 30).map((def) => def.id).join(", "),
  );

  // ================================================== obligations fixture
  //
  // Two obligations. One is filed comfortably on time; the other is the
  // extension case, filed after its ORIGINAL date and before its EXTENDED one.

  const rule = await createObligationRule({
    code: tag("FICTIONAL-GSTR9"),
    version: 1,
    source: "Fictional statute, test fixture",
    governingLaw: "CGST_ACT_2017",
    service: "GST annual return",
    taxpayerCategory: "AUDIT_CASE",
    formVersion: "GSTR-9",
    relevantPeriod: "FY2025-26",
    effectiveFrom: d("2024-04-01"),
  });
  await reviewRule(rule.id);
  await activateRule({ ruleId: rule.id, approvingCaName: "Fictional CA" });

  const punctual = await createObligationInstance({
    practiceId: company.id,
    clientRelationshipId: client.id,
    engagementId: engagement.id,
    ruleId: rule.id,
    periodKey: "FY2025-26",
    statutoryDate: d("2026-10-31"),
    taxpayerCategory: "AUDIT_CASE",
    formVersion: "GSTR-9",
    governingLaw: "CGST_ACT_2017",
  });
  const extended = await createObligationInstance({
    practiceId: company.id,
    clientRelationshipId: client.id,
    engagementId: engagement.id,
    ruleId: rule.id,
    periodKey: "FY2025-26-Q2",
    statutoryDate: d("2026-10-31"),
    taxpayerCategory: "AUDIT_CASE",
    formVersion: "GSTR-9",
    governingLaw: "CGST_ACT_2017",
  });
  // A third, left unresolved: §40 requires unknown/disputed cases to be
  // counted separately rather than folded into either side of the ratio.
  const disputed = await createObligationInstance({
    practiceId: company.id,
    clientRelationshipId: client.id,
    engagementId: engagement.id,
    ruleId: rule.id,
    periodKey: "FY2025-26-Q3",
    statutoryDate: d("2026-10-31"),
    taxpayerCategory: "AUDIT_CASE",
    formVersion: "GSTR-9",
    governingLaw: "CGST_ACT_2017",
  });
  await prisma.obligation.update({
    where: { id: disputed.id },
    data: { status: "REJECTED" },
  });

  await markFiled({
    obligationId: punctual.id,
    practiceId: company.id,
    acknowledgementReference: `ACK-${RUN}-1`,
    filedAt: d("2026-10-20"),
    reviewerName: "Fictional Reviewer",
  });

  const beforeExtension = new Date();
  // A pause the extension's createdAt can land after, so "as at just before
  // the extension" is a real instant and not a coin toss on the clock.
  await new Promise((r) => setTimeout(r, 1100));

  const extension = await prisma.statutoryExtension.create({
    data: {
      tenantId: tenant.id,
      notificationReference: `FICTIONAL/${RUN}`,
      authoritativeSource: "https://example.invalid/notification/fictional",
      sourceDate: d("2026-10-25"),
      jurisdiction: "IN",
      governingLaw: "CGST_ACT_2017",
      ruleCode: rule.code,
      taxpayerCategory: "AUDIT_CASE",
      periodKey: "FY2025-26-Q2",
      formVersion: "GSTR-9",
      originalDate: d("2026-10-31"),
      extendedDate: d("2026-11-30"),
    },
  });
  await previewExtension(extension.id);
  await applyExtension({
    extensionId: extension.id,
    approvedByName: "Fictional Partner",
    actorUserId: partner.id,
  });

  const afterExtension = new Date();

  // Filed after the ORIGINAL date, before the EXTENDED one. Which answer is
  // correct depends entirely on when you ask — which is the requirement.
  await markFiled({
    obligationId: extended.id,
    practiceId: company.id,
    acknowledgementReference: `ACK-${RUN}-2`,
    filedAt: d("2026-11-10"),
    reviewerName: "Fictional Reviewer",
  });

  // =========================================================== EVIDENCE 2
  console.log("\n  EVIDENCE — an extension applies the current date policy, and prior reports keep theirs");

  const period = { periodStart: d("2026-10-01"), periodEnd: d("2026-12-31") };

  const liveReport = await runReport(partner.id, "on-time-filing-rate", {
    practiceId: company.id,
    ...period,
  });
  const historicReport = await runReport(partner.id, "on-time-filing-rate", {
    practiceId: company.id,
    ...period,
    asAt: beforeExtension,
  });

  const liveRow = liveReport.rows.find((r) => r.recordId === extended.id);
  const historicRow = historicReport.rows.find((r) => r.recordId === extended.id);

  check(
    "EVIDENCE: a report run NOW uses the extended date, so the filing is on time",
    liveRow?.cells["Due (as at report)"] === "2026-11-30" && liveRow?.cells.Outcome === "On time",
    `${liveRow?.cells["Due (as at report)"]} / ${liveRow?.cells.Outcome}`,
  );
  check(
    "EVIDENCE: a report AS AT before the extension keeps the original date, and the same filing is late",
    historicRow?.cells["Due (as at report)"] === "2026-10-31" &&
      historicRow?.cells.Outcome === "Not on time",
    `${historicRow?.cells["Due (as at report)"]} / ${historicRow?.cells.Outcome}`,
  );
  check(
    "EVIDENCE: the extension did not rewrite the original date — both are on the row",
    liveRow?.cells["Original due"] === "2026-10-31",
    String(liveRow?.cells["Original due"]),
  );
  check(
    "the two reports therefore disagree, and that is the point",
    measure(liveReport.measures, "On time filing rate").value !==
      measure(historicReport.measures, "On time filing rate").value,
    `${formatMeasure(measure(liveReport.measures, "On time filing rate"))} vs ${formatMeasure(
      measure(historicReport.measures, "On time filing rate"),
    )}`,
  );
  check(
    "the date policy is stated, not implied",
    DATE_POLICY.includes("as-at") && DATE_POLICY.length > 60,
  );

  // CONTROL — the obligation that was never extended reads the same either way.
  const punctualLive = liveReport.rows.find((r) => r.recordId === punctual.id);
  const punctualHistoric = historicReport.rows.find((r) => r.recordId === punctual.id);
  check(
    "CONTROL — an obligation with no extension reads identically in both reports",
    punctualLive?.cells["Due (as at report)"] === punctualHistoric?.cells["Due (as at report)"] &&
      punctualLive?.cells.Outcome === "On time",
    `${punctualLive?.cells["Due (as at report)"]} vs ${punctualHistoric?.cells["Due (as at report)"]}`,
  );

  // §40: unknown / disputed shown separately.
  check(
    "REP01: the rejected obligation is excluded from the ratio, not counted as a failure",
    liveReport.excluded?.count === 1 && liveReport.excluded.recordIds.includes(disputed.id),
    `${liveReport.excluded?.count}`,
  );
  const liveRate = measure(liveReport.measures, "On time filing rate");
  check(
    "REP01: ...so the denominator is the two resolved cases, not all three",
    liveRate.denominator === 2 && liveRate.numerator === 2,
    `${liveRate.numerator}/${liveRate.denominator}`,
  );

  // =========================================================== EVIDENCE 1
  console.log("\n  EVIDENCE — drill from a figure to its authorised records, and reconcile to the export");

  const drill = await drillThrough(partner.id, "on-time-filing-rate", {
    practiceId: company.id,
    ...period,
  });
  check(
    "EVIDENCE: the drill returns the records behind the figure",
    drill.rows.length === liveReport.rows.length && drill.rows.length === 3,
    `${drill.rows.length} rows`,
  );
  check(
    "EVIDENCE: every drilled record is one the caller is authorised to see",
    drill.rows.every((row) => row.practiceId === company.id),
    [...new Set(drill.rows.map((r) => r.practiceId))].join(", "),
  );
  check(
    "EVIDENCE: the record count matches the rows — a count never counts what you cannot open",
    drill.recordCount === drill.rows.length,
    `${drill.recordCount} vs ${drill.rows.length}`,
  );

  const csv = toCsv(liveReport);
  const csvLines = csv.split("\n");
  const dataLines = csvLines.filter((l) => !l.startsWith("#") && l.trim().length > 0);
  check(
    "EVIDENCE: the export contains a line per record plus one header",
    dataLines.length === liveReport.rows.length + 1,
    `${dataLines.length} lines for ${liveReport.rows.length} rows`,
  );
  check(
    "EVIDENCE: the export's totals reconcile to the figures on the report",
    csv.includes(`[${liveRate.numerator} / ${liveRate.denominator}]`),
    csv.split("\n").find((l) => l.includes("On time filing rate")) ?? "",
  );
  check(
    "REP01: the export carries the formula, the refresh time and the record count",
    csv.includes("# Formula:") &&
      csv.includes("# Refreshed at:") &&
      csv.includes(`# Record count: ${liveReport.recordCount}`),
  );
  check(
    "REP01: the export states the status basis, so a figure cannot be requoted without it",
    csv.includes("# Status basis:") && csv.includes("# Date policy:"),
  );
  check(
    "every drilled record id appears in the export",
    drill.rows.every((row) => csv.includes(row.recordId)),
  );

  // CONTROL — the same drill for someone outside the practice.
  const outsiderDrill = await throws(
    () => drillThrough(outsider.id, "on-time-filing-rate", { practiceId: company.id, ...period }),
    PracticeAccessError,
  );
  check(
    "CONTROL — an Associates-only user drilling a Company report is refused, as not found",
    outsiderDrill !== null && outsiderDrill.status === 404,
    outsiderDrill ? "" : "the drill succeeded",
  );

  // A user in BOTH practices, with no practice named, gets both — and still
  // only the two. A combined report is a permission, not a default.
  const combined = await runReport(partner.id, "on-time-filing-rate", period);
  check(
    "REP01: a combined report names the practices it covers",
    combined.scope.practiceIds.length === 2,
    `${combined.scope.practiceIds.length}`,
  );
  const outsiderCombined = await runReport(outsider.id, "on-time-filing-rate", period);
  check(
    "ORG04: the same combined report for an Associates-only user covers only Associates",
    outsiderCombined.scope.practiceIds.length === 1 &&
      outsiderCombined.scope.practiceIds[0] === associates.id,
    outsiderCombined.scope.practiceIds.join(", "),
  );
  check(
    "ORG04: ...and returns none of the Company records",
    outsiderCombined.rows.length === 0,
    `${outsiderCombined.rows.length} rows`,
  );

  // IAM01: the report's own permission, not just practice membership.
  const articleDenied = await throws(
    () => runReport(article.id, "receivables-ageing", { practiceId: company.id }),
    PermissionDeniedError,
  );
  check(
    "IAM01: an article, who holds no invoice.read, cannot run the receivables report",
    articleDenied !== null,
    articleDenied ? "" : "the article ran it",
  );

  // ================================================ the empty denominator
  console.log("\nREP01 — an empty denominator is Not available, never zero");

  const emptyReport = await runReport(partner.id, "on-time-filing-rate", {
    practiceId: associates.id,
    ...period,
  });
  const emptyRate = measure(emptyReport.measures, "On time filing rate");
  check(
    "an on-time rate with nothing due is NULL, not 0",
    emptyRate.value === null,
    String(emptyRate.value),
  );
  check(
    "...and says why, in words a partner can act on",
    !!emptyRate.notAvailableReason && emptyRate.notAvailableReason.length > 20,
    emptyRate.notAvailableReason ?? "",
  );
  check(
    "...and renders as Not available",
    formatMeasure(emptyRate) === "Not available",
    formatMeasure(emptyRate),
  );
  check(
    "the denominator is reported as 0 so the reader can see WHY it is unavailable",
    emptyRate.denominator === 0,
  );
  check(
    "a count of zero is still zero — the rule applies to ratios, not to counts",
    measure(emptyReport.measures, "Applicable obligations due").value === 0,
  );

  // CONTROL — the same report where a denominator DOES exist produces a number.
  check(
    "CONTROL — with obligations in scope the same measure is a real ratio",
    liveRate.value !== null && liveRate.value > 0,
    String(liveRate.value),
  );

  // ============================================== work and review ageing
  console.log("\n§40 — work and review ageing keeps client and internal waiting apart");

  async function makeJob(label: string, dedup: string) {
    return prisma.job.create({
      data: {
        practiceId: company.id,
        engagementId: engagement.id,
        title: tag(label),
        periodKey: "FY2025-26",
        dedupKey: `${dedup}-${RUN}`,
        state: "READY",
      },
    });
  }
  const waitingOnClient = await makeJob("Fictional job waiting on client", "wc");
  const waitingInternally = await makeJob("Fictional job waiting internally", "wi");
  const movingAlong = await makeJob("Fictional job in progress", "ip");

  for (const [job, state] of [
    [waitingOnClient, "WAITING_FOR_CLIENT"],
    [waitingInternally, "WAITING_INTERNALLY"],
    [movingAlong, "IN_PROGRESS"],
  ] as const) {
    await transitionJob({
      jobId: job.id,
      practiceId: company.id,
      toState: state,
      actorUserId: partner.id,
      actorName: "Fictional Partner",
    });
  }

  const ageing = await runReport(partner.id, "work-review-ageing", { practiceId: company.id });
  check(
    "the three open jobs are in scope",
    measure(ageing.measures, "Open jobs").value === 3,
    String(measure(ageing.measures, "Open jobs").value),
  );
  check(
    "client waiting and internal waiting are SEPARATE measures, never one ageing number",
    ageing.measures.some((m) => m.label.includes("waiting on the client")) &&
      ageing.measures.some((m) => m.label.includes("waiting internally")),
    ageing.measures.map((m) => m.label).join(" | "),
  );
  check(
    "each measure counts only its own jobs",
    measure(ageing.measures, "Mean days waiting on the client").denominator === 1 &&
      measure(ageing.measures, "Mean days waiting internally").denominator === 1,
  );
  const inProgressRow = ageing.rows.find((r) => r.recordId === movingAlong.id);
  check(
    "a job that is not waiting is marked as waiting on nobody",
    inProgressRow?.cells["Waiting on"] === "",
    String(inProgressRow?.cells["Waiting on"]),
  );

  // ================================================ document completeness
  console.log("\n§40 — received is not accepted");

  const request = await prisma.clientRequest.create({
    data: {
      practiceId: company.id,
      clientRelationshipId: client.id,
      engagementId: engagement.id,
      title: tag("Fictional records request"),
      requestedItems: [],
    },
  });
  const itemStates = ["ACCEPTED", "ACCEPTED", "SUBMITTED", "OUTSTANDING", "WAIVED"] as const;
  for (const [index, state] of itemStates.entries()) {
    await prisma.clientRequestItem.create({
      data: {
        practiceId: company.id,
        requestId: request.id,
        sequence: index + 1,
        documentType: `Fictional document ${index + 1}`,
        state,
        stateChangedAt: new Date(),
      },
    });
  }

  const completeness = await runReport(partner.id, "document-completeness", {
    practiceId: company.id,
  });
  const completenessRate = measure(completeness.measures, "Document completeness");
  check(
    "waived items are outside the population, so the denominator is four, not five",
    completenessRate.denominator === 4,
    String(completenessRate.denominator),
  );
  check(
    "a SUBMITTED item is not counted as complete",
    completenessRate.numerator === 2,
    String(completenessRate.numerator),
  );
  check(
    "...and is reported as its own measure instead",
    measure(completeness.measures, "Received but not yet accepted").value === 1,
    String(measure(completeness.measures, "Received but not yet accepted").value),
  );

  // =================================================== receivables ageing
  console.log("\n§40 — cash, tax deducted and write-offs stay distinct in the receivable");

  const series = await createInvoiceSeries({
    userId: biller.id,
    practiceId: company.id,
    code: "T17",
    fiscalPeriod: "2025-26",
    numberFormat: "{code}/{fiscalPeriod}/{number}",
    startAt: 1,
  });
  const invoice = await draftInvoice({
    userId: biller.id,
    practiceId: company.id,
    seriesId: series.id,
    clientRelationshipId: client.id,
    engagementId: engagement.id,
    lines: [{ description: "Fictional professional fees", quantity: 1, unitAmount: 10000 }],
    dueDate: d("2026-01-31"),
  });
  const approvedInvoice = await approveInvoice({
    userId: partner.id,
    approverName: "Fictional Partner",
    practiceId: company.id,
    invoiceId: invoice.id,
    expectedVersion: invoice.version,
  });
  const issued = await issueInvoice({
    userId: partner.id,
    practiceId: company.id,
    invoiceId: invoice.id,
    expectedVersion: approvedInvoice.version,
    issueDate: d("2026-01-01"),
  });

  const bank = await prisma.practiceBankAccount.create({
    data: {
      practiceId: company.id,
      label: "Current account",
      bankName: "Fictional Bank",
      accountNumber: "0000000000",
      ifsc: "FAKE0000000",
      effectiveFrom: d("2024-04-01"),
      verifiedAt: new Date(),
      verifiedBy: "Fictional Partner",
    },
  });
  const receipt = await recordReceipt({
    userId: biller.id,
    practiceId: company.id,
    clientRelationshipId: client.id,
    bankAccountId: bank.id,
    amount: 9000,
    receivedAt: d("2026-02-10"),
    method: "BANK_TRANSFER",
    reference: `REF-${RUN}`,
  });
  await allocateReceipt({
    userId: biller.id,
    practiceId: company.id,
    receiptId: receipt.id,
    invoiceId: issued.id,
    kind: "PAYMENT",
    amount: 9000,
  });
  // TDS is not cash and must NOT name a receipt — money the client never sent
  // us cannot have arrived in a bank account. The library refuses it, which is
  // how this fixture learned the rule.
  await allocateReceipt({
    userId: biller.id,
    practiceId: company.id,
    invoiceId: issued.id,
    kind: "TDS",
    amount: 500,
  });

  const receivables = await runReport(partner.id, "receivables-ageing", {
    practiceId: company.id,
    asAt: d("2026-03-31"),
  });
  const invoiceRow = receivables.rows.find((r) => r.recordId === issued.id);
  check(
    "cash received and tax deducted are separate columns, never one received figure",
    invoiceRow?.cells["Cash received"] === "9000.00" &&
      invoiceRow?.cells["Tax deducted"] === "500.00",
    `${invoiceRow?.cells["Cash received"]} / ${invoiceRow?.cells["Tax deducted"]}`,
  );
  check(
    "the outstanding balance nets both — 10000 less 9000 cash less 500 TDS",
    invoiceRow?.cells.Outstanding === "500.00",
    String(invoiceRow?.cells.Outstanding),
  );
  check(
    "...and the bucket total equals it, so the ageing sums to the ledger",
    measure(receivables.measures, "Outstanding — 31-60 days").value === 500,
    String(measure(receivables.measures, "Outstanding — 31-60 days").value),
  );
  check(
    "a fully settled invoice would not be receivable at all — this one still is",
    measure(receivables.measures, "Total outstanding").value === 500,
    String(measure(receivables.measures, "Total outstanding").value),
  );
  check(
    "the invoice is aged from its DUE date, not its issue date",
    invoiceRow?.cells.Due === "2026-01-31" && Number(invoiceRow?.cells["Days overdue"]) === 59,
    `${invoiceRow?.cells.Due} / ${invoiceRow?.cells["Days overdue"]}`,
  );
  check(
    "REP01: the receivables report states its own status basis",
    receivables.scope.statusBasis.includes("Issued and part paid"),
    receivables.scope.statusBasis.slice(0, 60),
  );

  // ------------------------------------------------------------- filters
  console.log("\nREP01 — filters cannot be used to reach across a practice");

  const otherParty = await prisma.party.create({
    data: { tenantId: tenant.id, legalName: tag("Associates Only Client"), type: "COMPANY" },
  });
  const otherClient = await prisma.clientRelationship.create({
    data: { practiceId: associates.id, partyId: otherParty.id, acceptanceStatus: "ACCEPTED" },
  });

  const crossFilter = await throws(
    () =>
      runReport(partner.id, "document-completeness", {
        practiceId: company.id,
        // A real client id — in the OTHER practice.
        clientRelationshipId: otherClient.id,
      }),
    PracticeAccessError,
  );
  check(
    "a client filter from another practice is refused rather than quietly ignored",
    crossFilter !== null,
    crossFilter ? "" : "the filter was accepted",
  );

  const badPeriod = await runReport(partner.id, "on-time-filing-rate", {
    practiceId: company.id,
    periodStart: d("2026-12-01"),
    periodEnd: d("2026-12-31"),
  });
  check(
    "CONTROL — a period with nothing in it returns no rows and Not available, not an error",
    badPeriod.rows.length === 0 &&
      measure(badPeriod.measures, "On time filing rate").value === null,
    `${badPeriod.rows.length} rows`,
  );
  check(
    "REP01: the report states the period it covers",
    badPeriod.scope.periodStart?.toISOString().slice(0, 10) === "2026-12-01" &&
      badPeriod.scope.periodEnd?.toISOString().slice(0, 10) === "2026-12-31",
  );
  check(
    "REP01: every report carries a refresh time",
    badPeriod.refreshedAt instanceof Date && badPeriod.refreshedAt <= new Date(),
  );

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
  void afterExtension;
}

main()
  .catch((e) => {
    console.error("\nTEST RUN ERROR:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
