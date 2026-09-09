/**
 * T03 acceptance test — ORG01-05 (PRD §7).
 *
 * PRD acceptance evidence, verbatim:
 *   "Create the same fictional client in both practices; verify different
 *    engagement letters, bank details and invoice series. An Associates only
 *    staff user must fail access through URL, API, search, export, email job,
 *    object link and AI retrieval for Company records."
 *
 * AI retrieval is R2 and not yet built; the other six paths are exercised
 * here as real HTTP requests against the running app, not by calling the
 * scope functions directly — an isolation test that never leaves the process
 * proves nothing about the routes users actually reach.
 *
 * All fixture data is fictional. No real BHV identifiers are used.
 *
 * Requires the app running on BASE_URL (default http://localhost:3000).
 * Run: npm run test:t03
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
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

/** Request as a specific user, via the T05-placeholder actor header. */
async function as(userId: string, path: string, init: RequestInit = {}) {
  return fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "x-bhv-user-id": userId,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

async function main() {
  console.log("\nT03 — practice hierarchy & isolation (PRD §7 ORG01-05)\n");

  // ---------------------------------------------------------------- fixtures
  const tenant = await prisma.tenant.create({ data: { name: tag("Tenant") } });

  const group = await prisma.practiceGroup.create({
    data: { tenantId: tenant.id, name: tag("Group") },
  });

  const company = await prisma.practice.create({
    data: {
      tenantId: tenant.id,
      practiceGroupId: group.id,
      name: tag("Fictional Company"),
      registeredDisplayName: "Fictional Company LLP",
      constitution: "LLP",
      documentNamespace: tag("co"),
      effectiveFrom: new Date("2024-04-01"),
    },
  });

  const associates = await prisma.practice.create({
    data: {
      tenantId: tenant.id,
      practiceGroupId: group.id,
      name: tag("Fictional Associates"),
      registeredDisplayName: "Fictional Associates",
      constitution: "PARTNERSHIP",
      documentNamespace: tag("as"),
      effectiveFrom: new Date("2024-04-01"),
    },
  });

  // ORG02: distinct bank details per practice (fictional values).
  await prisma.practiceBankAccount.create({
    data: {
      practiceId: company.id,
      label: "Primary",
      bankName: "Fictional Bank",
      accountNumber: "000011112222",
      ifsc: "FAKE0000001",
      effectiveFrom: new Date("2024-04-01"),
    },
  });
  await prisma.practiceBankAccount.create({
    data: {
      practiceId: associates.id,
      label: "Primary",
      bankName: "Fictional Bank",
      accountNumber: "999988887777",
      ifsc: "FAKE0000002",
      effectiveFrom: new Date("2024-04-01"),
    },
  });

  // ORG04: independent invoice series.
  const companySeries = await prisma.invoiceSeries.create({
    data: { practiceId: company.id, code: "CO", fiscalPeriod: "2025-26" },
  });
  const associatesSeries = await prisma.invoiceSeries.create({
    data: { practiceId: associates.id, code: "AS", fiscalPeriod: "2025-26" },
  });

  // The SAME fictional client, related to both practices.
  const party = await prisma.party.create({
    data: {
      tenantId: tenant.id,
      legalName: tag("Shared Client Textiles Private Limited"),
      type: "COMPANY",
    },
  });

  const companyRel = await prisma.clientRelationship.create({
    data: { practiceId: company.id, partyId: party.id, acceptanceStatus: "ACCEPTED" },
  });
  const associatesRel = await prisma.clientRelationship.create({
    data: { practiceId: associates.id, partyId: party.id, acceptanceStatus: "ACCEPTED" },
  });

  // ORG04: two separate engagement contracts, with different letter text.
  const companyEngagement = await prisma.engagement.create({
    data: {
      practiceId: company.id,
      clientRelationshipId: companyRel.id,
      serviceCode: "AUDIT",
      templateVersion: "letter-audit-v1",
      periodStart: new Date("2025-04-01"),
      periodEnd: new Date("2026-03-31"),
      state: "ACCEPTED",
      acceptedSnapshot: { letter: "Company audit engagement letter", bankLabel: "Primary" },
    },
  });
  const associatesEngagement = await prisma.engagement.create({
    data: {
      practiceId: associates.id,
      clientRelationshipId: associatesRel.id,
      serviceCode: "GST-RETAINER",
      templateVersion: "letter-gst-v1",
      periodStart: new Date("2025-04-01"),
      periodEnd: new Date("2026-03-31"),
      state: "ACCEPTED",
      acceptedSnapshot: { letter: "Associates GST retainer letter", bankLabel: "Primary" },
    },
  });

  const companyInvoice = await prisma.invoice.create({
    data: {
      practiceId: company.id,
      seriesId: companySeries.id,
      clientRelationshipId: companyRel.id,
      engagementId: companyEngagement.id,
      sequenceNumber: 1,
      status: "ISSUED",
      issuedAt: new Date(),
      total: "50000.00",
    },
  });
  await prisma.invoice.create({
    data: {
      practiceId: associates.id,
      seriesId: associatesSeries.id,
      clientRelationshipId: associatesRel.id,
      engagementId: associatesEngagement.id,
      sequenceNumber: 1,
      status: "ISSUED",
      issuedAt: new Date(),
      total: "20000.00",
    },
  });

  // A Company document version, used for the object-link path.
  const companyDoc = await prisma.document.create({
    data: { practiceId: company.id, title: "Company working paper", clientRelationshipId: companyRel.id },
  });
  const companyDocV1 = await prisma.documentVersion.create({
    data: {
      practiceId: company.id,
      documentId: companyDoc.id,
      versionNo: 1,
      storageObjectId: `${company.documentNamespace}/wp-1.pdf`,
      sha256: "a".repeat(64),
      mimeType: "application/pdf",
      sizeBytes: BigInt(1024),
      source: "STAFF_UPLOAD",
      scanVerdict: "CLEAN",
    },
  });

  // Two users: one in Associates ONLY, one in Company.
  const associatesUser = await prisma.user.create({
    data: {
      email: `associates-only-${RUN}@example.invalid`,
      fullName: "Associates Only Staff",
      status: "ACTIVE",
    },
  });
  const companyUser = await prisma.user.create({
    data: {
      email: `company-${RUN}@example.invalid`,
      fullName: "Company Staff",
      status: "ACTIVE",
    },
  });

  await prisma.practiceMembership.create({
    data: {
      practiceId: associates.id,
      userId: associatesUser.id,
      role: "REVIEWER",
      effectiveFrom: new Date("2024-04-01"),
    },
  });
  await prisma.practiceMembership.create({
    data: {
      practiceId: company.id,
      userId: companyUser.id,
      role: "MANAGER",
      effectiveFrom: new Date("2024-04-01"),
    },
  });

  // ------------------------------- ORG02/ORG04: same client, separate records
  console.log("Same fictional client in both practices — records stay separate");

  check(
    "one party, two distinct client relationships",
    companyRel.id !== associatesRel.id && companyRel.partyId === associatesRel.partyId,
  );
  check(
    "two distinct engagement letters",
    (companyEngagement.acceptedSnapshot as Record<string, unknown>).letter !==
      (associatesEngagement.acceptedSnapshot as Record<string, unknown>).letter,
  );

  const companyBank = await prisma.practiceBankAccount.findFirstOrThrow({
    where: { practiceId: company.id },
  });
  const associatesBank = await prisma.practiceBankAccount.findFirstOrThrow({
    where: { practiceId: associates.id },
  });
  check("different bank details per practice", companyBank.accountNumber !== associatesBank.accountNumber);
  check(
    "different invoice series per practice",
    companySeries.code !== associatesSeries.code && companySeries.id !== associatesSeries.id,
  );
  check(
    "independent document namespaces",
    company.documentNamespace !== associates.documentNamespace,
  );

  // --------------------------- The six access paths, as an Associates-only user
  console.log("\nAssociates-only user attempting to reach Company records");

  // Path 1 — URL
  const urlRes = await as(associatesUser.id, `/api/practices/${company.id}`);
  check("URL: GET /api/practices/{companyId} is refused", urlRes.status === 404, `got ${urlRes.status}`);

  // Path 2 — API
  const apiRes = await as(associatesUser.id, `/api/invoices?practiceId=${company.id}`);
  check("API: invoices?practiceId=company is refused", apiRes.status === 404, `got ${apiRes.status}`);

  // ...and the unfiltered call must not quietly include Company rows.
  const apiAllRes = await as(associatesUser.id, `/api/invoices`);
  const apiAll = await apiAllRes.json();
  const leakedInvoices = (apiAll.invoices ?? []).filter(
    (i: { practiceId: string }) => i.practiceId === company.id,
  );
  check(
    "API: unscoped invoice list contains no Company rows",
    apiAllRes.status === 200 && leakedInvoices.length === 0,
    `leaked ${leakedInvoices.length}`,
  );

  // Path 3 — search
  const searchRes = await as(
    associatesUser.id,
    `/api/search?q=${encodeURIComponent("Shared Client Textiles")}`,
  );
  const search = await searchRes.json();
  const leakedResults = (search.results ?? []).filter(
    (r: { practiceId: string }) => r.practiceId === company.id,
  );
  check(
    "search: the shared client is found, but only the Associates relationship",
    searchRes.status === 200 && search.results.length > 0 && leakedResults.length === 0,
    `${search.results?.length ?? 0} results, ${leakedResults.length} from Company`,
  );

  // Path 4 — export
  const exportRes = await as(associatesUser.id, `/api/exports/invoices`);
  const csv = await exportRes.text();
  check(
    "export: CSV contains no Company practice rows",
    exportRes.status === 200 && !csv.includes(company.name),
    exportRes.headers.get("x-bhv-export-scope") ?? "",
  );
  const exportScopedRes = await as(associatesUser.id, `/api/exports/invoices?practiceId=${company.id}`);
  check(
    "export: explicitly requesting the Company scope is refused",
    exportScopedRes.status === 404,
    `got ${exportScopedRes.status}`,
  );

  // Path 5 — email job
  const emailRes = await as(associatesUser.id, `/api/email-jobs`, {
    method: "POST",
    body: JSON.stringify({
      practiceId: company.id,
      invoiceId: companyInvoice.id,
      to: "someone@example.invalid",
    }),
  });
  check(
    "email job: sending a Company invoice is refused",
    emailRes.status === 404,
    `got ${emailRes.status}`,
  );

  // Path 6 — object link
  const linkRes = await as(associatesUser.id, `/api/documents/${companyDocV1.id}/link`);
  check(
    "object link: no signed link for a Company document",
    linkRes.status === 404,
    `got ${linkRes.status}`,
  );

  // ------------------------------------ the Company user must still be served
  console.log("\nControl — the Company user's own access still works");

  const okUrl = await as(companyUser.id, `/api/practices/${company.id}`);
  check("Company user reads their own practice", okUrl.status === 200, `got ${okUrl.status}`);

  const okLink = await as(companyUser.id, `/api/documents/${companyDocV1.id}/link`);
  const okLinkBody = await okLink.json();
  check(
    "Company user gets an object link for their own document",
    okLink.status === 200 && okLinkBody.via === "membership",
    `got ${okLink.status}`,
  );

  const okEmail = await as(companyUser.id, `/api/email-jobs`, {
    method: "POST",
    body: JSON.stringify({
      practiceId: company.id,
      invoiceId: companyInvoice.id,
      to: "client@example.invalid",
    }),
  });
  const okEmailBody = await okEmail.json();
  check(
    "email job records the sending practice identity (COM03)",
    okEmail.status === 202 && okEmailBody.sendAsPracticeId === company.id,
    `got ${okEmail.status}`,
  );

  // --------------------------------------------------- ORG05 explicit sharing
  console.log("\nORG05 — explicit, logged, expiring cross-practice grant");

  const shareRes = await as(companyUser.id, `/api/shares`, {
    method: "POST",
    body: JSON.stringify({
      sharingPracticeId: company.id,
      receivingPracticeId: associates.id,
      subjectType: "DOCUMENT_VERSION",
      subjectId: companyDocV1.id,
      purpose: "Joint review of shared client working paper",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    }),
  });
  check("a grant can be created by the owning practice", shareRes.status === 201, `got ${shareRes.status}`);
  const shareBody = await shareRes.json();

  const sharedLink = await as(associatesUser.id, `/api/documents/${companyDocV1.id}/link`);
  const sharedLinkBody = await sharedLink.json();
  check(
    "the granted document now resolves for the receiving practice",
    sharedLink.status === 200 && sharedLinkBody.via === "share",
    `got ${sharedLink.status}`,
  );

  // A NEW version must not inherit the grant.
  const companyDocV2 = await prisma.documentVersion.create({
    data: {
      practiceId: company.id,
      documentId: companyDoc.id,
      versionNo: 2,
      storageObjectId: `${company.documentNamespace}/wp-2.pdf`,
      sha256: "b".repeat(64),
      mimeType: "application/pdf",
      sizeBytes: BigInt(2048),
      source: "STAFF_UPLOAD",
      scanVerdict: "CLEAN",
    },
  });
  const v2Link = await as(associatesUser.id, `/api/documents/${companyDocV2.id}/link`);
  check(
    "a NEW version does not inherit the grant",
    v2Link.status === 404,
    `got ${v2Link.status}`,
  );

  // Revocation blocks future access.
  const revokeRes = await as(companyUser.id, `/api/shares?shareId=${shareBody.share.id}`, {
    method: "DELETE",
  });
  check("the grant can be revoked", revokeRes.status === 200, `got ${revokeRes.status}`);

  const afterRevoke = await as(associatesUser.id, `/api/documents/${companyDocV1.id}/link`);
  check(
    "access stops immediately after revocation",
    afterRevoke.status === 404,
    `got ${afterRevoke.status}`,
  );

  // ------------------------------------------------- unauthenticated fails shut
  console.log("\nDeny by default");

  const anon = await fetch(`${BASE_URL}/api/invoices`);
  check("no actor header ⇒ 401, never a default user", anon.status === 401, `got ${anon.status}`);

  const denials = await prisma.event.count({
    where: { actorUserId: associatesUser.id, action: { in: ["PRACTICE_ACCESS_DENIED", "OBJECT_LINK_DENIED"] } },
  });
  check("denials are written to the audit trail (SEC03)", denials > 0, `${denials} events`);

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
