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
 * Attaches to the practices created by seed-dev-user.ts. The core dataset
 * (clients, engagements, jobs, obligations, documents, one invoice) is
 * idempotent: it does nothing if its marker party already exists. The portal
 * invitation issued at the end is NOT idempotent on purpose — invitations are
 * single-use, so a fresh one is minted and printed every run, whether or not
 * the core dataset already existed.
 *
 * Run: npm run seed:demo
 */

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { issuePortalInvitation } from "../src/lib/portal-auth";

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

type Rel = { id: string; name: string; partyId: string; contactId: string };

/** Creates the full core dataset. Only called when the marker is absent. */
async function createCoreDemoData(
  practiceId: string,
  tenantId: string,
  userId: string,
  userFullName: string,
): Promise<{ relationships: Rel[]; engagements: { id: string }[] }> {
  // ---------------------------------------------------------------- clients
  const relationships: Rel[] = [];

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

    relationships.push({ id: relationship.id, name: spec.legalName, partyId: party.id, contactId: contact.id });
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
          ownerUserId: userId,
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
        ownerUserId: userId,
        reviewerUserId: userId,
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
    status: "OPEN" | "DUE_SOON" | "OVERDUE" | "REVIEW_REQUIRED" | "FILED";
    category: "COMPANY_PRIVATE" | "LLP" | "TRUST" | null;
    filedAt?: number;
  }[] = [
    { periodKey: "FY2025-26", due: 12, status: "DUE_SOON", category: "COMPANY_PRIVATE" },
    { periodKey: "FY2025-26", due: -6, status: "OVERDUE", category: "LLP" },
    // DUE04: an obligation whose taxpayer category is unknown stays visible in
    // REVIEW_REQUIRED rather than being given a date it cannot justify.
    { periodKey: "FY2025-26", due: 30, status: "REVIEW_REQUIRED", category: null },
    // REP01/on-time-filing-rate needs real FILED history to show a rate other
    // than "not available" — one filed on time, one filed late.
    { periodKey: "FY2024-25", due: -60, status: "FILED", category: "COMPANY_PRIVATE", filedAt: -63 },
    { periodKey: "FY2024-25", due: -90, status: "FILED", category: "LLP", filedAt: -80 },
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
        filedAt: spec.filedAt !== undefined ? dateOnly(spec.filedAt) : null,
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
        preparedByUserId: userId,
        approvedByUserId: i === 2 ? userId : null,
        approvedByUserName: i === 2 ? userFullName : null,
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
      verifiedBy: userFullName,
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
        createdByUserId: userId,
      },
      {
        practiceId,
        invoiceId: invoice.id,
        kind: "TDS",
        amount: "10000.00",
        createdByUserId: userId,
      },
    ],
  });

  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { status: "PART_PAID" },
  });

  // The marker, written last so a crash mid-seed does not look complete.
  await prisma.party.create({ data: { tenantId, legalName: MARKER, type: "COMPANY" } });

  return { relationships, engagements };
}

/** Looks up the core dataset created by a previous run, instead of recreating it. */
async function lookupCoreDemoData(practiceId: string, tenantId: string): Promise<{ relationships: Rel[] }> {
  const relationships: Rel[] = [];
  for (const spec of clientSpecs) {
    const party = await prisma.party.findFirstOrThrow({ where: { tenantId, legalName: spec.legalName } });
    const relationship = await prisma.clientRelationship.findFirstOrThrow({
      where: { practiceId, partyId: party.id },
    });
    const contact = await prisma.contact.findFirstOrThrow({ where: { partyId: party.id } });
    relationships.push({ id: relationship.id, name: spec.legalName, partyId: party.id, contactId: contact.id });
  }
  return { relationships };
}

/** POR05: one verified support route (shown), one unverified (withheld). Idempotent by label. */
async function ensureSupportContacts(practiceId: string, userFullName: string) {
  const already = await prisma.practiceSupportContact.findFirst({
    where: { practiceId, label: "Client support" },
  });
  if (already) return;

  await prisma.practiceSupportContact.create({
    data: {
      practiceId,
      label: "Unverified desk",
      phone: "+91 00000 00000",
      effectiveFrom: dateOnly(-400),
    },
  });
  await prisma.practiceSupportContact.create({
    data: {
      practiceId,
      label: "Client support",
      phone: "+91 11111 11111",
      email: "demo.support@example.invalid",
      hoursLabel: "Mon-Fri, 10am-6pm IST",
      verifiedAt: new Date(),
      verifiedBy: userFullName,
      effectiveFrom: dateOnly(-400),
    },
  });
}

