/**
 * Dev-only demo data, so the interface can be walked through with something on
 * the screens instead of nine empty states.
 *
 * FICTIONAL DATA ONLY. Every name, PAN, GSTIN and email below is invented and
 * uses reserved example/invalid domains. PROGRESS.md's open questions are
 * explicit that no real BHV identifier, client name or bank detail goes into
 * this repo before onboarding confirms it — this file is not the place to
 * change that.
 *
 * Attaches to the practices created by seed-dev-user.ts, and is idempotent:
 * it does nothing if its marker party already exists.
 *
 * Run: npm run seed:demo
 */

import "dotenv/config";
import { prisma } from "../src/lib/prisma";

if (process.env.NODE_ENV === "production") {
  throw new Error("seed-demo-data is a local development helper and must not run in production.");
}

const EMAIL = process.env.SEED_EMAIL ?? "dev.owner@example.invalid";
const MARKER = "Demo data marker — Meridian Textiles Private Limited";

/** Dates relative to today, so the calendar and "overdue" states stay true. */
const day = 24 * 60 * 60 * 1000;
const dateOnly = (offsetDays: number) => {
  const d = new Date(Date.now() + offsetDays * day);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

async function main() {
  const user = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (!user) throw new Error(`No user ${EMAIL}. Run: npm run seed:dev-user first.`);

  const membership = await prisma.practiceMembership.findFirst({
    where: { userId: user.id, revokedAt: null },
    select: { practiceId: true, practice: { select: { tenantId: true, name: true } } },
    orderBy: { practice: { name: "asc" } },
  });
  if (!membership) throw new Error(`${EMAIL} has no live practice membership.`);

  const { practiceId } = membership;
  const { tenantId } = membership.practice;

  const existing = await prisma.party.findFirst({ where: { tenantId, legalName: MARKER } });
  if (existing) {
    console.log("\nDemo data already present. Delete the marker party to reseed.\n");
    return;
  }

  // ---------------------------------------------------------------- clients
  const clientSpecs = [
    {
      legalName: "Meridian Textiles Private Limited",
      type: "COMPANY" as const,
      pan: "AAACM1234F",
      gstin: "27AAACM1234F1ZP",
      stateCode: "27",
      contact: { fullName: "R. Deshpande", designation: "Finance Head" },
    },
    {
      legalName: "Kalindi Foods LLP",
      type: "LLP" as const,
      pan: "AABFK5678G",
      gstin: "24AABFK5678G1Z4",
      stateCode: "24",
      contact: { fullName: "S. Mehta", designation: "Designated Partner" },
    },
    {
      legalName: "Arunoday Charitable Trust",
      type: "TRUST" as const,
      pan: "AAATA9012H",
      gstin: null,
      stateCode: null,
      contact: { fullName: "P. Iyer", designation: "Trustee" },
    },
  ];

  const relationships: { id: string; name: string }[] = [];

  for (const spec of clientSpecs) {
    const party = await prisma.party.create({
      data: { tenantId, legalName: spec.legalName, type: spec.type },
    });

    await prisma.partyIdentifier.create({
      data: {
        partyId: party.id,
        kind: "PAN",
        value: spec.pan,
        // Format-checked is NOT verified — CLI02. Demo data must not pretend
        // an identifier was confirmed against a register when it was not.
        verificationStatus: "UNVERIFIED",
        effectiveFrom: dateOnly(-400),
      },
    });
    if (spec.gstin) {
      await prisma.partyIdentifier.create({
        data: {
          partyId: party.id,
          kind: "GSTIN",
          value: spec.gstin,
          stateCode: spec.stateCode,
          verificationStatus: "UNVERIFIED",
          effectiveFrom: dateOnly(-400),
        },
      });
    }

    const slug = spec.legalName.toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "");
    const contact = await prisma.contact.create({
      data: {
        partyId: party.id,
        fullName: spec.contact.fullName,
        designation: spec.contact.designation,
        email: `${spec.contact.fullName.toLowerCase().replace(/[^a-z]+/g, ".")}@${slug}.invalid`,
      },
    });

    const relationship = await prisma.clientRelationship.create({
      data: {
        practiceId,
        partyId: party.id,
        acceptanceStatus: "ACCEPTED",
        acceptedAt: dateOnly(-380),
      },
    });

    await prisma.contactAuthority.create({
      data: {
        practiceId,
        contactId: contact.id,
        clientRelationshipId: relationship.id,
        authority: "UPLOAD",
        effectiveFrom: dateOnly(-380),
      },
    });

    relationships.push({ id: relationship.id, name: spec.legalName });
  }

  // ------------------------------------------------------------ engagements
  const engagements = await Promise.all(
    relationships.map((r, i) =>
      prisma.engagement.create({
        data: {
          practiceId,
          clientRelationshipId: r.id,
          serviceCode: ["GST-ANNUAL", "TAX-AUDIT", "ACCOUNTS-COMPILATION"][i],
          templateVersion: "1",
          kind: i === 0 ? "ANNUAL_RETAINER" : "AD_HOC",
          periodStart: dateOnly(-350),
          periodEnd: dateOnly(15),
          scope: ["Annual GST return preparation and filing", "Statutory tax audit", "Annual accounts compilation"][i],
          exclusions: "Representation before authorities is not included unless separately engaged.",
          feeBasis: ["Fixed retainer, billed quarterly", "Fixed fee on completion", "Time basis"][i],
          state: "ACTIVE",
          ownerUserId: user.id,
          acceptedAt: dateOnly(-345),
        },
      }),
    ),
  );

  // -------------------------------------------------------------- jobs/work
  const jobSpecs: {
    title: string;
    state: "IN_PROGRESS" | "IN_REVIEW" | "WAITING_FOR_CLIENT" | "READY" | "COMPLETED";
    due: number;
    priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  }[] = [
    { title: "GSTR-9 preparation", state: "IN_PROGRESS", due: 12, priority: "NORMAL" },
    { title: "GSTR-9C reconciliation", state: "IN_REVIEW", due: 20, priority: "HIGH" },
    { title: "Tax audit — Form 3CD", state: "WAITING_FOR_CLIENT", due: -3, priority: "URGENT" },
    { title: "Annual accounts compilation", state: "READY", due: 40, priority: "NORMAL" },
    { title: "TDS return Q2", state: "COMPLETED", due: -45, priority: "NORMAL" },
  ];

  for (const [i, spec] of jobSpecs.entries()) {
    const engagement = engagements[i % engagements.length];
    await prisma.job.create({
      data: {
        practiceId,
        engagementId: engagement.id,
        title: spec.title,
        periodKey: "FY2025-26",
        dedupKey: `demo|${engagement.id}|${spec.title}|FY2025-26`,
        state: spec.state,
        priority: spec.priority,
        dueDate: dateOnly(spec.due),
        ownerUserId: user.id,
        reviewerUserId: user.id,
        completedAt: spec.state === "COMPLETED" ? dateOnly(-44) : null,
      },
    });
  }

  // ------------------------------------------------------------ obligations
  const rule = await prisma.obligationRule.upsert({
    where: { code_version: { code: "DEMO-GSTR9", version: 1 } },
    update: {},
    create: {
      code: "DEMO-GSTR9",
      version: 1,
      source: "Demo seed — not an authoritative rule",
      governingLaw: "CGST_ACT_2017",
      service: "GST annual return",
      applicability: {},
      status: "ACTIVE",
      effectiveFrom: dateOnly(-400),
    },
  });

  const obligationSpecs: {
    periodKey: string;
    due: number;
    status: "OPEN" | "DUE_SOON" | "OVERDUE" | "REVIEW_REQUIRED";
    category: "COMPANY_PRIVATE" | "LLP" | "TRUST" | null;
  }[] = [
    { periodKey: "FY2025-26", due: 12, status: "DUE_SOON", category: "COMPANY_PRIVATE" },
    { periodKey: "FY2025-26", due: -6, status: "OVERDUE", category: "LLP" },
    // DUE04: an obligation whose taxpayer category is unknown stays visible in
    // REVIEW_REQUIRED rather than being given a date it cannot justify.
    { periodKey: "FY2025-26", due: 30, status: "REVIEW_REQUIRED", category: null },
  ];

  for (const [i, spec] of obligationSpecs.entries()) {
    const relationship = relationships[i % relationships.length];
    await prisma.obligation.create({
      data: {
        practiceId,
        clientRelationshipId: relationship.id,
        engagementId: engagements[i % engagements.length].id,
        ruleId: rule.id,
        ruleVersion: rule.version,
        periodKey: spec.periodKey,
        originalStatutoryDate: dateOnly(spec.due),
        currentStatutoryDate: dateOnly(spec.due),
        internalTargetDate: dateOnly(spec.due - 7),
        clientDocumentCutoff: dateOnly(spec.due - 14),
        governingLaw: "CGST_ACT_2017",
        taxpayerCategory: spec.category,
        status: spec.status,
      },
    });
  }

  // -------------------------------------------------------------- documents
  const documentSpecs: {
    title: string;
    kind: "CLIENT_SUPPLIED" | "INTERNAL" | "APPROVED_DELIVERABLE";
    workingPaper: boolean;
    documentType: string;
  }[] = [
    { title: "Trial balance FY2025-26", kind: "CLIENT_SUPPLIED", workingPaper: false, documentType: "Trial balance" },
    { title: "GST reconciliation working", kind: "INTERNAL", workingPaper: true, documentType: "Working paper" },
    { title: "Signed audit report FY2024-25", kind: "APPROVED_DELIVERABLE", workingPaper: false, documentType: "Report" },
  ];

  for (const [i, spec] of documentSpecs.entries()) {
    const relationship = relationships[i % relationships.length];
    const document = await prisma.document.create({
      data: {
        practiceId,
        clientRelationshipId: relationship.id,
        engagementId: engagements[i % engagements.length].id,
        title: spec.title,
        kind: spec.kind,
        workingPaper: spec.workingPaper,
        documentType: spec.documentType,
        periodLabel: "FY2025-26",
      },
    });

    /**
     * No bytes are written to the object store here, so the version records a
     * placeholder digest and stays PENDING scan. That is deliberate: a demo
     * row must not claim CLEAN, because a clean verdict is a statement about
     * content that was actually scanned (DOC01, and the fail-closed rule in
     * document-intake.ts). Upload through the real route to exercise storage.
     */
    await prisma.documentVersion.create({
      data: {
        practiceId,
        documentId: document.id,
        versionNo: 1,
        storageObjectId: `demo-placeholder/${document.id}`,
        sha256: "0".repeat(64),
        mimeType: "application/pdf",
        sizeBytes: BigInt(0),
        source: "STAFF_UPLOAD",
        scanVerdict: "PENDING",
        filename: `${spec.title}.pdf`,
        status: i === 2 ? "APPROVED" : "DRAFT",
        preparedByUserId: user.id,
        approvedByUserId: i === 2 ? user.id : null,
        approvedByUserName: i === 2 ? user.fullName : null,
        approvedAt: i === 2 ? dateOnly(-30) : null,
      },
    });
  }

  // T14 billing (FIN01/FIN02/FIN04). One issued invoice, part settled by cash
  // and TDS, so /billing and /billing/[id] have something real to render and
  // the settlement table shows the distinction FIN04 turns on rather than a
  // row of zeroes. Written directly rather than through the libraries because
  // this is a seed, not a workflow: the libraries enforce separation of duties,
  // which one seeded user cannot satisfy on their own.
  const bankAccount = await prisma.practiceBankAccount.create({
    data: {
      practiceId,
      label: "Demo current account",
      bankName: "Fictional Bank",
      accountNumber: "0000000000",
      ifsc: "FAKE0000000",
      effectiveFrom: dateOnly(-400),
      verifiedAt: new Date(),
      verifiedBy: user.fullName,
    },
  });

  const series = await prisma.invoiceSeries.create({
    data: {
      practiceId,
      kind: "INVOICE",
      code: "INV",
      fiscalPeriod: "2025-26",
      numberFormat: "{code}/{fiscalPeriod}/{number}",
      nextNumber: 2,
    },
  });

  const invoice = await prisma.invoice.create({
    data: {
      practiceId,
      seriesId: series.id,
      clientRelationshipId: relationships[0].id,
      engagementId: engagements[0].id,
      sequenceNumber: 1,
      displayNumber: "INV/2025-26/1",
      currency: "INR",
      status: "ISSUED",
      issueDate: dateOnly(-40),
      dueDate: dateOnly(-10),
      subtotal: "100000.00",
      taxTotal: "18000.00",
      total: "118000.00",
      issuedAt: new Date(),
      issuedSnapshot: {
        number: "INV/2025-26/1",
        client: { legalName: relationships[0].name },
        total: "118000.00",
      } as never,
    },
  });

  await prisma.invoiceLine.create({
    data: {
      practiceId,
      invoiceId: invoice.id,
      description: "Annual GST return preparation and filing (fictional)",
      quantity: "1.0000",
      unitAmount: "100000.00",
      taxRatePercent: "18.00",
      lineTotal: "100000.00",
      sortOrder: 0,
    },
  });

  const receipt = await prisma.receipt.create({
    data: {
      practiceId,
      clientRelationshipId: relationships[0].id,
      bankAccountId: bankAccount.id,
      amount: "88000.00",
      currency: "INR",
      receivedAt: dateOnly(-5),
      method: "NEFT",
      reference: "DEMO-NEFT-0001",
    },
  });

  await prisma.receiptAllocation.createMany({
    data: [
      {
        practiceId,
        receiptId: receipt.id,
        invoiceId: invoice.id,
        kind: "PAYMENT",
        amount: "88000.00",
        createdByUserId: user.id,
      },
      {
        practiceId,
        invoiceId: invoice.id,
        kind: "TDS",
        amount: "10000.00",
        createdByUserId: user.id,
      },
    ],
  });

  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { status: "PART_PAID" },
  });

  // The marker, written last so a crash mid-seed does not look complete.
  await prisma.party.create({ data: { tenantId, legalName: MARKER, type: "COMPANY" } });

  console.log(`\nSeeded demo data into "${membership.practice.name}":`);
  console.log(`  ${relationships.length} clients, ${engagements.length} engagements, ${jobSpecs.length} jobs,`);
  console.log(`  ${obligationSpecs.length} obligations, ${documentSpecs.length} documents,`);
  console.log("  1 part-paid invoice (88000 cash + 10000 TDS against 118000).");
  console.log("  All fictional. Sign in at http://localhost:3000/login\n");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
