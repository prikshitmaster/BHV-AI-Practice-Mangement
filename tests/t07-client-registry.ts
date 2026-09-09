/**
 * T07 acceptance test — CLI01-04, CLI06 (PRD §11). CLI05 is R1.
 *
 * PRD acceptance evidence, verbatim:
 *   "Onboard a fictional company with two GST registrations, a director
 *    contact and engagements in both practices. Reject an unauthorised email
 *    change; retain source evidence; expose no other client data through
 *    autocomplete or duplicate detection."
 *
 * All fixture data is fictional. Identifier values below are deliberately
 * well-formed but invented — they belong to no real entity.
 *
 * Run: npm run test:t07
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  AcceptanceRequiredError,
  assertAcceptanceComplete,
  checkForDuplicates,
  createClient,
  formatCheck,
  missingFieldsFor,
  requiredFieldsForService,
  screenForConflicts,
} from "../src/lib/client-registry";
import {
  UnauthorisedContactChangeError,
  approveContactChange,
  requestContactChange,
} from "../src/lib/contact-authority";

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

async function as(userId: string, path: string, init: RequestInit = {}) {
  return fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { "x-bhv-user-id": userId, "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

async function main() {
  console.log("\nT07 — client registry (PRD §11 CLI01-04, CLI06)\n");

  const tenant = await prisma.tenant.create({ data: { name: tag("T") } });
  const company = await prisma.practice.create({
    data: {
      tenantId: tenant.id, name: tag("Company"), constitution: "LLP",
      documentNamespace: tag("co"), effectiveFrom: new Date("2024-04-01"),
    },
  });
  const associates = await prisma.practice.create({
    data: {
      tenantId: tenant.id, name: tag("Associates"), constitution: "PARTNERSHIP",
      documentNamespace: tag("as"), effectiveFrom: new Date("2024-04-01"),
    },
  });

  const partner = await prisma.user.create({
    data: { email: `partner-${RUN}@example.invalid`, fullName: "Fictional Partner", status: "ACTIVE" },
  });
  const companyStaff = await prisma.user.create({
    data: { email: `costaff-${RUN}@example.invalid`, fullName: "Company Staff", status: "ACTIVE" },
  });
  const assocStaff = await prisma.user.create({
    data: { email: `asstaff-${RUN}@example.invalid`, fullName: "Associates Staff", status: "ACTIVE" },
  });
  const article = await prisma.user.create({
    data: { email: `article-${RUN}@example.invalid`, fullName: "Fictional Article", status: "ACTIVE" },
  });

  await prisma.practiceMembership.createMany({
    data: [
      { practiceId: company.id, userId: partner.id, role: "PRACTICE_PARTNER", assignmentScope: "PRACTICE", effectiveFrom: new Date("2024-04-01") },
      { practiceId: associates.id, userId: partner.id, role: "PRACTICE_PARTNER", assignmentScope: "PRACTICE", effectiveFrom: new Date("2024-04-01") },
      { practiceId: company.id, userId: companyStaff.id, role: "MANAGER", assignmentScope: "PRACTICE", effectiveFrom: new Date("2024-04-01") },
      { practiceId: associates.id, userId: assocStaff.id, role: "MANAGER", assignmentScope: "PRACTICE", effectiveFrom: new Date("2024-04-01") },
      { practiceId: company.id, userId: article.id, role: "STAFF_ARTICLE", assignmentScope: "OWN_WORK", effectiveFrom: new Date("2024-04-01") },
    ],
  });

  // ------------------------- CLI03: only the fields the service actually needs
  console.log("CLI03 — guided intake asks only for what the service needs");

  check(
    "an accounting engagement does not demand a GSTIN",
    !requiredFieldsForService("ACCOUNTING").includes("GSTIN"),
    requiredFieldsForService("ACCOUNTING").join(", "),
  );
  check("a GST engagement does", requiredFieldsForService("GST").includes("GSTIN"));
  check(
    "no service demands Aadhaar just because the form has the field",
    !Object.values(["GST", "AUDIT", "ITR", "TDS", "ACCOUNTING"])
      .flatMap(requiredFieldsForService)
      .some((f) => /aadhaar/i.test(f)),
  );

  const missing = missingFieldsFor("GST", { legalName: "X", type: "COMPANY" });
  check("an incomplete draft reports exactly what is missing", missing.includes("GSTIN") && missing.includes("PAN"));

  const draft = await prisma.intakeDraft.create({
    data: {
      practiceId: company.id, serviceCode: "GST",
      payload: { legalName: "Partially Entered Ltd" },
      missingFields: missing, createdByUserId: companyStaff.id,
    },
  });
  check("an incomplete draft can be saved and resumed", draft.submittedAt === null);

  // CLI03: format validation is not verification.
  check("a well-formed PAN is only FORMAT_CHECKED, never VERIFIED", formatCheck("PAN", "AAAPZ1234C") === "FORMAT_CHECKED");
  check("a malformed PAN fails the format check", formatCheck("PAN", "NOTAPAN") === "FAILED_VERIFICATION");
  check("a well-formed GSTIN is only FORMAT_CHECKED", formatCheck("GSTIN", "27AAAPZ1234C1ZV") === "FORMAT_CHECKED");

  // ------------------ ACCEPTANCE EVIDENCE 1: the fictional company onboarding
  console.log("\nEvidence 1 — one company, TWO GST registrations, a director contact, BOTH practices");

  const created = await createClient({
    userId: companyStaff.id,
    tenantId: tenant.id,
    practiceId: company.id,
    legalName: tag("Nirvana Textiles Private Limited"),
    type: "COMPANY",
    identifiers: [
      { kind: "PAN", value: "AAAPZ1234C", source: "CLIENT_DECLARATION", sourceEvidence: "PAN card copy ref FICTIONAL-1" },
      { kind: "GSTIN", value: "27AAAPZ1234C1ZV", stateCode: "27", label: "Maharashtra", source: "CLIENT_DECLARATION" },
      { kind: "GSTIN", value: "24AAAPZ1234C1ZP", stateCode: "24", label: "Gujarat", source: "BULK_IMPORT" },
    ],
    contacts: [
      { fullName: "Fictional Director", email: "director@example.invalid", designation: "Director", source: "CLIENT_DECLARATION" },
    ],
  });

  const gstins = created.party.identifiers.filter((i) => i.kind === "GSTIN");
  check("the company holds TWO GST registrations", gstins.length === 2, `${gstins.length}`);
  check(
    "the two registrations are in different states, on ONE party",
    new Set(gstins.map((g) => g.stateCode)).size === 2,
  );
  check("a director contact is recorded", created.party.contacts.some((c) => c.designation === "Director"));

  // CLI03: imported values stay unverified.
  const imported = gstins.find((g) => g.source === "BULK_IMPORT");
  check("an IMPORTED GSTIN is not treated as verified", imported?.verificationStatus !== "VERIFIED", imported?.verificationStatus);
  const director = created.party.contacts[0];
  check("an imported email is not treated as verified", director.emailVerificationStatus === "UNVERIFIED");
  const panRow = created.party.identifiers.find((i) => i.kind === "PAN");
  check("source evidence is retained against the identifier", (panRow?.sourceEvidence ?? "").length > 0);

  // The same party, engaged by the OTHER practice too.
  const assocRelationship = await prisma.clientRelationship.create({
    data: { practiceId: associates.id, partyId: created.party.id, acceptanceStatus: "PROSPECT" },
  });

  // ------------------------------------------------- CLI04: acceptance gate
  console.log("\nCLI04 — acceptance and conflict check before engagement");

  const notYet = await throws(
    () => assertAcceptanceComplete(created.relationship.id),
    AcceptanceRequiredError,
  );
  check("a client cannot be engaged before an acceptance check exists", notYet !== null);

  const screen = await screenForConflicts({
    tenantId: tenant.id,
    partyId: created.party.id,
    requestingPracticeId: company.id,
  });
  check(
    "conflict screening sees the relationship in the other practice",
    screen.existingRelationshipsElsewhereInFirm === 1,
    JSON.stringify(screen),
  );
  check("screening flags that master-data review is needed", screen.requiresMasterDataReview);
  const screenText = JSON.stringify(screen);
  check(
    "the screening summary names NO other practice and NO client",
    !screenText.includes(associates.id) && !screenText.includes(associates.name),
    screenText,
  );

  const acceptance = await prisma.acceptanceCheck.create({
    data: {
      practiceId: company.id,
      clientRelationshipId: created.relationship.id,
      scope: "Statutory audit FY2025-26",
      competenceAssessment: "Team has listed-company audit experience",
      resourcesAssessment: "Two seniors available in Q1",
      ethicalThreats: "None identified",
      independenceAssessment: "No financial interest held",
      predecessorCommunication: "Predecessor auditor contacted, no objection",
      clientAuthority: "Board resolution dated 2025-05-01 (fictional)",
      conflictSummary: screen as never,
      decision: "PENDING",
    },
  });

  const stillPending = await throws(
    () => assertAcceptanceComplete(created.relationship.id),
    AcceptanceRequiredError,
  );
  check("a PENDING acceptance is not enough to engage", stillPending !== null);

  await prisma.acceptanceCheck.update({
    where: { id: acceptance.id },
    data: {
      decision: "ACCEPTED", partnerUserId: partner.id,
      partnerName: "Fictional Partner", decidedAt: new Date(),
    },
  });

  let engageable = true;
  try {
    await assertAcceptanceComplete(created.relationship.id);
  } catch {
    engageable = false;
  }
  check("after a named partner accepts, the client can be engaged", engageable);

  // Engagements in BOTH practices, with different scopes.
  const companyEngagement = await prisma.engagement.create({
    data: {
      practiceId: company.id, clientRelationshipId: created.relationship.id,
      serviceCode: "AUDIT", templateVersion: "v1",
      periodStart: new Date("2025-04-01"), periodEnd: new Date("2026-03-31"),
      state: "ACTIVE",
    },
  });
  const assocEngagement = await prisma.engagement.create({
    data: {
      practiceId: associates.id, clientRelationshipId: assocRelationship.id,
      serviceCode: "GST", templateVersion: "v1",
      periodStart: new Date("2025-04-01"), periodEnd: new Date("2026-03-31"),
      state: "ACTIVE",
    },
  });
  check(
    "the same company has engagements in BOTH practices",
    companyEngagement.practiceId === company.id && assocEngagement.practiceId === associates.id,
  );
  check(
    "each engagement belongs to its own practice's relationship",
    companyEngagement.clientRelationshipId !== assocEngagement.clientRelationshipId,
  );

  // ------------------- ACCEPTANCE EVIDENCE 2: unauthorised email change
  console.log("\nEvidence 2 — an unauthorised email change is rejected, evidence retained");

  const attackerEmail = "attacker@example.invalid";
  const unauthorised = await throws(
    () =>
      requestContactChange({
        practiceId: company.id,
        contactId: director.id,
        field: "email",
        newValue: attackerEmail,
        // The request "comes from the client" — which is not authority.
        requester: { kind: "CONTACT", contactId: director.id, name: "Fictional Director" },
        source: "CLIENT_DECLARATION",
        sourceEvidence: "Inbound email from unverified address, headers stored",
      }),
    UnauthorisedContactChangeError,
  );
  check("a contact cannot change their own correspondence email unaided", unauthorised !== null);

  const rejected = await prisma.contactChangeRequest.findFirstOrThrow({
    where: { contactId: director.id, newValue: attackerEmail },
  });
  check("the rejected attempt is retained", rejected.status === "REJECTED");
  check("the source evidence is retained", (rejected.sourceEvidence ?? "").length > 0);
  check("the proposed value is retained as evidence", rejected.newValue === attackerEmail);
  check("a reason for rejection is recorded", (rejected.decisionReason ?? "").length > 0);

  const contactUnchanged = await prisma.contact.findUniqueOrThrow({ where: { id: director.id } });
  check(
    "the contact's email was NOT changed",
    contactUnchanged.email === "director@example.invalid",
    contactUnchanged.email ?? "",
  );

  const rejectionLogged = await prisma.event.count({
    where: { action: "CONTACT_CHANGE_REJECTED", targetId: rejected.id },
  });
  check("the rejection is in the audit trail", rejectionLogged === 1);

  // An article lacks client.write, so their attempt is refused too.
  const articleAttempt = await throws(
    () =>
      requestContactChange({
        practiceId: company.id, contactId: director.id, field: "email",
        newValue: "article-changed@example.invalid",
        requester: { kind: "STAFF", userId: article.id, name: "Fictional Article" },
        source: "MANUAL_ENTRY",
      }),
    UnauthorisedContactChangeError,
  );
  check("a staff member without client.write is also refused", articleAttempt !== null);

  // An authorised manager can request; a different approver applies it.
  const legitimate = await requestContactChange({
    practiceId: company.id, contactId: director.id, field: "email",
    newValue: "director.new@example.invalid",
    requester: { kind: "STAFF", userId: companyStaff.id, name: "Company Staff" },
    source: "CLIENT_DECLARATION",
    sourceEvidence: "Signed letter on client letterhead, ref FICTIONAL-2",
  });
  check("an authorised staff member can raise the change", legitimate.status === "PENDING");

  const selfApprove = await throws(
    () =>
      approveContactChange({
        requestId: legitimate.id, approverUserId: companyStaff.id, approverName: "Company Staff",
      }),
    UnauthorisedContactChangeError,
  );
  check("the requester cannot approve their own change", selfApprove !== null);

  // Refusing an approver must not destroy the request, or an unauthorised
  // approval attempt becomes a way to kill someone else's legitimate work.
  const stillPendingRequest = await prisma.contactChangeRequest.findUniqueOrThrow({
    where: { id: legitimate.id },
  });
  check(
    "the refused self-approval leaves the request PENDING for another approver",
    stillPendingRequest.status === "PENDING",
    stillPendingRequest.status,
  );

  await approveContactChange({
    requestId: legitimate.id, approverUserId: partner.id, approverName: "Fictional Partner",
  });
  const changed = await prisma.contact.findUniqueOrThrow({ where: { id: director.id } });
  check("an approved change is applied", changed.email === "director.new@example.invalid");
  check(
    "the new address is UNVERIFIED again — approval is not proof of delivery",
    changed.emailVerificationStatus === "UNVERIFIED",
  );

  // ----------- ACCEPTANCE EVIDENCE 3: no leakage via autocomplete / duplicates
  console.log("\nEvidence 3 — autocomplete and duplicate detection leak nothing");

  // A client that ONLY the Company practice acts for.
  const companyOnly = await createClient({
    userId: companyStaff.id, tenantId: tenant.id, practiceId: company.id,
    legalName: tag("Company Only Holdings Limited"), type: "COMPANY",
    identifiers: [{ kind: "PAN", value: "BBBPZ5678D", source: "MANUAL_ENTRY" }],
  });

  const acAssoc = await as(
    assocStaff.id,
    `/api/clients/autocomplete?q=${encodeURIComponent("Company Only Holdings")}`,
  );
  const acAssocBody = await acAssoc.json();
  check(
    "autocomplete shows an Associates user nothing of a Company-only client",
    acAssoc.status === 200 && (acAssocBody.suggestions ?? []).length === 0,
    JSON.stringify(acAssocBody).slice(0, 200),
  );

  const acCompany = await as(
    companyStaff.id,
    `/api/clients/autocomplete?q=${encodeURIComponent("Company Only Holdings")}`,
  );
  const acCompanyBody = await acCompany.json();
  check(
    "the Company user's own autocomplete still works",
    acCompany.status === 200 && acCompanyBody.suggestions.length === 1,
  );

  const acShort = await as(companyStaff.id, `/api/clients/autocomplete?q=C`);
  const acShortBody = await acShort.json();
  check(
    "a one-character probe returns nothing (no enumeration of the client book)",
    (acShortBody.suggestions ?? []).length === 0,
  );

  // Duplicate detection from the OTHER practice: warn, but reveal nothing.
  const dup = await checkForDuplicates({
    userId: assocStaff.id,
    tenantId: tenant.id,
    identifiers: [{ kind: "PAN", value: "BBBPZ5678D" }],
  });
  check("a duplicate IS reported to the other practice's staff", dup.hasMatch);
  check(
    "...but the match is marked OUT_OF_SCOPE",
    dup.matches.every((m) => m.visibility === "OUT_OF_SCOPE"),
  );
  const dupText = JSON.stringify(dup);
  check(
    "the warning carries no client name, party id or practice",
    !dupText.includes(companyOnly.party.legalName) &&
      !dupText.includes(companyOnly.party.id) &&
      !dupText.includes(company.id) &&
      !dupText.includes(company.name),
    dupText,
  );
  check(
    "the warning still tells staff to consult master data",
    dup.matches.some((m) => m.visibility === "OUT_OF_SCOPE" && m.message.length > 0),
  );

  // In-scope duplicates ARE shown in full — the warning is only blind across practices.
  const dupOwn = await checkForDuplicates({
    userId: companyStaff.id, tenantId: tenant.id,
    identifiers: [{ kind: "PAN", value: "BBBPZ5678D" }],
  });
  check(
    "a duplicate inside the caller's own practice is shown in full",
    dupOwn.matches.some((m) => m.visibility === "IN_SCOPE" && m.legalName.length > 0),
  );

  const probeLogged = await prisma.event.count({
    where: { action: "DUPLICATE_MATCH_OUT_OF_SCOPE", actorUserId: assocStaff.id },
  });
  check("out-of-scope duplicate probes are audited", probeLogged >= 1);

  // ------------------------------------------------------- CLI06: Client 360
  console.log("\nCLI06 — Client 360 with permission-aware tabs");

  const c360 = await as(companyStaff.id, `/api/clients/${created.relationship.id}`);
  const c360Body = await c360.json();
  check(
    "a manager can open Client 360",
    c360.status === 200,
    // Surface the server's own reason instead of a bare status code.
    `HTTP ${c360.status}${c360Body?.devMessage ? ` — ${String(c360Body.devMessage).split("\n").slice(-3).join(" ")}` : ""}`,
  );
  check("it shows both GST registrations", (c360Body.party?.identifiers ?? []).filter((i: { kind: string }) => i.kind === "GSTIN").length === 2);
  check("it names the practice, so the two firms are visibly separated", c360Body.practice?.id === company.id);
  check("the manager sees the invoices tab", c360Body.tabs?.invoices === true);
  check("the manager does NOT see fee rates without a grant", c360Body.tabs?.feeRates === false);

  const c360Article = await as(article.id, `/api/clients/${created.relationship.id}`);
  const c360ArticleBody = await c360Article.json();
  check("an article can open the client", c360Article.status === 200);
  check("...but the invoices tab is closed to them", c360ArticleBody.tabs?.invoices === false);
  check("...and invoice data is not returned at all", c360ArticleBody.invoices === null);

  const c360Assoc = await as(assocStaff.id, `/api/clients/${created.relationship.id}`);
  check(
    "an Associates user cannot open the Company relationship",
    c360Assoc.status === 404,
    `HTTP ${c360Assoc.status}`,
  );

  // Group links must not confer access.
  const sibling = await prisma.party.create({
    data: { tenantId: tenant.id, legalName: tag("Sibling Ltd"), type: "COMPANY" },
  });
  await prisma.partyGroupLink.create({
    data: {
      tenantId: tenant.id, parentPartyId: created.party.id, childPartyId: sibling.id,
      relationshipType: "SUBSIDIARY", effectiveFrom: new Date("2024-04-01"),
    },
  });
  await prisma.clientRelationship.create({
    data: { practiceId: associates.id, partyId: sibling.id, acceptanceStatus: "ACCEPTED" },
  });

  const c360WithGroup = await as(companyStaff.id, `/api/clients/${created.relationship.id}`);
  const groupBody = await c360WithGroup.json();
  check("group links are surfaced for navigation", (groupBody.groupLinks ?? []).length === 1);
  check(
    "a group link does NOT grant access to the linked party's other practice",
    (await as(companyStaff.id, `/api/clients/${
      (await prisma.clientRelationship.findFirstOrThrow({ where: { partyId: sibling.id } })).id
    }`)).status === 404,
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