/**
 * COM01/COM02 demo content: a thread with one internal note (never shown to
 * the client) and one client-visible message, plus an open client request with
 * one outstanding item — so /clients/[id] (Communication tab) and the portal
 * upload screen both have something real. Idempotent by thread subject.
 */
async function ensureCommunication(
  practiceId: string,
  relationship: Rel,
  userId: string,
  userFullName: string,
) {
  const subject = "Demo — GSTR-9 queries";
  const already = await prisma.messageThread.findFirst({ where: { practiceId, subject } });
  if (already) return;

  const engagement = await prisma.engagement.findFirstOrThrow({
    where: { practiceId, clientRelationshipId: relationship.id },
  });

  const thread = await prisma.messageThread.create({
    data: {
      practiceId,
      clientRelationshipId: relationship.id,
      engagementId: engagement.id,
      subject,
      visibility: "CLIENT_VISIBLE",
      createdByUserId: userId,
    },
  });

  await prisma.message.create({
    data: {
      practiceId,
      threadId: thread.id,
      direction: "INTERNAL_NOTE",
      channel: "NOTE",
      visibility: "INTERNAL",
      body: "Flagged for review before we ask the client — ITC mismatch on two invoices, checking with the reconciliation working paper first. (fictional)",
      authorUserId: userId,
      authorName: userFullName,
    },
  });

  await prisma.message.create({
    data: {
      practiceId,
      threadId: thread.id,
      direction: "OUTBOUND_TO_CLIENT",
      channel: "PORTAL",
      visibility: "CLIENT_VISIBLE",
      body: "Could you confirm the two supplier invoices listed in the attached working — we want to reconcile before filing GSTR-9. (fictional)",
      authorUserId: userId,
      authorName: userFullName,
    },
  });

  const request = await prisma.clientRequest.create({
    data: {
      practiceId,
      clientRelationshipId: relationship.id,
      engagementId: engagement.id,
      title: "Documents for GSTR-9",
      detail: "Please share the items below for the annual return. (fictional)",
      requestedItems: [],
      closeRule: "ON_ACCEPTANCE",
      state: "SENT",
      sentAt: new Date(),
      dueDate: dateOnly(20),
    },
  });

  await prisma.clientRequestItem.create({
    data: {
      practiceId,
      requestId: request.id,
      sequence: 1,
      documentType: "Purchase register",
      description: "Full year, all GSTINs. (fictional)",
      periodLabel: "FY2025-26",
      dueDate: dateOnly(20),
      ownerUserId: userId,
    },
  });
}

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

  const { relationships } = existing
    ? await lookupCoreDemoData(practiceId, tenantId)
    : await createCoreDemoData(practiceId, tenantId, user.id, user.fullName);

  if (existing) {
    console.log("\nCore demo data already present (clients, engagements, jobs, obligations,");
    console.log("documents, one invoice). Delete the marker party to reseed from scratch.\n");
  } else {
    console.log(`\nSeeded demo data into "${membership.practice.name}":`);
    console.log(`  ${relationships.length} clients, engagements, jobs, obligations, documents,`);
    console.log("  1 part-paid invoice (88000 cash + 10000 TDS against 118000).");
  }

  // These run every time, so a portal link is always available even after the
  // core dataset already existed from an earlier run.
  await ensureSupportContacts(practiceId, user.fullName);
  await ensureCommunication(practiceId, relationships[0], user.id, user.fullName);

  const invite = await issuePortalInvitation({
    practiceId,
    contactId: relationships[0].contactId,
    grants: [{ clientRelationshipId: relationships[0].id, authority: "UPLOAD" }],
    invitedByUserId: user.id,
    invitedByName: user.fullName,
  });

  console.log("\nAll fictional. Staff sign-in: http://localhost:3000/login");
  console.log(`Portal sign-in (single-use, fresh this run — re-run to get a new one):`);
  console.log(`  http://localhost:3000/portal/sign-in/${invite.token}\n`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
