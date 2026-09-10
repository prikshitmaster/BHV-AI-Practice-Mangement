/**
 * T14 acceptance test — FIN01, FIN02, FIN04 (PRD §25).
 * FIN03 (tax particulars), FIN05 (collections) and FIN06 (accounting bridge)
 * are R1 and not covered.
 *
 * PRD acceptance evidence, verbatim:
 *   "Create identical invoice sequence numbers in separate permitted practice
 *    series without collision. Allocate a part payment and TDS deduction;
 *    cash, credited tax and balance remain distinct."
 *
 * (The third sentence of that paragraph — a rejected Tally export retrying
 * without a duplicate voucher — belongs to FIN06 and is R1.)
 *
 * Both are the sections marked EVIDENCE below. Everything else covers the
 * rules those headlines rest on, and each headline is paired with a CONTROL so
 * it cannot pass with the mechanism switched off.
 *
 * Library level — no HTTP server required, no object store required.
 * All fixture data is fictional. Run: npm run test:t14
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  FeeError,
  addFeeComponent,
  approveFeeArrangement,
  chargeableAmount,
  createFeeArrangement,
  currentArrangementFor,
  listBillableComponents,
  markMilestoneReached,
  reviseFeeArrangement,
} from "../src/lib/fees";
import {
  InvoiceError,
  approveInvoice,
  cancelInvoice,
  createInvoiceSeries,
  draftCreditNote,
  draftInvoice,
  issueCreditNote,
  issueInvoice,
  reviseDraftInvoice,
} from "../src/lib/invoicing";
import {
  ReceiptError,
  allocateReceipt,
  listAllocations,
  recordReceipt,
  reverseAllocation,
  settlementOf,
} from "../src/lib/receipts";
import { SeparationOfDutiesError } from "../src/lib/separation-of-duties";

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
  console.log("\nT14 — fees, invoicing and receipts (PRD §25 FIN01, FIN02, FIN04)\n");

  // ------------------------------------------------------------ fixtures

  const tenant = await prisma.tenant.create({ data: { name: tag("BHV") } });

  // TWO practices, because the headline evidence is about two series in two
  // practices carrying the same number without colliding.
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
  const alpha = await makePractice("Fictional Alpha & Co", "t14a");
  const beta = await makePractice("Fictional Beta Associates", "t14b");

  // Two people, because IAM04 forbids the drafter approving their own invoice.
  async function makeUser(label: string) {
    return prisma.user.create({
      data: {
        email: `${label}-${RUN}@example.invalid`,
        fullName: `Fictional ${label}`,
        status: "ACTIVE",
      },
    });
  }
  const drafter = await makeUser("Drafter");
  const approver = await makeUser("Approver");

  for (const practice of [alpha, beta]) {
    for (const user of [drafter, approver]) {
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
  }

  async function makeClient(practiceId: string, legalName: string) {
    const party = await prisma.party.create({
      data: { tenantId: tenant.id, legalName: tag(legalName), type: "COMPANY" },
    });
    const rel = await prisma.clientRelationship.create({
      data: { practiceId, partyId: party.id, acceptanceStatus: "ACCEPTED" },
    });
    const engagement = await prisma.engagement.create({
      data: {
        practiceId,
        clientRelationshipId: rel.id,
        serviceCode: "GST_ANNUAL",
        templateVersion: "1",
        periodStart: d("2025-04-01"),
        periodEnd: d("2026-03-31"),
      },
    });
    return { party, rel, engagement };
  }

  const alphaClient = await makeClient(alpha.id, "Fictional Client One Private Limited");
  const betaClient = await makeClient(beta.id, "Fictional Client Two Private Limited");

  const alphaBank = await prisma.practiceBankAccount.create({
    data: {
      practiceId: alpha.id,
      label: "Current account",
      bankName: "Fictional Bank",
      accountNumber: "0000000000",
      ifsc: "FAKE0000000",
      effectiveFrom: d("2024-04-01"),
      verifiedAt: new Date(),
      verifiedBy: "Fictional Partner",
    },
  });

  // ============================================================ FIN01
  console.log("FIN01 — a rate is agreed, never inferred");

  const noRate = await throws(
    () =>
      createFeeArrangement({
        userId: drafter.id,
        practiceId: alpha.id,
        engagementId: alphaClient.engagement.id,
        basis: "TIME_BASED",
        taxTreatment: "Taxable at 18% (fictional)",
        effectiveFrom: d("2025-04-01"),
      }),
    FeeError,
  );
  check(
    "FIN01: a time based fee with no agreed rate is refused",
    noRate?.code === "RATE_NOT_AGREED",
    noRate?.code ?? "no error",
  );

  const crossPractice = await throws(
    () =>
      createFeeArrangement({
        userId: drafter.id,
        practiceId: beta.id,
        // Alpha's engagement, offered to Beta.
        engagementId: alphaClient.engagement.id,
        basis: "FIXED",
        agreedAmount: 1000,
        taxTreatment: "Taxable (fictional)",
        effectiveFrom: d("2025-04-01"),
      }),
    FeeError,
  );
  check(
    "ORG04: a fee cannot be tied to another practice's engagement",
    crossPractice?.code === "ENGAGEMENT_NOT_FOUND",
    crossPractice?.code ?? "no error",
  );

  const timeFee = await createFeeArrangement({
    userId: drafter.id,
    practiceId: alpha.id,
    engagementId: alphaClient.engagement.id,
    basis: "TIME_BASED",
    agreedRateAmount: 2500,
    agreedRateUnit: "hour",
    taxTreatment: "Taxable at 18% (fictional)",
    taxRatePercent: 18,
    effectiveFrom: d("2025-04-01"),
  });
  check("CONTROL — a time based fee WITH an agreed rate is accepted", !!timeFee.id);

  const unapproved = await throws(
    () => chargeableAmount({ practiceId: alpha.id, arrangementId: timeFee.id, units: 10 }),
    FeeError,
  );
  check(
    "FIN01: time cannot be priced against an unapproved arrangement",
    unapproved?.code === "RATE_NOT_APPROVED",
    unapproved?.code ?? "no error",
  );

  const approvedFee = await approveFeeArrangement({
    userId: approver.id,
    approverName: "Fictional Approver",
    practiceId: alpha.id,
    arrangementId: timeFee.id,
    expectedVersion: timeFee.version,
  });
  check("the approved arrangement freezes its particulars (DAT02)", !!approvedFee.approvedSnapshot);

  const staleApproval = await throws(
    () =>
      approveFeeArrangement({
        userId: approver.id,
        approverName: "Fictional Approver",
        practiceId: alpha.id,
        arrangementId: timeFee.id,
        expectedVersion: timeFee.version,
      }),
    FeeError,
  );
  check(
    "API02: approving the same arrangement version twice is refused",
    staleApproval !== null,
    staleApproval?.code ?? "no error",
  );

  const priced = await chargeableAmount({
    practiceId: alpha.id,
    arrangementId: timeFee.id,
    units: 10,
  });
  check(
    "CONTROL — 10 hours at the agreed 2500 prices at 25000",
    priced.amount === 25000 && priced.unit === "hour",
    `${priced.amount} per ${priced.unit}`,
  );

  // FIN01 scope change.
  const revision = await reviseFeeArrangement({
    userId: drafter.id,
    practiceId: alpha.id,
    arrangementId: timeFee.id,
    expectedVersion: approvedFee.version,
    changeReason: "Additional scope agreed (fictional)",
    agreedRateAmount: 3000,
    effectiveFrom: d("2025-10-01"),
  });
  const originalAfter = await prisma.feeArrangement.findUniqueOrThrow({
    where: { id: timeFee.id },
  });
  check(
    "FIN01: a scope change supersedes rather than edits",
    revision.parentArrangementId === timeFee.id && revision.revisionNumber === 1,
  );
  check(
    "FIN01: the ORIGINAL keeps the rate it was agreed at",
    Number(originalAfter.agreedRateAmount) === 2500 && originalAfter.status === "SUPERSEDED",
    `${originalAfter.agreedRateAmount} / ${originalAfter.status}`,
  );
  const current = await currentArrangementFor({
    practiceId: alpha.id,
    engagementId: alphaClient.engagement.id,
  });
  check(
    "the revision is what is now in force",
    current?.id === revision.id && Number(current?.agreedRateAmount) === 3000,
  );

  // Components.
  const milestone = await addFeeComponent({
    userId: drafter.id,
    practiceId: alpha.id,
    arrangementId: revision.id,
    kind: "MILESTONE",
    description: "Draft accounts delivered",
    amount: 5000,
  });
  await addFeeComponent({
    userId: drafter.id,
    practiceId: alpha.id,
    arrangementId: revision.id,
    kind: "ADVANCE",
    description: "Advance received on engagement",
    amount: 2000,
  });
  const beforeReached = await listBillableComponents({
    practiceId: alpha.id,
    arrangementId: revision.id,
  });
  check(
    "an unreached milestone is not yet billable",
    !beforeReached.some((c) => c.id === milestone.id),
  );
  check(
    "an ADVANCE is never a billable charge — it is money against future work",
    !beforeReached.some((c) => c.kind === "ADVANCE"),
  );
  await markMilestoneReached({
    userId: drafter.id,
    practiceId: alpha.id,
    componentId: milestone.id,
  });
  const afterReached = await listBillableComponents({
    practiceId: alpha.id,
    arrangementId: revision.id,
  });
  check(
    "CONTROL — once reached, the milestone IS billable",
    afterReached.some((c) => c.id === milestone.id),
  );

  // ============================================================ EVIDENCE 1
  console.log("\nEVIDENCE — identical numbers in separate practice series, no collision");

  const alphaSeries = await createInvoiceSeries({
    userId: drafter.id,
    practiceId: alpha.id,
    code: "INV",
    fiscalPeriod: "2025-26",
  });
  const betaSeries = await createInvoiceSeries({
    userId: drafter.id,
    practiceId: beta.id,
    // Deliberately the SAME code and period as Alpha's.
    code: "INV",
    fiscalPeriod: "2025-26",
  });

  async function issueOne(
    practiceId: string,
    seriesId: string,
    clientRelationshipId: string,
    engagementId: string,
    amount: number,
  ) {
    const draft = await draftInvoice({
      userId: drafter.id,
      practiceId,
      seriesId,
      clientRelationshipId,
      engagementId,
      lines: [{ description: "Professional fees (fictional)", quantity: 1, unitAmount: amount }],
    });
    const approved = await approveInvoice({
      userId: approver.id,
      approverName: "Fictional Approver",
      practiceId,
      invoiceId: draft.id,
      expectedVersion: draft.version,
    });
    return issueInvoice({
      userId: approver.id,
      practiceId,
      invoiceId: draft.id,
      expectedVersion: approved.version,
    });
  }

  const alphaInvoice = await issueOne(
    alpha.id,
    alphaSeries.id,
    alphaClient.rel.id,
    alphaClient.engagement.id,
    100000,
  );
  const betaInvoice = await issueOne(
    beta.id,
    betaSeries.id,
    betaClient.rel.id,
    betaClient.engagement.id,
    50000,
  );

  check(
    "EVIDENCE: both practices issued sequence number 1",
    alphaInvoice.sequenceNumber === 1 && betaInvoice.sequenceNumber === 1,
    `${alphaInvoice.sequenceNumber} / ${betaInvoice.sequenceNumber}`,
  );
  check(
    "EVIDENCE: they are different invoices, in different practices, with no collision",
    alphaInvoice.id !== betaInvoice.id && alphaInvoice.practiceId !== betaInvoice.practiceId,
  );
  check(
    "each carries its own rendered number",
    alphaInvoice.displayNumber === "INV/2025-26/1" &&
      betaInvoice.displayNumber === "INV/2025-26/1",
    `${alphaInvoice.displayNumber} / ${betaInvoice.displayNumber}`,
  );

  // CONTROL: within ONE series the number must advance, or the test above
  // would pass just as well with numbering switched off entirely.
  const alphaSecond = await issueOne(
    alpha.id,
    alphaSeries.id,
    alphaClient.rel.id,
    alphaClient.engagement.id,
    20000,
  );
  check(
    "CONTROL — the next invoice in the SAME series is number 2",
    alphaSecond.sequenceNumber === 2,
    String(alphaSecond.sequenceNumber),
  );

  // Concurrency: two issues racing must take two numbers, not one twice.
  const raceDrafts = await Promise.all(
    [1000, 2000].map((amount) =>
      draftInvoice({
        userId: drafter.id,
        practiceId: alpha.id,
        seriesId: alphaSeries.id,
        clientRelationshipId: alphaClient.rel.id,
        lines: [{ description: "Race (fictional)", quantity: 1, unitAmount: amount }],
      }),
    ),
  );
  const raceApproved = await Promise.all(
    raceDrafts.map((dr) =>
      approveInvoice({
        userId: approver.id,
        approverName: "Fictional Approver",
        practiceId: alpha.id,
        invoiceId: dr.id,
        expectedVersion: dr.version,
      }),
    ),
  );
  const raced = await Promise.all(
    raceApproved.map((inv) =>
      issueInvoice({
        userId: approver.id,
        practiceId: alpha.id,
        invoiceId: inv.id,
        expectedVersion: inv.version,
      }),
    ),
  );
  check(
    "two simultaneous issues take two DIFFERENT numbers",
    raced[0].sequenceNumber !== raced[1].sequenceNumber,
    `${raced[0].sequenceNumber} / ${raced[1].sequenceNumber}`,
  );

  // ============================================================ FIN02 lock
  console.log("\nFIN02 — issued particulars are locked");

  const editIssued = await throws(
    () =>
      reviseDraftInvoice({
        userId: drafter.id,
        practiceId: alpha.id,
        invoiceId: alphaInvoice.id,
        expectedVersion: alphaInvoice.version,
        lines: [{ description: "Changed", quantity: 1, unitAmount: 1 }],
      }),
    InvoiceError,
  );
  check(
    "FIN02: an issued invoice cannot be revised",
    editIssued?.code === "ISSUED_LOCKED",
    editIssued?.code ?? "no error",
  );

  check(
    "DAT02: the issued snapshot carries the client name as it stood at issue",
    JSON.stringify(alphaInvoice.issuedSnapshot).includes(tag("Fictional Client One Private Limited")),
  );

  // Renaming the client must not reach the issued invoice.
  await prisma.party.update({
    where: { id: alphaClient.party.id },
    data: { legalName: tag("Fictional Client One RENAMED") },
  });
  const afterRename = await prisma.invoice.findUniqueOrThrow({ where: { id: alphaInvoice.id } });
  check(
    "DAT02: renaming the client does not alter a previously issued invoice",
    JSON.stringify(afterRename.issuedSnapshot).includes(tag("Fictional Client One Private Limited")) &&
      !JSON.stringify(afterRename.issuedSnapshot).includes("RENAMED"),
  );

  const selfApprove = await throws(
    async () => {
      const dr = await draftInvoice({
        userId: drafter.id,
        practiceId: alpha.id,
        seriesId: alphaSeries.id,
        clientRelationshipId: alphaClient.rel.id,
        lines: [{ description: "Self approval (fictional)", quantity: 1, unitAmount: 900 }],
      });
      return approveInvoice({
        userId: drafter.id,
        approverName: "Fictional Drafter",
        practiceId: alpha.id,
        invoiceId: dr.id,
        expectedVersion: dr.version,
      });
    },
    SeparationOfDutiesError,
  );
  check(
    "IAM04: the person who drafted an invoice cannot approve it",
    selfApprove !== null,
    selfApprove ? "" : "no error",
  );

  const unapprovedIssue = await throws(
    async () => {
      const dr = await draftInvoice({
        userId: drafter.id,
        practiceId: alpha.id,
        seriesId: alphaSeries.id,
        clientRelationshipId: alphaClient.rel.id,
        lines: [{ description: "Unapproved (fictional)", quantity: 1, unitAmount: 500 }],
      });
      return issueInvoice({
        userId: approver.id,
        practiceId: alpha.id,
        invoiceId: dr.id,
        expectedVersion: dr.version,
      });
    },
    InvoiceError,
  );
  check(
    "FIN02: an unapproved invoice cannot be issued",
    unapprovedIssue?.code === "NOT_APPROVED",
    unapprovedIssue?.code ?? "no error",
  );

  // A genuinely stale issue: the invoice IS approved and issuable, but the
  // caller holds an out-of-date version. Pointing this at an already-issued
  // invoice would prove nothing — the status check would refuse it first.
  const staleDraft = await draftInvoice({
    userId: drafter.id,
    practiceId: alpha.id,
    seriesId: alphaSeries.id,
    clientRelationshipId: alphaClient.rel.id,
    lines: [{ description: "Stale issue (fictional)", quantity: 1, unitAmount: 700 }],
  });
  const staleApproved = await approveInvoice({
    userId: approver.id,
    approverName: "Fictional Approver",
    practiceId: alpha.id,
    invoiceId: staleDraft.id,
    expectedVersion: staleDraft.version,
  });
  const seriesBefore = await prisma.invoiceSeries.findUniqueOrThrow({
    where: { id: alphaSeries.id },
  });
  const staleIssue = await throws(
    () =>
      issueInvoice({
        userId: approver.id,
        practiceId: alpha.id,
        invoiceId: staleApproved.id,
        // The version BEFORE approval — what a screen loaded a moment too early
        // would still be holding.
        expectedVersion: staleDraft.version,
      }),
    InvoiceError,
  );
  const seriesAfter = await prisma.invoiceSeries.findUniqueOrThrow({
    where: { id: alphaSeries.id },
  });
  check(
    "a stale issue attempt is refused",
    staleIssue?.code === "VERSION_CONFLICT",
    staleIssue?.code ?? "no error",
  );
  check(
    "and it does NOT burn a sequence number, so the series has no unexplained gap",
    seriesBefore.nextNumber === seriesAfter.nextNumber,
    `${seriesBefore.nextNumber} -> ${seriesAfter.nextNumber}`,
  );

  // ============================================================ EVIDENCE 2
  console.log("\nEVIDENCE — part payment and TDS stay distinct");

  // A 100000 invoice settled as 90000 cash + 10000 TDS.
  const receipt = await recordReceipt({
    userId: drafter.id,
    practiceId: alpha.id,
    clientRelationshipId: alphaClient.rel.id,
    bankAccountId: alphaBank.id,
    amount: 90000,
    receivedAt: d("2025-07-01"),
    method: "NEFT",
    reference: "FICTIONAL-REF-1",
  });

  const noReceipt = await throws(
    () =>
      allocateReceipt({
        userId: drafter.id,
        practiceId: alpha.id,
        invoiceId: alphaInvoice.id,
        kind: "PAYMENT",
        amount: 60000,
      }),
    ReceiptError,
  );
  check(
    "FIN04: cash cannot be allocated without naming the receipt it came from",
    noReceipt?.code === "RECEIPT_REQUIRED",
    noReceipt?.code ?? "no error",
  );

  await allocateReceipt({
    userId: drafter.id,
    practiceId: alpha.id,
    invoiceId: alphaInvoice.id,
    kind: "PAYMENT",
    amount: 60000,
    receiptId: receipt.id,
  });

  const partial = await settlementOf({ practiceId: alpha.id, invoiceId: alphaInvoice.id });
  check(
    "a part payment leaves the invoice PART_PAID, not PAID",
    partial.status === "PART_PAID",
    partial.status,
  );

  await allocateReceipt({
    userId: drafter.id,
    practiceId: alpha.id,
    invoiceId: alphaInvoice.id,
    kind: "PAYMENT",
    amount: 30000,
    receiptId: receipt.id,
  });
  await allocateReceipt({
    userId: drafter.id,
    practiceId: alpha.id,
    invoiceId: alphaInvoice.id,
    kind: "TDS",
    amount: 10000,
  });

  const settled = await settlementOf({ practiceId: alpha.id, invoiceId: alphaInvoice.id });
  check(
    "EVIDENCE: cash received is reported as 90000",
    settled.cashReceived === "90000.00",
    settled.cashReceived,
  );
  check(
    "EVIDENCE: tax deducted is reported SEPARATELY as 10000",
    settled.taxDeducted === "10000.00",
    settled.taxDeducted,
  );
  check(
    "EVIDENCE: the balance is nil, and is not the same number as the cash",
    settled.balance === "0.00" && settled.cashReceived !== settled.invoiceTotal,
    `balance ${settled.balance}, cash ${settled.cashReceived}, total ${settled.invoiceTotal}`,
  );
  check(
    "EVIDENCE: the fully settled invoice is PAID",
    settled.status === "PAID",
    settled.status,
  );
  check(
    "CONTROL — cash and TDS are two rows, not one netted figure",
    (await listAllocations({ practiceId: alpha.id, invoiceId: alphaInvoice.id })).filter(
      (a) => a.reversedAt === null,
    ).length === 3,
  );

  const over = await throws(
    () =>
      allocateReceipt({
        userId: drafter.id,
        practiceId: alpha.id,
        invoiceId: alphaInvoice.id,
        kind: "TDS",
        amount: 1,
      }),
    ReceiptError,
  );
  check(
    "FIN04: over allocation is refused once the invoice is settled",
    over?.code === "INVOICE_OVER_ALLOCATED",
    over?.code ?? "no error",
  );

  // ============================================================ FIN04 detail
  console.log("\nFIN04 — bank account, isolation and reconciliation adjustments");

  const unverifiedBank = await prisma.practiceBankAccount.create({
    data: {
      practiceId: alpha.id,
      label: "Unverified account",
      bankName: "Fictional Bank",
      accountNumber: "1111111111",
      ifsc: "FAKE0000000",
      effectiveFrom: d("2024-04-01"),
    },
  });
  const unverified = await throws(
    () =>
      recordReceipt({
        userId: drafter.id,
        practiceId: alpha.id,
        clientRelationshipId: alphaClient.rel.id,
        bankAccountId: unverifiedBank.id,
        amount: 100,
        receivedAt: d("2025-07-01"),
        method: "NEFT",
      }),
    ReceiptError,
  );
  check(
    "ORG02: a receipt cannot be posted to an unverified bank account",
    unverified?.code === "BANK_ACCOUNT_UNVERIFIED",
    unverified?.code ?? "no error",
  );

  const foreignBank = await throws(
    () =>
      recordReceipt({
        userId: drafter.id,
        practiceId: beta.id,
        clientRelationshipId: betaClient.rel.id,
        // Alpha's account, used by Beta.
        bankAccountId: alphaBank.id,
        amount: 100,
        receivedAt: d("2025-07-01"),
        method: "NEFT",
      }),
    ReceiptError,
  );
  check(
    "ORG04: a receipt cannot be posted to another practice's bank account",
    foreignBank?.code === "BANK_ACCOUNT_NOT_FOUND",
    foreignBank?.code ?? "no error",
  );

  const crossClient = await throws(
    () =>
      allocateReceipt({
        userId: drafter.id,
        practiceId: alpha.id,
        // Beta's invoice, from Alpha's practice scope.
        invoiceId: betaInvoice.id,
        kind: "TDS",
        amount: 100,
      }),
    ReceiptError,
  );
  check(
    "ORG04: another practice's invoice cannot be allocated against",
    crossClient?.code === "INVOICE_NOT_FOUND",
    crossClient?.code ?? "no error",
  );

  // Reconciliation adjustment: reverse, don't delete.
  const adjustable = await issueOne(
    alpha.id,
    alphaSeries.id,
    alphaClient.rel.id,
    alphaClient.engagement.id,
    10000,
  );
  const wrong = await allocateReceipt({
    userId: drafter.id,
    practiceId: alpha.id,
    invoiceId: adjustable.id,
    kind: "WRITE_OFF",
    amount: 4000,
  });
  await reverseAllocation({
    userId: drafter.id,
    practiceId: alpha.id,
    allocationId: wrong.id,
    reason: "Posted to the wrong invoice (fictional)",
  });

  const afterReversal = await settlementOf({ practiceId: alpha.id, invoiceId: adjustable.id });
  const rows = await listAllocations({ practiceId: alpha.id, invoiceId: adjustable.id });
  check(
    "FIN04: a reversal returns the invoice to its unsettled balance",
    afterReversal.balance === "10000.00" && afterReversal.writtenOff === "0.00",
    `${afterReversal.balance} / ${afterReversal.writtenOff}`,
  );
  check(
    "FIN04: the wrong allocation is PRESERVED, not deleted, alongside its reversal",
    rows.length === 2 && rows.every((r) => r.reversedAt !== null),
    `${rows.length} rows`,
  );
  check(
    "the reversal names what it corrects and why",
    rows.some((r) => r.reversalOfId === wrong.id && !!r.reversalReason),
  );
  const doubleReverse = await throws(
    () =>
      reverseAllocation({
        userId: drafter.id,
        practiceId: alpha.id,
        allocationId: wrong.id,
        reason: "again",
      }),
    ReceiptError,
  );
  check(
    "an allocation cannot be reversed twice",
    doubleReverse?.code === "ALREADY_REVERSED",
    doubleReverse?.code ?? "no error",
  );

  // ============================================================ FIN02 credit note
  console.log("\nFIN02 — corrections use a reviewed credit note");

  const creditSeries = await createInvoiceSeries({
    userId: drafter.id,
    practiceId: alpha.id,
    code: "CN",
    fiscalPeriod: "2025-26",
    kind: "CREDIT_NOTE",
  });

  const wrongSeries = await throws(
    () =>
      draftCreditNote({
        userId: drafter.id,
        practiceId: alpha.id,
        invoiceId: adjustable.id,
        // The INVOICE series, not the credit note series.
        seriesId: alphaSeries.id,
        amount: 1000,
        reason: "Wrong series (fictional)",
      }),
    InvoiceError,
  );
  check(
    "FIN02: a credit note cannot take a number from the invoice series",
    wrongSeries?.code === "SERIES_NOT_FOUND",
    wrongSeries?.code ?? "no error",
  );

  const note = await draftCreditNote({
    userId: drafter.id,
    practiceId: alpha.id,
    invoiceId: adjustable.id,
    seriesId: creditSeries.id,
    amount: 10000,
    reason: "Fee reduced by agreement (fictional)",
  });

  const selfReview = await throws(
    () =>
      issueCreditNote({
        userId: drafter.id,
        reviewerName: "Fictional Drafter",
        practiceId: alpha.id,
        creditNoteId: note.id,
        expectedVersion: note.version,
      }),
    InvoiceError,
  );
  check(
    "FIN02: the person who raised a credit note cannot review it",
    selfReview?.code === "REVIEW_REQUIRED",
    selfReview?.code ?? "no error",
  );

  const issuedNote = await issueCreditNote({
    userId: approver.id,
    reviewerName: "Fictional Approver",
    practiceId: alpha.id,
    creditNoteId: note.id,
    expectedVersion: note.version,
  });
  check(
    "CONTROL — an independent reviewer CAN issue it, and it takes a CN number",
    issuedNote.displayNumber === "CN/2025-26/1",
    issuedNote.displayNumber ?? "none",
  );

  const credited = await settlementOf({ practiceId: alpha.id, invoiceId: adjustable.id });
  check(
    "the credit is reported separately from cash received",
    credited.creditedByNote === "10000.00" && credited.cashReceived === "0.00",
    `credited ${credited.creditedByNote}, cash ${credited.cashReceived}`,
  );
  check(
    "an invoice fully settled by a credit note is CREDITED, not PAID",
    credited.status === "CREDITED",
    credited.status,
  );

  const cancelSettled = await throws(
    () =>
      cancelInvoice({
        userId: approver.id,
        practiceId: alpha.id,
        invoiceId: adjustable.id,
        expectedVersion: 99,
        reason: "should not work",
      }),
    InvoiceError,
  );
  check(
    "FIN02: a settled invoice cannot be cancelled — the correction is the credit note",
    cancelSettled?.code === "ALREADY_SETTLED",
    cancelSettled?.code ?? "no error",
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
