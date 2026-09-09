/**
 * T02 acceptance test — DAT01-03 (PRD §33).
 *
 * Runs against the live dev database and exercises the PRD's own acceptance
 * evidence verbatim:
 *
 *   1. "A Company invoice cannot reference an Associates engagement."
 *   2. "Changing a contact name does not alter the previously issued invoice."
 *   3. "A deleted user remains identifiable in historical approvals without
 *       retaining unnecessary account secrets."
 *
 * All fixture data is fictional. No real BHV identifiers are used, per the
 * hard constraint in PROGRESS.md.
 *
 * Run: npm run test:t02
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

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

const RUN = Date.now();
const tag = (s: string) => `${s}-${RUN}`;

async function main() {
  console.log("\nT02 — core data model acceptance test (PRD §33 DAT01-03)\n");

  // ---------------------------------------------------------------- fixtures
  const tenant = await prisma.tenant.create({
    data: { name: tag("Fictional Tenant") },
  });

  // Two sibling practices, exactly the isolation boundary the PRD cares about.
  const company = await prisma.practice.create({
    data: {
      tenantId: tenant.id,
      name: tag("Fictional Company"),
      constitution: "LLP",
      documentNamespace: tag("fictional-company"),
      effectiveFrom: new Date("2024-04-01"),
    },
  });

  const associates = await prisma.practice.create({
    data: {
      tenantId: tenant.id,
      name: tag("Fictional Associates"),
      constitution: "PARTNERSHIP",
      documentNamespace: tag("fictional-associates"),
      effectiveFrom: new Date("2024-04-01"),
    },
  });

  // One legal person, related to BOTH practices — the realistic trap.
  const party = await prisma.party.create({
    data: {
      tenantId: tenant.id,
      legalName: "Nirvana Textiles Private Limited",
      type: "COMPANY",
    },
  });

  const companyRel = await prisma.clientRelationship.create({
    data: {
      practiceId: company.id,
      partyId: party.id,
      acceptanceStatus: "ACCEPTED",
      acceptedAt: new Date(),
    },
  });

  const associatesRel = await prisma.clientRelationship.create({
    data: {
      practiceId: associates.id,
      partyId: party.id,
      acceptanceStatus: "ACCEPTED",
      acceptedAt: new Date(),
    },
  });

  const associatesEngagement = await prisma.engagement.create({
    data: {
      practiceId: associates.id,
      clientRelationshipId: associatesRel.id,
      serviceCode: "GST-RETAINER",
      templateVersion: "v1",
      periodStart: new Date("2025-04-01"),
      periodEnd: new Date("2026-03-31"),
      state: "ACTIVE",
    },
  });

  const companySeries = await prisma.invoiceSeries.create({
    data: {
      practiceId: company.id,
      code: "CO",
      fiscalPeriod: "2025-26",
    },
  });

  const associatesSeries = await prisma.invoiceSeries.create({
    data: {
      practiceId: associates.id,
      code: "AS",
      fiscalPeriod: "2025-26",
    },
  });

  // ------------------------------------------------- EVIDENCE 1: cross-scope
  console.log("Evidence 1 — a Company invoice cannot reference an Associates engagement");

  let crossScopeRejected = false;
  let rejectionReason = "";
  let rejectionCode = "";
  try {
    await prisma.invoice.create({
      data: {
        practiceId: company.id, // Company...
        seriesId: companySeries.id,
        clientRelationshipId: companyRel.id,
        engagementId: associatesEngagement.id, // ...pointing at Associates work
        sequenceNumber: 1,
      },
    });
  } catch (e) {
    crossScopeRejected = true;
    const err = e as { code?: string; message?: string; meta?: unknown };
    rejectionCode = err.code ?? "";
    rejectionReason =
      (err.message ?? "").split("\n").filter(Boolean).slice(-1)[0] ??
      JSON.stringify(err.meta ?? {});
  }
  check(
    "database refuses a cross-practice invoice→engagement reference",
    crossScopeRejected,
    crossScopeRejected ? "" : "the invoice was created — isolation is NOT enforced",
  );
  // A pass for the wrong reason is worthless: assert it failed on the
  // composite foreign key (P2003), not on some unrelated error.
  check(
    "rejection is a foreign-key violation (P2003), not an incidental error",
    rejectionCode === "P2003",
    `got code "${rejectionCode}": ${rejectionReason}`,
  );

  // The same reference is fine within one practice — proving the constraint
  // rejects cross-scope specifically, rather than blocking everything.
  const associatesInvoice = await prisma.invoice.create({
    data: {
      practiceId: associates.id,
      seriesId: associatesSeries.id,
      clientRelationshipId: associatesRel.id,
      engagementId: associatesEngagement.id,
      sequenceNumber: 1,
    },
  });
  check("same-practice invoice→engagement reference is accepted", !!associatesInvoice.id);

  // FIN02 sanity: both practices can hold sequence number 1 without collision.
  const companyInvoiceSameNumber = await prisma.invoice.create({
    data: {
      practiceId: company.id,
      seriesId: companySeries.id,
      clientRelationshipId: companyRel.id,
      sequenceNumber: 1,
    },
  });
  check(
    "both practices can issue sequence number 1 in their own series",
    companyInvoiceSameNumber.sequenceNumber === 1 && associatesInvoice.sequenceNumber === 1,
  );

  // ---------------------------------------------------- EVIDENCE 2: snapshot
  console.log("\nEvidence 2 — changing a contact name does not alter an issued invoice");

  const contact = await prisma.contact.create({
    data: {
      partyId: party.id,
      fullName: "Original Contact Name",
      email: "contact@example.invalid",
    },
  });

  await prisma.contactAuthority.create({
    data: {
      practiceId: company.id,
      contactId: contact.id,
      clientRelationshipId: companyRel.id,
      authority: "APPROVE",
      effectiveFrom: new Date(),
    },
  });

  // Issue the invoice: freeze the particulars as they stand right now.
  const issued = await prisma.invoice.update({
    where: { id: companyInvoiceSameNumber.id },
    data: {
      status: "ISSUED",
      issuedAt: new Date(),
      subtotal: "10000.00",
      taxTotal: "1800.00",
      total: "11800.00",
      version: { increment: 1 },
      issuedSnapshot: {
        clientLegalName: party.legalName,
        contactName: contact.fullName,
        contactEmail: contact.email,
        currency: "INR",
        total: "11800.00",
      },
    },
  });

  const snapshotAtIssue = issued.issuedSnapshot as Record<string, unknown>;
  check(
    "issued invoice captured the contact name at issue time",
    snapshotAtIssue.contactName === "Original Contact Name",
  );

  // Now rename the contact — current master data changes.
  await prisma.contact.update({
    where: { id: contact.id },
    data: { fullName: "Renamed Contact" },
  });

  const contactAfter = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
  const invoiceAfter = await prisma.invoice.findUniqueOrThrow({ where: { id: issued.id } });
  const snapshotAfter = invoiceAfter.issuedSnapshot as Record<string, unknown>;

  check("current contact record reflects the new name", contactAfter.fullName === "Renamed Contact");
  check(
    "issued invoice snapshot still shows the ORIGINAL name",
    snapshotAfter.contactName === "Original Contact Name",
    `snapshot now reads "${String(snapshotAfter.contactName)}"`,
  );
  check(
    "issued invoice money particulars unchanged",
    invoiceAfter.total.toString() === "11800" || invoiceAfter.total.toString() === "11800.00",
    `total is ${invoiceAfter.total.toString()}`,
  );

  // DAT01: money kept fixed precision, not float.
  check(
    "money is fixed-precision decimal, not float",
    typeof invoiceAfter.total === "object" && invoiceAfter.total !== null,
    `got ${typeof invoiceAfter.total}`,
  );

  // ------------------------------------------------- EVIDENCE 3: dead actors
  console.log("\nEvidence 3 — a deactivated user stays identifiable in historical approvals");

  const approver = await prisma.user.create({
    data: {
      email: `approver-${RUN}@example.invalid`,
      fullName: "Fictional Approver",
      status: "ACTIVE",
    },
  });

  await prisma.approval.create({
    data: {
      practiceId: company.id,
      subjectType: "INVOICE",
      subjectId: issued.id,
      subjectVersion: issued.version,
      actorUserId: approver.id,
      actorDisplayName: approver.fullName,
      authority: "PARTNER",
      decision: "APPROVED",
    },
  });

  // Ordinary removal is deactivation, never a hard delete (DAT03).
  await prisma.user.update({
    where: { id: approver.id },
    data: { status: "DEACTIVATED", deactivatedAt: new Date() },
  });

  const historicalApproval = await prisma.approval.findFirstOrThrow({
    where: { subjectId: issued.id },
  });

  check(
    "approval still names the actor after deactivation",
    historicalApproval.actorDisplayName === "Fictional Approver",
  );
  check(
    "approval records the exact subject version approved",
    historicalApproval.subjectVersion === issued.version,
  );
  // "without retaining unnecessary account SECRETS" — the target is secret
  // material (password hashes, TOTP seeds, recovery codes, session tokens),
  // not lifecycle metadata. `mfaEnrolledAt` is a timestamp that IAM05
  // explicitly requires ("record acceptance and MFA"), so it is allowed here.
  const secretish = Object.keys(approver).filter((k) =>
    /password|passphrase|secret|privatekey|recoverycode|apikey|totp|sessiontoken|hash/i.test(k),
  );
  check(
    "User model carries no password/secret material",
    secretish.length === 0,
    `found: ${secretish.join(", ")}`,
  );

  // ------------------------------------------------------------ DAT03 checks
  console.log("\nDAT03 — reversible administration");

  await prisma.clientRelationship.update({
    where: { id: companyRel.id },
    data: { archivedAt: new Date() },
  });
  const archived = await prisma.clientRelationship.findUniqueOrThrow({
    where: { id: companyRel.id },
  });
  check("archiving is reversible: row still present with archivedAt set", archived.archivedAt !== null);

  // ------------------------------------------------------------------ report
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
