/**
 * T04 acceptance test — IAM01-05 (PRD §8).
 *
 * PRD acceptance evidence, verbatim:
 *   "A manager assigned to both firms sees only authorised teams; an article
 *    cannot grant access or approve their own filing. Revocation invalidates
 *    active sessions and queued exports before further disclosure.
 *    Background workers recheck membership when executing."
 *
 * All fixture data is fictional.
 * Run: npm run test:t04
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { assertCan, can, resolveMembership, reachesRecord, PermissionDeniedError } from "../src/lib/permissions";
import { assertMayApprove, discloseSelfReview, SeparationOfDutiesError } from "../src/lib/separation-of-duties";
import { suspendUser, assertStillAuthorised, JobAuthorisationRevokedError } from "../src/lib/user-lifecycle";
import { PracticeAccessError } from "../src/lib/practice-scope";

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
  console.log("\nT04 — roles & permissions (PRD §8 IAM01-05)\n");

  // ---------------------------------------------------------------- fixtures
  const tenant = await prisma.tenant.create({ data: { name: tag("T") } });

  const company = await prisma.practice.create({
    data: {
      tenantId: tenant.id,
      name: tag("Company"),
      constitution: "LLP",
      documentNamespace: tag("co"),
      effectiveFrom: new Date("2024-04-01"),
      invoiceApprovalThreshold: "25000.00",
    },
  });
  const associates = await prisma.practice.create({
    data: {
      tenantId: tenant.id,
      name: tag("Associates"),
      constitution: "PARTNERSHIP",
      documentNamespace: tag("as"),
      effectiveFrom: new Date("2024-04-01"),
      invoiceApprovalThreshold: "25000.00",
    },
  });

  const teamA = await prisma.team.create({ data: { practiceId: company.id, name: tag("Team A") } });
  const teamB = await prisma.team.create({ data: { practiceId: company.id, name: tag("Team B") } });
  const assocTeam = await prisma.team.create({
    data: { practiceId: associates.id, name: tag("Assoc Team") },
  });

  const partner = await prisma.user.create({
    data: { email: `partner-${RUN}@example.invalid`, fullName: "Fictional Partner", status: "ACTIVE" },
  });
  const manager = await prisma.user.create({
    data: { email: `manager-${RUN}@example.invalid`, fullName: "Dual Firm Manager", status: "ACTIVE" },
  });
  const article = await prisma.user.create({
    data: { email: `article-${RUN}@example.invalid`, fullName: "Fictional Article", status: "ACTIVE" },
  });
  const itAdmin = await prisma.user.create({
    data: { email: `it-${RUN}@example.invalid`, fullName: "Fictional IT Admin", status: "ACTIVE" },
  });

  await prisma.practiceMembership.create({
    data: {
      practiceId: company.id, userId: partner.id, role: "PRACTICE_PARTNER",
      assignmentScope: "PRACTICE", effectiveFrom: new Date("2024-04-01"),
    },
  });

  // IAM03: the manager is in BOTH firms, but team-scoped in each.
  await prisma.practiceMembership.create({
    data: {
      practiceId: company.id, userId: manager.id, role: "MANAGER",
      assignmentScope: "TEAM", teamId: teamA.id, effectiveFrom: new Date("2024-04-01"),
    },
  });
  await prisma.practiceMembership.create({
    data: {
      practiceId: associates.id, userId: manager.id, role: "MANAGER",
      assignmentScope: "TEAM", teamId: assocTeam.id, effectiveFrom: new Date("2024-04-01"),
    },
  });

  await prisma.practiceMembership.create({
    data: {
      practiceId: company.id, userId: article.id, role: "STAFF_ARTICLE",
      assignmentScope: "OWN_WORK", effectiveFrom: new Date("2024-04-01"),
    },
  });
  await prisma.practiceMembership.create({
    data: {
      practiceId: company.id, userId: itAdmin.id, role: "IT_ADMIN",
      assignmentScope: "PRACTICE", effectiveFrom: new Date("2024-04-01"),
    },
  });

  // ------------------------------- EVIDENCE 1: manager in both firms, teams
  console.log("Evidence 1 — a manager in both firms sees only authorised teams");

  const mCompany = await resolveMembership(manager.id, company.id);
  const mAssoc = await resolveMembership(manager.id, associates.id);

  check("manager has a live membership in both practices", !!mCompany && !!mAssoc);
  check(
    "each membership is scoped to its own team",
    mCompany!.teamId === teamA.id && mAssoc!.teamId === assocTeam.id,
  );
  check(
    "manager reaches their OWN team's record",
    reachesRecord(mCompany!, { teamId: teamA.id }, manager.id),
  );
  check(
    "manager does NOT reach another team in the same practice",
    !reachesRecord(mCompany!, { teamId: teamB.id }, manager.id),
  );
  check(
    "manager does NOT reach the other firm's team through this membership",
    !reachesRecord(mCompany!, { teamId: assocTeam.id }, manager.id),
  );

  // Holding MANAGER in one firm grants nothing in a practice they are not in.
  const strangerPractice = await prisma.practice.create({
    data: {
      tenantId: tenant.id, name: tag("Third"), constitution: "PROPRIETORSHIP",
      documentNamespace: tag("third"), effectiveFrom: new Date("2024-04-01"),
    },
  });
  const noStanding = await throws(
    () => assertCan(manager.id, strangerPractice.id, "client.read"),
    PracticeAccessError,
  );
  check("no membership in a third practice ⇒ refused", noStanding !== null);

  // ----------------------------------- EVIDENCE 2: article limits
  console.log("\nEvidence 2 — an article cannot grant access or approve their own filing");

  const mArticle = await resolveMembership(article.id, company.id);

  check("article CAN prepare a filing", can(mArticle!, "filing.prepare"));
  check("article CANNOT approve a filing", !can(mArticle!, "filing.approve"));
  check("article CANNOT grant access", !can(mArticle!, "user.grant_access"));
  check("article CANNOT issue an invoice", !can(mArticle!, "invoice.issue"));

  const grantDenied = await throws(
    () => assertCan(article.id, company.id, "user.grant_access"),
    PermissionDeniedError,
  );
  check("assertCan refuses the article's access grant with 403", grantDenied?.status === 403);

  // Now the self-approval path, using a real filing subject.
  const relationship = await prisma.clientRelationship.create({
    data: {
      practiceId: company.id,
      partyId: (await prisma.party.create({
        data: { tenantId: tenant.id, legalName: tag("Client Ltd"), type: "COMPANY" },
      })).id,
      acceptanceStatus: "ACCEPTED",
    },
  });
  const engagement = await prisma.engagement.create({
    data: {
      practiceId: company.id, clientRelationshipId: relationship.id,
      serviceCode: "ITR", templateVersion: "v1",
      periodStart: new Date("2025-04-01"), periodEnd: new Date("2026-03-31"),
      state: "ACTIVE",
    },
  });

  const filingId = `filing-${RUN}`;
  // The article authors it — recorded in the audit trail, which is what
  // assertMayApprove reads authorship from.
  await prisma.event.create({
    data: {
      practiceId: company.id, actorUserId: article.id,
      targetType: "FILING", targetId: filingId,
      action: "FILING_PREPARED", result: "SUCCESS",
    },
  });

  const selfApproveFiling = await throws(
    () =>
      assertMayApprove({
        practiceId: company.id,
        subjectType: "FILING",
        subjectId: filingId,
        subjectVersion: 1,
        approverUserId: article.id,
      }),
    SeparationOfDutiesError,
  );
  check("the author of a filing cannot approve it", selfApproveFiling !== null);

  // ...and no exception can be disclosed for a filing (legal prohibition).
  const cannotDisclose = await throws(
    () =>
      discloseSelfReview({
        practiceId: company.id, subjectType: "FILING", subjectId: filingId,
        subjectVersion: 1, reason: "sole reviewer", userId: article.id, userName: "Fictional Article",
      }),
    SeparationOfDutiesError,
  );
  check("a self-review exception cannot be disclosed for a FILING", cannotDisclose !== null);

  // An independent approver is fine.
  let independentOk = true;
  try {
    await assertMayApprove({
      practiceId: company.id, subjectType: "FILING", subjectId: filingId,
      subjectVersion: 1, approverUserId: partner.id,
    });
  } catch {
    independentOk = false;
  }
  check("an independent reviewer CAN approve the same filing", independentOk);

  // IAM04 threshold behaviour on invoices.
  console.log("\nIAM04 — invoice threshold and disclosed self-review");

  const series = await prisma.invoiceSeries.create({
    data: { practiceId: company.id, code: "CO", fiscalPeriod: "2025-26" },
  });
  const smallInvoice = await prisma.invoice.create({
    data: {
      practiceId: company.id, seriesId: series.id, clientRelationshipId: relationship.id,
      engagementId: engagement.id, sequenceNumber: 1, total: "10000.00",
    },
  });
  const bigInvoice = await prisma.invoice.create({
    data: {
      practiceId: company.id, seriesId: series.id, clientRelationshipId: relationship.id,
      engagementId: engagement.id, sequenceNumber: 2, total: "90000.00",
    },
  });
  for (const inv of [smallInvoice, bigInvoice]) {
    await prisma.event.create({
      data: {
        practiceId: company.id, actorUserId: partner.id,
        targetType: "INVOICE", targetId: inv.id,
        action: "INVOICE_DRAFTED", result: "SUCCESS",
      },
    });
  }

  let smallSelfApproveOk = true;
  try {
    await assertMayApprove({
      practiceId: company.id, subjectType: "INVOICE", subjectId: smallInvoice.id,
      subjectVersion: 0, approverUserId: partner.id, amount: smallInvoice.total,
    });
  } catch {
    smallSelfApproveOk = false;
  }
  check("below the threshold, the drafter may approve their own invoice", smallSelfApproveOk);

  const bigSelfApprove = await throws(
    () =>
      assertMayApprove({
        practiceId: company.id, subjectType: "INVOICE", subjectId: bigInvoice.id,
        subjectVersion: 0, approverUserId: partner.id, amount: bigInvoice.total,
      }),
    SeparationOfDutiesError,
  );
  check("above the threshold, self-approval is refused", bigSelfApprove !== null);

  await discloseSelfReview({
    practiceId: company.id, subjectType: "INVOICE", subjectId: bigInvoice.id,
    subjectVersion: 0, reason: "Sole partner available at year end",
    userId: partner.id, userName: "Fictional Partner",
  });

  let afterDisclosure = true;
  try {
    await assertMayApprove({
      practiceId: company.id, subjectType: "INVOICE", subjectId: bigInvoice.id,
      subjectVersion: 0, approverUserId: partner.id, amount: bigInvoice.total,
    });
  } catch {
    afterDisclosure = false;
  }
  check("after a disclosed exception, approval proceeds", afterDisclosure);

  const exception = await prisma.selfReviewException.findFirstOrThrow({
    where: { subjectId: bigInvoice.id },
  });
  check(
    "the exception leaves a quality-review obligation behind",
    exception.qualityReviewRequired && exception.qualityReviewedAt === null,
  );
  check("the exception records a reason", exception.reason.length > 0);

  // ------------------------------------- IAM02: IT control vs data authority
  console.log("\nIAM02 — IT control is separated from professional data authority");

  const mIt = await resolveMembership(itAdmin.id, company.id);
  check("IT admin CAN administer the system", can(mIt!, "system.administer"));
  check("IT admin CANNOT approve a filing", !can(mIt!, "filing.approve"));
  check("IT admin CANNOT issue an invoice", !can(mIt!, "invoice.issue"));
  check("IT admin CANNOT read client records", !can(mIt!, "client.read"));
  const mPartner = await resolveMembership(partner.id, company.id);
  check("a partner CANNOT administer the system", !can(mPartner!, "system.administer"));

  // ------------------------------------------ IAM03: restricted areas
  console.log("\nIAM03 — restricted areas need an explicit grant");

  check("partner cannot read fee rates without a grant", !can(mPartner!, "feerate.read"));
  await prisma.permissionGrant.create({
    data: {
      practiceId: company.id, membershipId: mPartner!.membershipId,
      permission: "FEE_RATES", reason: "Annual fee review",
      grantedByName: "Fictional Partner",
    },
  });
  const mPartnerAfter = await resolveMembership(partner.id, company.id);
  check("after an explicit grant, fee rates become readable", can(mPartnerAfter!, "feerate.read"));
  check(
    "the grant does not leak into other restricted areas",
    !can(mPartnerAfter!, "hr.read") && !can(mPartnerAfter!, "export.credentials"),
  );

  // ------------------- EVIDENCE 3 & 4: revocation and worker re-check
  console.log("\nEvidence 3 & 4 — revocation kills sessions and queued exports; workers re-check");

  const leaver = await prisma.user.create({
    data: { email: `leaver-${RUN}@example.invalid`, fullName: "Departing Staff", status: "ACTIVE" },
  });
  await prisma.practiceMembership.create({
    data: {
      practiceId: company.id, userId: leaver.id, role: "MANAGER",
      assignmentScope: "PRACTICE", effectiveFrom: new Date("2024-04-01"),
    },
  });

  await prisma.session.create({
    data: {
      userId: leaver.id,
      tokenHash: `t04-fixture-${RUN}`,
      idleExpiresAt: new Date(Date.now() + 30 * 60_000),
      absoluteExpiresAt: new Date(Date.now() + 12 * 3600_000),
      mfaVerifiedAt: new Date(),
    },
  });

  const queuedExport = await prisma.queuedJob.create({
    data: {
      practiceId: company.id, requestedByUserId: leaver.id,
      kind: "EXPORT", payload: { report: "all invoices" }, state: "QUEUED",
    },
  });

  // A second job that is already RUNNING when the suspension lands.
  const runningExport = await prisma.queuedJob.create({
    data: {
      practiceId: company.id, requestedByUserId: leaver.id,
      kind: "EXPORT", payload: { report: "client list" }, state: "RUNNING",
      startedAt: new Date(),
    },
  });

  const before = await prisma.session.count({ where: { userId: leaver.id, revokedAt: null } });
  check("leaver has a live session before suspension", before === 1);

  const suspension = await suspendUser({
    userId: leaver.id, reason: "Left the firm",
    actorUserId: partner.id, actorName: "Fictional Partner",
  });

  const liveAfter = await prisma.session.count({ where: { userId: leaver.id, revokedAt: null } });
  check("revocation invalidates active sessions", liveAfter === 0, `${liveAfter} still live`);
  check("suspension reported the sessions it revoked", suspension.revokedSessions === 1);

  const queuedAfter = await prisma.queuedJob.findUniqueOrThrow({ where: { id: queuedExport.id } });
  check(
    "revocation cancels the QUEUED export",
    queuedAfter.state === "CANCELLED",
    `state ${queuedAfter.state}`,
  );
  const runningAfter = await prisma.queuedJob.findUniqueOrThrow({ where: { id: runningExport.id } });
  check(
    "revocation also cancels an already-RUNNING export",
    runningAfter.state === "CANCELLED",
    `state ${runningAfter.state}`,
  );

  // Evidence 4: the worker's own re-check, independent of cancellation.
  const raceJob = await prisma.queuedJob.create({
    data: {
      practiceId: company.id, requestedByUserId: leaver.id,
      kind: "EXPORT", payload: { report: "late arrival" }, state: "QUEUED",
    },
  });
  const workerAbort = await throws(
    () => assertStillAuthorised(raceJob.id),
    JobAuthorisationRevokedError,
  );
  check(
    "a worker starting a job AFTER revocation aborts on re-check",
    workerAbort !== null,
  );
  const raceAfter = await prisma.queuedJob.findUniqueOrThrow({ where: { id: raceJob.id } });
  check("the aborted job is marked cancelled by the worker", raceAfter.state === "CANCELLED");

  // A still-valid user's job passes the same re-check.
  const validJob = await prisma.queuedJob.create({
    data: {
      practiceId: company.id, requestedByUserId: partner.id,
      kind: "EXPORT", payload: { report: "ok" }, state: "QUEUED",
    },
  });
  let validPasses = true;
  try {
    await assertStillAuthorised(validJob.id);
  } catch {
    validPasses = false;
  }
  check("a still-authorised requester's job passes the re-check", validPasses);

  // IAM05: authorship survives.
  const leaverAfter = await prisma.user.findUniqueOrThrow({ where: { id: leaver.id } });
  check(
    "the suspended account is preserved, not deleted (authorship intact)",
    leaverAfter.status === "SUSPENDED" && leaverAfter.suspendedAt !== null,
  );
  const denied = await throws(
    () => assertCan(leaver.id, company.id, "client.read"),
    PracticeAccessError,
  );
  check("the suspended user can no longer act", denied !== null);

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
