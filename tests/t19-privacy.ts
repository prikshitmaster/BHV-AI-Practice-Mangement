/**
 * T19 acceptance test — PRV01, PRV02, PRV04, PRV06 (PRD §36).
 * PRV03 (rights requests) and PRV05 (DPDP breach workflow) are R1.
 *
 * PRD acceptance evidence, verbatim:
 *   "An erasure request for an engagement under legal hold is reviewed and
 *    partially actioned where appropriate, with reasons. The incident screen
 *    shows awareness time and the correct independent reporting clocks, even
 *    if root cause investigation is incomplete."
 *
 * Both headlines are the EVIDENCE sections below; each is paired with a
 * CONTROL so it cannot pass with the mechanism switched off. The regulatory
 * entries used here are FICTIONAL — nothing in this test asserts the real
 * state of any law.
 *
 * Library level — no HTTP server. Needs MinIO (documents are really filed and
 * really destroyed). All fixture data is fictional. Run: npm run test:t19
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { PermissionDeniedError } from "../src/lib/permissions";
import { PracticeAccessError } from "../src/lib/practice-scope";
import { VersionConflictError } from "../src/lib/concurrency";
import {
  PrivacyError,
  changeRegulatoryState,
  createProcessingActivity,
  listProcessingActivities,
  recordRegulatoryRequirement,
  stateAt,
  updateProcessingActivity,
  type ProcessingActivityInput,
} from "../src/lib/privacy-register";
import {
  CERT_IN_ICT_LOG_DAYS,
  ICT_LOG_CLASS,
  activeHoldsForDocument,
  createRetentionPolicy,
  ictLogPosture,
  retentionDecision,
} from "../src/lib/retention";
import {
  actionErasureRequest,
  createErasureRequest,
  reviewErasureRequest,
} from "../src/lib/erasure";
import {
  CERT_IN_HOURS,
  DPDP_BREACH_CODE,
  assessCertIn,
  getIncident,
  incidentClocks,
  recordIncidentReport,
  reportIncident,
  reviseAwareness,
  updateRootCause,
} from "../src/lib/incidents";
import { receiveUpload, setMalwareScanner } from "../src/lib/document-intake";
import {
  DocumentError,
  applyRetention,
  checkDeletionEligibility,
  fileUpload,
  placeLegalHold,
} from "../src/lib/documents";
import { ensureBucket, getObject } from "../src/lib/object-store";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

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
const HOUR = 3_600_000;
const addYears = (x: Date, n: number) => {
  const o = new Date(x);
  o.setUTCFullYear(o.getUTCFullYear() + n);
  return o;
};

async function main() {
  console.log("\nT19 — privacy, retention and regulatory clocks (PRD §36 PRV01, PRV02, PRV04, PRV06)\n");

  await ensureBucket();
  setMalwareScanner(null);

  // ============================================================ fixtures
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
  const company = await makePractice("Fictional Company LLP", "t19co");
  const associates = await makePractice("Fictional Associates", "t19as");

  async function makeUser(label: string) {
    return prisma.user.create({
      data: { email: `${label}-${RUN}@example.invalid`, fullName: `Fictional ${label}`, status: "ACTIVE" },
    });
  }
  const partner = await makeUser("Partner");
  const partner2 = await makeUser("SecondPartner");
  const article = await makeUser("Article");
  const itAdmin = await makeUser("ItAdmin");
  const outsider = await makeUser("Outsider");
  const from = d("2024-04-01");
  await prisma.practiceMembership.createMany({
    data: [
      { practiceId: company.id, userId: partner.id, role: "PRACTICE_PARTNER", assignmentScope: "PRACTICE", effectiveFrom: from },
      { practiceId: company.id, userId: partner2.id, role: "PRACTICE_PARTNER", assignmentScope: "PRACTICE", effectiveFrom: from },
      { practiceId: company.id, userId: article.id, role: "STAFF_ARTICLE", assignmentScope: "OWN_WORK", effectiveFrom: from },
      { practiceId: company.id, userId: itAdmin.id, role: "IT_ADMIN", assignmentScope: "PRACTICE", effectiveFrom: from },
      { practiceId: associates.id, userId: outsider.id, role: "PRACTICE_PARTNER", assignmentScope: "PRACTICE", effectiveFrom: from },
    ],
  });

  const party = await prisma.party.create({
    data: { tenantId: tenant.id, legalName: tag("Fictional Client Private Limited"), type: "COMPANY" },
  });
  const client = await prisma.clientRelationship.create({
    data: { practiceId: company.id, partyId: party.id, acceptanceStatus: "ACCEPTED" },
  });
  const assocClient = await prisma.clientRelationship.create({
    data: { practiceId: associates.id, partyId: party.id, acceptanceStatus: "ACCEPTED" },
  });
  const makeEngagement = (practiceId: string, clientRelationshipId: string, serviceCode: string) =>
    prisma.engagement.create({
      data: {
        practiceId, clientRelationshipId, serviceCode, templateVersion: "1",
        periodStart: d("2025-04-01"), periodEnd: d("2026-03-31"), state: "ACTIVE",
      },
    });
  const heldEngagement = await makeEngagement(company.id, client.id, "STATUTORY_AUDIT");
  const openEngagement = await makeEngagement(company.id, client.id, "GST_MONTHLY");
  const assocEngagement = await makeEngagement(associates.id, assocClient.id, "TAX_ADVISORY");

  // The director asks for erasure; the accountant is ALSO a contact of the
  // other practice, which this practice cannot decide for.
  const director = await prisma.contact.create({
    data: {
      partyId: party.id, fullName: "Fictional Director",
      email: `director-${RUN}@example.invalid`, phone: "+91 90000 00001",
    },
  });
  const accountant = await prisma.contact.create({
    data: { partyId: party.id, fullName: "Fictional Accountant", phone: "+91 90000 00002" },
  });
  await prisma.contactAuthority.createMany({
    data: [
      { practiceId: company.id, contactId: director.id, clientRelationshipId: client.id, authority: "UPLOAD", effectiveFrom: from },
      { practiceId: company.id, contactId: accountant.id, clientRelationshipId: client.id, authority: "UPLOAD", effectiveFrom: from },
      { practiceId: associates.id, contactId: accountant.id, clientRelationshipId: assocClient.id, authority: "UPLOAD", effectiveFrom: from },
    ],
  });

  const pdf = (text: string) =>
    Buffer.from(`%PDF-1.7\n% fictional test document\n${text} ${RUN}\n%%EOF\n`, "latin1");
  async function file(practiceId: string, clientRelationshipId: string, engagementId: string, name: string, actor: string) {
    const receipt = await receiveUpload({
      ctx: { actorUserId: actor, practiceId, clientRelationshipId, source: "STAFF_UPLOAD" as const },
      body: pdf(name),
      filename: `${name}.pdf`,
      declaredMimeType: "application/pdf",
    });
    return fileUpload({
      actorUserId: actor, practiceId, receipt, filename: `${name}.pdf`,
      clientRelationshipId, engagementId, kind: "CLIENT_SUPPLIED",
    });
  }

  // ====================================================== PRV01 register
  console.log("PRV01 — processing register; consent is not the default basis");

  const base: ProcessingActivityInput = {
    name: tag("Statutory audit working papers"),
    purpose: "Performing the statutory audit engagement",
    dataCategories: ["Director identity", "Financial statements"],
    source: "Client, under the engagement letter",
    accessRoles: ["PRACTICE_PARTNER", "MANAGER", "STAFF_ARTICLE"],
    recipients: ["Registrar (filings, fictional)"],
    vendor: null,
    hostingLocation: "UNCONFIRMED — hosting decision open (PRD §46)",
    retentionClass: "CLIENT_RECORDS",
    legalBasis: "LEGAL_OBLIGATION",
    legalAuthority: "Fictional Companies Statute s.1",
    ownerName: "Fictional Partner",
  };

  const noNotice = await throws(
    () => createProcessingActivity({ actorUserId: partner.id, practiceId: company.id, input: { ...base, name: tag("Newsletter"), legalBasis: "CONSENT" } }),
    PrivacyError,
  );
  check("CONSENT without the notice given is refused", noNotice?.code === "CONSENT_NEEDS_NOTICE", noNotice?.code);
  const noRecord = await throws(
    () => createProcessingActivity({ actorUserId: partner.id, practiceId: company.id, input: { ...base, name: tag("Newsletter"), legalBasis: "CONSENT", noticeReference: "Notice v1" } }),
    PrivacyError,
  );
  check("CONSENT without a consent record is refused", noRecord?.code === "CONSENT_NEEDS_RECORD", noRecord?.code);
  const noAuthority = await throws(
    () => createProcessingActivity({ actorUserId: partner.id, practiceId: company.id, input: { ...base, legalAuthority: " " } }),
    PrivacyError,
  );
  check("a basis with no named authority is refused", noAuthority?.code === "FIELD_REQUIRED", noAuthority?.code);

  const activity = await createProcessingActivity({ actorUserId: partner.id, practiceId: company.id, input: base });
  check(
    "a professional record under LEGAL_OBLIGATION is registered with no consent at all",
    activity.legalBasis === "LEGAL_OBLIGATION" && activity.consentRecordReference === null,
  );
  check(
    "the entry carries every PRV01 particular",
    !!activity.purpose && activity.dataCategories.length === 2 && !!activity.source &&
      activity.accessRoles.length === 3 && activity.recipients.length === 1 &&
      !!activity.hostingLocation && !!activity.retentionClass && !!activity.legalAuthority,
  );
  check("an unconfirmed hosting location is recorded as unconfirmed, not guessed", /UNCONFIRMED/.test(activity.hostingLocation));

  const articleCreate = await throws(
    () => createProcessingActivity({ actorUserId: article.id, practiceId: company.id, input: { ...base, name: tag("x") } }),
    PermissionDeniedError,
  );
  check("an article cannot write to the register", !!articleCreate);
  const crossList = await throws(() => listProcessingActivities(outsider.id, company.id), PracticeAccessError);
  check("the other practice cannot read this practice's register (not found)", !!crossList);

  await updateProcessingActivity({ actorUserId: partner.id, practiceId: company.id, activityId: activity.id, expectedVersion: 1, status: "ACTIVE" });
  const stale = await throws(
    () => updateProcessingActivity({ actorUserId: partner2.id, practiceId: company.id, activityId: activity.id, expectedVersion: 1, status: "RETIRED" }),
    VersionConflictError,
  );
  check("a stale register edit is a conflict, not an overwrite (API02)", !!stale);

  // ICT logs are in the register too, so the CERT-In posture can say where they live.
  await createProcessingActivity({
    actorUserId: partner.id, practiceId: company.id,
    input: { ...base, name: tag("ICT and audit logs"), purpose: "Security monitoring", dataCategories: ["Access logs"], retentionClass: ICT_LOG_CLASS, legalAuthority: "Fictional CERT-In style direction" },
  });

  // =================================================== PRV02 regulatory
  console.log("\nPRV02 — legal state is tracked, sourced and never mislabelled");

  const noDate = await throws(
    () => recordRegulatoryRequirement({
      actorUserId: partner.id, practiceId: company.id, reason: "fixture",
      input: { code: tag("FICT-A"), title: "Fictional duty", instrument: "Fictional Act", state: "OPERATIONAL", sourceReference: "Fictional gazette", sourceDate: d("2025-01-01"), effectiveRule: "Keep X" },
    }),
    PrivacyError,
  );
  check("OPERATIONAL without an effective date is refused", noDate?.code === "OPERATIONAL_NEEDS_DATE", noDate?.code);
  const future = await throws(
    () => recordRegulatoryRequirement({
      actorUserId: partner.id, practiceId: company.id, reason: "fixture",
      input: { code: tag("FICT-A"), title: "Fictional duty", instrument: "Fictional Act", state: "OPERATIONAL", sourceReference: "Fictional gazette", sourceDate: d("2025-01-01"), effectiveFrom: addYears(new Date(), 1), effectiveRule: "Keep X" },
    }),
    PrivacyError,
  );
  check("OPERATIONAL with a date still ahead is refused — it is Prospective", future?.code === "NOT_YET_OPERATIONAL", future?.code);

  // The DPDP breach duty, recorded (fictionally) as PROSPECTIVE.
  await recordRegulatoryRequirement({
    actorUserId: partner.id, practiceId: company.id, reason: "Fictional register entry for the test",
    input: {
      code: DPDP_BREACH_CODE, title: "Personal data breach intimation (fictional entry)",
      instrument: "Fictional data protection rules", state: "PROSPECTIVE",
      sourceReference: "Fictional notification", sourceDate: d("2025-01-01"),
      effectiveFrom: addYears(new Date(), 1), effectiveRule: "Intimate the Board and affected persons",
    },
  });
  const pastProspective = await throws(
    () => recordRegulatoryRequirement({
      actorUserId: partner.id, practiceId: company.id, reason: "fixture",
      input: { code: tag("FICT-B"), title: "x", instrument: "x", state: "PROSPECTIVE", sourceReference: "x", sourceDate: d("2024-01-01"), effectiveFrom: d("2024-06-01"), effectiveRule: "x" },
    }),
    PrivacyError,
  );
  check("PROSPECTIVE with a date already passed is refused — confirm Operational", pastProspective?.code === "PROSPECTIVE_DATE_PASSED", pastProspective?.code);

  const dpdpNow = await stateAt(company.id, DPDP_BREACH_CODE);
  check("the prospective duty is tracked but NOT operative", dpdpNow.tracked && !dpdpNow.operative);

  // A fictional minimisation rule: NOTIFIED in 2025, OPERATIONAL from 2026.
  const rule = await recordRegulatoryRequirement({
    actorUserId: partner.id, practiceId: company.id, reason: "Notified (fictional)", now: d("2025-01-15"),
    input: { code: tag("FICT-MIN"), title: "Fictional one-year minimisation", instrument: "Fictional Rules", state: "NOTIFIED", sourceReference: "Fictional notification 1", sourceDate: d("2025-01-10"), effectiveFrom: d("2026-01-01"), effectiveRule: "Delete marketing data after one year" },
  });
  await changeRegulatoryState({
    actorUserId: partner2.id, practiceId: company.id, requirementId: rule.id, expectedVersion: 1,
    toState: "OPERATIONAL", sourceReference: "Fictional commencement order", sourceDate: d("2026-01-01"),
    reason: "Commenced (fictional)", now: d("2026-01-02"),
  });
  const history = await prisma.regulatoryStateChange.findMany({ where: { requirementId: rule.id }, orderBy: { changedAt: "asc" } });
  check("the state change is APPENDED — both states remain in the history", history.length === 2 && history[0].toState === "NOTIFIED" && history[1].toState === "OPERATIONAL");
  const asAt2025 = await stateAt(company.id, rule.code, d("2025-06-01"));
  const asAtNow = await stateAt(company.id, rule.code);
  check("read as at mid-2025 it was NOTIFIED — the past is judged by the register THEN", asAt2025.tracked && asAt2025.state === "NOTIFIED" && !asAt2025.operative);
  check("read now it is OPERATIONAL and operative", asAtNow.tracked && asAtNow.operative);
  const noSuccessor = await throws(
    () => changeRegulatoryState({ actorUserId: partner.id, practiceId: company.id, requirementId: rule.id, expectedVersion: 2, toState: "SUPERSEDED", sourceReference: "x", sourceDate: d("2026-02-01"), reason: "x" }),
    PrivacyError,
  );
  check("SUPERSEDED without naming the successor is refused", noSuccessor?.code === "SUPERSEDED_NEEDS_SUCCESSOR", noSuccessor?.code);
  const notTracked = await stateAt(associates.id, DPDP_BREACH_CODE);
  check("the other practice has NOT tracked it — reported as not tracked, not as not applicable", !notTracked.tracked);

  // ==================================================== PRV06 retention
  console.log("\nPRV06 — floors, ceilings, holds; nothing is a universal purge timer");

  const trigger = d("2026-04-01");
  await createRetentionPolicy({ actorUserId: partner.id, practiceId: company.id, input: { recordClass: "CLIENT_RECORDS", direction: "RETAIN_AT_LEAST", trigger: "FINANCIAL_YEAR_END", retainYears: 8, basis: "Fictional Companies Statute s.1", covers: ["ORIGINAL", "DERIVATIVE", "EMAIL", "BACKUP"], effectiveFrom: from } });
  await createRetentionPolicy({ actorUserId: partner.id, practiceId: company.id, input: { recordClass: "CLIENT_RECORDS", direction: "RETAIN_AT_LEAST", trigger: "FINANCIAL_YEAR_END", retainYears: 6, basis: "Fictional Tax Statute s.2", covers: ["ORIGINAL"], effectiveFrom: from } });
  // A prospective 1-year ceiling tied to the DPDP entry, and an operative one
  // tied to the fictional minimisation rule.
  await createRetentionPolicy({ actorUserId: partner.id, practiceId: company.id, input: { recordClass: "CLIENT_RECORDS", direction: "DELETE_AFTER", trigger: "FINANCIAL_YEAR_END", retainYears: 1, basis: "Prospective data rule (fictional)", covers: ["ORIGINAL"], effectiveFrom: from, regulatoryRequirementCode: DPDP_BREACH_CODE } });

  const records = await retentionDecision({ practiceId: company.id, recordClass: "CLIENT_RECORDS", triggerDate: trigger });
  check("with two floors the LONGER duty wins (8 years, not 6)", records.retainUntil?.getTime() === addYears(trigger, 8).getTime(), records.retainUntil?.toISOString());
  check("a ceiling tied to a PROSPECTIVE requirement does not apply", records.ceilings.length === 0 && records.rulesNotApplied.some((r) => /PROSPECTIVE/.test(r.why)));
  check("EVIDENCE of 'not a purge timer': floors alone set NO purge date", records.purgeDueAt === null);
  check("...and deletion is not even allowed until the floor passes", !records.deletionAllowed);

  await createRetentionPolicy({ actorUserId: partner.id, practiceId: company.id, input: { recordClass: "CLIENT_RECORDS", direction: "DELETE_AFTER", trigger: "FINANCIAL_YEAR_END", retainYears: 1, basis: "Operative minimisation rule (fictional)", covers: ["ORIGINAL"], effectiveFrom: from, regulatoryRequirementCode: rule.code } });
  const conflicted = await retentionDecision({ practiceId: company.id, recordClass: "CLIENT_RECORDS", triggerDate: trigger });
  check("an OPERATIVE ceiling shorter than a floor is reported as a conflict", conflicted.conflicts.length === 1, conflicted.conflicts.join(" | "));
  check("...and cannot cut the longer duty short — deletion falls due only at the floor", conflicted.purgeDueAt?.getTime() === addYears(trigger, 8).getTime());

  await createRetentionPolicy({ actorUserId: partner.id, practiceId: company.id, input: { recordClass: "MARKETING", direction: "DELETE_AFTER", trigger: "LAST_ACTIVITY", retainYears: 1, basis: "Operative minimisation rule (fictional)", covers: ["ORIGINAL", "EMAIL"], effectiveFrom: from, regulatoryRequirementCode: rule.code } });
  const marketing = await retentionDecision({ practiceId: company.id, recordClass: "MARKETING", triggerDate: trigger });
  check("CONTROL — with no floor, an operative ceiling DOES set a purge date", marketing.purgeDueAt?.getTime() === addYears(trigger, 1).getTime());
  const heldMarketing = await retentionDecision({ practiceId: company.id, recordClass: "MARKETING", triggerDate: trigger, holds: [{ id: "h", reason: "Fictional dispute", placedAt: new Date() }] });
  check("a legal hold removes the purge date entirely", heldMarketing.purgeDueAt === null && !heldMarketing.deletionAllowed);

  const shortLogs = await throws(
    () => createRetentionPolicy({ actorUserId: partner.id, practiceId: company.id, input: { recordClass: ICT_LOG_CLASS, direction: "DELETE_AFTER", trigger: "CREATED", retainDays: 90, basis: "Tidy-up", covers: ["ICT_LOG"], effectiveFrom: from } }),
    PrivacyError,
  );
  check(`an ICT-log deletion ceiling under ${CERT_IN_ICT_LOG_DAYS} days is refused`, shortLogs?.code === "BELOW_ICT_LOG_FLOOR", shortLogs?.code);
  await createRetentionPolicy({ actorUserId: partner.id, practiceId: company.id, input: { recordClass: ICT_LOG_CLASS, direction: "RETAIN_AT_LEAST", trigger: "CREATED", retainDays: CERT_IN_ICT_LOG_DAYS, basis: "Fictional CERT-In style direction", covers: ["ICT_LOG", "BACKUP"], effectiveFrom: from } });
  const logs = await retentionDecision({ practiceId: company.id, recordClass: ICT_LOG_CLASS, triggerDate: trigger });
  check("the 180-day ICT-log rule is a FLOOR and sets no purge date", logs.purgeDueAt === null && logs.floors.length === 1);
  const posture = await ictLogPosture(company.id);
  check("the ICT-log posture reports the 180-day minimum as met", posture.meetsCertInMinimum && posture.floorDays === CERT_IN_ICT_LOG_DAYS, `${posture.floorDays}`);
  check("...and does NOT claim Indian jurisdiction while hosting is unconfirmed", !posture.hostingConfirmedIndia);
  const articlePolicy = await throws(
    () => createRetentionPolicy({ actorUserId: article.id, practiceId: company.id, input: { recordClass: "X", direction: "RETAIN_AT_LEAST", trigger: "CREATED", retainYears: 1, basis: "x", covers: ["ORIGINAL"], effectiveFrom: from } }),
    PermissionDeniedError,
  );
  check("an article cannot set retention schedules", !!articlePolicy);

  // ---------------------------------------- DOC06 hold defects found in T19
  console.log("\nPRV06 / DOC06 — holds are read live, by scope");

  const heldDocA = await file(company.id, client.id, heldEngagement.id, "trial-balance", article.id);
  const articleHold = await throws(
    () => placeLegalHold({ actorUserId: article.id, practiceId: company.id, engagementId: heldEngagement.id, reason: "x" }),
    PermissionDeniedError,
  );
  check("an article cannot place a legal hold", !!articleHold);
  const crossHold = await throws(
    () => placeLegalHold({ actorUserId: partner.id, practiceId: company.id, engagementId: assocEngagement.id, reason: "x" }),
    PracticeAccessError,
  );
  check("a hold cannot name another practice's engagement", !!crossHold);

  await placeLegalHold({ actorUserId: partner.id, practiceId: company.id, engagementId: heldEngagement.id, reason: "Fictional regulator enquiry — preserve the audit file" });
  // Filed AFTER the hold was placed: the flag-only implementation missed this.
  const heldDocB = await file(company.id, client.id, heldEngagement.id, "bank-confirmation", article.id);
  const docBRow = await prisma.document.findUniqueOrThrow({ where: { id: heldDocB.document.id } });
  check("CONTROL — the late document's legalHold FLAG is false", docBRow.legalHold === false);
  const lateEligibility = await checkDeletionEligibility({ practiceId: company.id, documentId: heldDocB.document.id });
  check("...yet it is NOT deletable: the live engagement hold reaches it", !lateEligibility.eligible && /legal hold/i.test(lateEligibility.reason ?? ""), lateEligibility.reason ?? "");
  check("the live hold lookup finds the engagement hold for it", (await activeHoldsForDocument(company.id, heldDocB.document.id)).length === 1);

  // applyRetention used to update by id alone.
  await createRetentionPolicy({ actorUserId: outsider.id, practiceId: associates.id, input: { recordClass: "CLIENT_RECORDS", direction: "RETAIN_AT_LEAST", trigger: "CREATED", retainYears: 0, basis: "Associates schedule (fictional)", covers: ["ORIGINAL"], effectiveFrom: from } });
  const crossRetention = await throws(
    () => applyRetention({ actorUserId: outsider.id, practiceId: associates.id, documentId: heldDocA.document.id, recordClass: "CLIENT_RECORDS" }),
    DocumentError,
  );
  const docAAfter = await prisma.document.findUniqueOrThrow({ where: { id: heldDocA.document.id } });
  check("another practice cannot re-date this practice's document by id", crossRetention?.code === "DOCUMENT_NOT_FOUND" && docAAfter.retentionUntil === null, crossRetention?.code);

  // ======================================================= EVIDENCE: erasure
  console.log("\n  EVIDENCE — erasure request on an engagement under legal hold, partially actioned with reasons");

  const articleErasure = await throws(
    () => createErasureRequest({ actorUserId: article.id, practiceId: company.id, engagementId: heldEngagement.id, receivedVia: "Email", requestText: "x" }),
    PermissionDeniedError,
  );
  check("an article cannot log an erasure decision", !!articleErasure);

  const request = await createErasureRequest({
    actorUserId: partner.id, practiceId: company.id, engagementId: heldEngagement.id, contactId: director.id,
    receivedVia: "Letter from the director (fictional)", requestText: "Please erase all my personal data held for this engagement",
  });
  const byKind = (k: string) => request.items.filter((i) => i.kind === k);
  check("every held document is listed", byKind("DOCUMENT").length === 2);
  check("...each already marked must-retain because of the hold", byKind("DOCUMENT").every((i) => /legal hold/i.test(i.mustRetainReason ?? "")));
  check("the director's phone and email are listed as separate items", byKind("CONTACT_PHONE").length === 1 && byKind("CONTACT_EMAIL").length === 1);
  check("the audit trail is listed and must be retained", byKind("AUDIT_TRAIL").length === 1 && !!byKind("AUDIT_TRAIL")[0].mustRetainReason);
  check("CONTROL — the hold does NOT freeze the contact details", byKind("CONTACT_PHONE")[0].mustRetainReason === null);

  const all = (decision: "ERASE" | "RETAIN", reason = "fixture") =>
    request.items.map((i) => ({ itemId: i.id, decision, reason }));
  const selfReview = await throws(
    () => reviewErasureRequest({ actorUserId: partner.id, practiceId: company.id, requestId: request.id, expectedVersion: 1, decisions: all("RETAIN") }),
    PrivacyError,
  );
  check("the person who logged it cannot review it", selfReview?.code === "SELF_REVIEW_REFUSED", selfReview?.code);
  const partial = await throws(
    () => reviewErasureRequest({ actorUserId: partner2.id, practiceId: company.id, requestId: request.id, expectedVersion: 1, decisions: all("RETAIN").slice(1) }),
    PrivacyError,
  );
  check("a review that leaves an item undecided is refused", partial?.code === "ITEMS_UNDECIDED", partial?.code);
  const noReason = await throws(
    () => reviewErasureRequest({ actorUserId: partner2.id, practiceId: company.id, requestId: request.id, expectedVersion: 1, decisions: all("RETAIN", " ") }),
    PrivacyError,
  );
  check("a decision with no reason is refused", noReason?.code === "REASON_REQUIRED", noReason?.code);
  const eraseHeld = await throws(
    () => reviewErasureRequest({ actorUserId: partner2.id, practiceId: company.id, requestId: request.id, expectedVersion: 1, decisions: all("ERASE", "Requested") }),
    PrivacyError,
  );
  check("ERASE on a held document is refused whatever the reviewer chooses", eraseHeld?.code === "MUST_RETAIN" && /legal hold/i.test(eraseHeld.message), eraseHeld?.message);

  const decisions = request.items.map((i) => {
    if (i.kind === "CONTACT_PHONE") return { itemId: i.id, decision: "ERASE" as const, reason: "Personal mobile is not evidence of the engagement; not needed" };
    if (i.kind === "CONTACT_EMAIL") return { itemId: i.id, decision: "RETAIN" as const, reason: "Needed for statutory correspondence while the held engagement continues" };
    if (i.kind === "DOCUMENT") return { itemId: i.id, decision: "RETAIN" as const, reason: "Preserved under the legal hold on this engagement" };
    return { itemId: i.id, decision: "RETAIN" as const, reason: "Audit evidence is retained under the practice's legal duties" };
  });
  const reviewed = await reviewErasureRequest({ actorUserId: partner2.id, practiceId: company.id, requestId: request.id, expectedVersion: 1, decisions });
  check("the review is recorded with the reviewer named", reviewed.state === "REVIEWED" && reviewed.reviewedByName === "Fictional SecondPartner");

  const wrongActor = await throws(
    () => actionErasureRequest({ actorUserId: partner.id, practiceId: company.id, requestId: request.id, expectedVersion: 2 }),
    PrivacyError,
  );
  check("only the reviewer actions the decisions", wrongActor?.code === "NOT_THE_REVIEWER", wrongActor?.code);

  const actioned = await actionErasureRequest({ actorUserId: partner2.id, practiceId: company.id, requestId: request.id, expectedVersion: 2 });
  check("EVIDENCE: the request is PARTIALLY actioned", actioned.state === "PARTIALLY_ACTIONED", actioned.state);
  check("EVIDENCE: every item carries a reason", actioned.items.every((i) => !!i.reason?.trim()));
  const directorAfter = await prisma.contact.findUniqueOrThrow({ where: { id: director.id } });
  check("EVIDENCE: the phone number is erased", directorAfter.phone === null);
  check("EVIDENCE: the email the reviewer retained is untouched", directorAfter.email === director.email);
  const heldVersions = await prisma.documentVersion.findMany({ where: { documentId: { in: [heldDocA.document.id, heldDocB.document.id] } } });
  const heldBytes = await Promise.all(heldVersions.map((v) => getObject(v.storageObjectId)));
  check("EVIDENCE: both held documents and their bytes survive", heldVersions.length === 2 && heldBytes.every((b) => b !== null));
  check("the outcome summary states what was erased and what was kept", /1 item\(s\) erased, 4 retained/.test(actioned.outcomeSummary ?? ""), actioned.outcomeSummary ?? "");
  const erasedEvent = await prisma.event.findFirst({ where: { action: "CONTACT_DETAIL_ERASED", targetId: director.id } });
  check("the erasure is audited", !!erasedEvent);
  check("...without copying the erased value into the audit trail", !!erasedEvent && !JSON.stringify(erasedEvent, (_k, v) => (typeof v === "bigint" ? v.toString() : v)).includes("90000 00001"));

  // The shared contact: this practice cannot decide for the other one.
  const shared = await createErasureRequest({ actorUserId: partner.id, practiceId: company.id, engagementId: heldEngagement.id, contactId: accountant.id, receivedVia: "Email (fictional)", requestText: "Erase my number" });
  const sharedPhone = shared.items.find((i) => i.kind === "CONTACT_PHONE")!;
  check("a contact also held by the other practice must be retained here", !!sharedPhone.mustRetainReason);
  check("...and the reason does not name the other practice", !sharedPhone.mustRetainReason!.includes(associates.name) && !sharedPhone.mustRetainReason!.includes("Associates"));

  // An unheld engagement: ERASE really destroys through DOC06 — unless a hold
  // lands between review and action.
  console.log("\n  CONTROL — without a hold, erasure goes through DOC06; a hold placed after review still binds");
  const docX = await file(company.id, client.id, openEngagement.id, "old-gst-workings", article.id);
  const docY = await file(company.id, client.id, openEngagement.id, "old-gst-invoices", article.id);
  await createRetentionPolicy({ actorUserId: partner.id, practiceId: company.id, input: { recordClass: "SCRATCH", direction: "RETAIN_AT_LEAST", trigger: "CREATED", retainYears: 1, basis: "Fictional short schedule", covers: ["ORIGINAL"], effectiveFrom: from } });
  for (const doc of [docX, docY]) {
    await applyRetention({ actorUserId: partner.id, practiceId: company.id, documentId: doc.document.id, recordClass: "SCRATCH", from: d("2024-01-01") });
  }
  const openReq = await createErasureRequest({ actorUserId: partner.id, practiceId: company.id, engagementId: openEngagement.id, receivedVia: "Email (fictional)", requestText: "Erase these files" });
  check("with no hold and the floor passed, the documents are erasable", openReq.items.filter((i) => i.kind === "DOCUMENT").every((i) => i.mustRetainReason === null));
  await reviewErasureRequest({
    actorUserId: partner2.id, practiceId: company.id, requestId: openReq.id, expectedVersion: 1,
    decisions: openReq.items.map((i) => ({ itemId: i.id, decision: i.kind === "DOCUMENT" ? ("ERASE" as const) : ("RETAIN" as const), reason: i.kind === "DOCUMENT" ? "Retention passed, no longer needed" : "Audit evidence retained" })),
  });
  await placeLegalHold({ actorUserId: partner.id, practiceId: company.id, documentId: docY.document.id, reason: "Fictional dispute raised after review" });
  const openDone = await actionErasureRequest({ actorUserId: partner2.id, practiceId: company.id, requestId: openReq.id, expectedVersion: 2 });
  const xVersions = await prisma.documentVersion.findMany({ where: { documentId: docX.document.id } });
  const yVersions = await prisma.documentVersion.findMany({ where: { documentId: docY.document.id } });
  check("the unheld document's bytes are destroyed", (await Promise.all(xVersions.map((v) => getObject(v.storageObjectId)))).every((b) => b === null));
  check("...through the DOC06 pipeline (an executed deletion request exists)", (await prisma.deletionRequest.count({ where: { documentId: docX.document.id, state: "EXECUTED" } })) === 1);
  check("the document held AFTER review was not destroyed", (await Promise.all(yVersions.map((v) => getObject(v.storageObjectId)))).every((b) => b !== null));
  const yItem = openDone.items.find((i) => i.targetId === docY.document.id)!;
  check("...and says why: it became subject to a hold after review", yItem.decision === "RETAIN" && /since review/i.test(yItem.reason ?? ""), yItem.reason ?? "");
  check("that request is PARTIALLY actioned too", openDone.state === "PARTIALLY_ACTIONED");

  // ====================================================== EVIDENCE: clocks
  console.log("\n  EVIDENCE — incident screen: awareness time and independent clocks, root cause unknown");

  const awareness = new Date(Date.now() - 2 * HOUR);
  const incident = await reportIncident({
    actorUserId: article.id, practiceId: company.id, track: "SECURITY", awarenessAt: awareness,
    title: "Suspicious sign-in from unknown device (fictional)", summary: "Staff noticed a login they did not make",
  });
  check("an article CAN report an incident — the clock must not wait for a partner", incident.reportedByUserId === article.id);
  const articleView = await throws(() => getIncident(article.id, company.id, incident.id), PermissionDeniedError);
  check("...but cannot open the incident record", !!articleView);
  const outsiderView = await throws(() => getIncident(outsider.id, company.id, incident.id), PracticeAccessError);
  check("the other practice cannot see it at all (not found)", !!outsiderView);

  const view = await getIncident(partner.id, company.id, incident.id);
  const cert = view.clocks.find((c) => c.regime === "CERT_IN_6H")!;
  check("EVIDENCE: the screen shows the awareness time as recorded", view.awarenessAt.getTime() === awareness.getTime());
  check("EVIDENCE: root cause is still UNKNOWN", view.rootCause === "UNKNOWN");
  check(`EVIDENCE: the CERT-In clock is due ${CERT_IN_HOURS} h after AWARENESS`, cert.dueAt?.getTime() === awareness.getTime() + CERT_IN_HOURS * HOUR);
  check("EVIDENCE: it is RUNNING while applicability is still being assessed", cert.state === "RUNNING_ASSESSMENT_PENDING", cert.state);
  const dpdp = view.clocks.filter((c) => c.regime.startsWith("DPDP"));
  check("EVIDENCE: three DPDP clocks are shown as separate rows", dpdp.length === 3);
  check("EVIDENCE: they are NOT_OPERATIVE, per the register (Prospective)", dpdp.every((c) => c.state === "NOT_OPERATIVE" && /PROSPECTIVE/.test(c.explanation)));
  check("EVIDENCE: the CERT-In clock runs regardless — the regimes are independent", cert.state !== dpdp[0].state);

  await updateRootCause({ actorUserId: itAdmin.id, practiceId: company.id, incidentId: incident.id, expectedVersion: 1, rootCause: "INVESTIGATING" });
  const afterRoot = await getIncident(partner.id, company.id, incident.id);
  check("changing the root cause status moves no clock", afterRoot.clocks.find((c) => c.regime === "CERT_IN_6H")!.dueAt?.getTime() === cert.dueAt?.getTime());

  await assessCertIn({ actorUserId: itAdmin.id, practiceId: company.id, incidentId: incident.id, expectedVersion: 2, applicable: true, category: "Unauthorised access to IT systems (fictional list)", reason: "Credential misuse suspected" });
  const assessed = await getIncident(partner.id, company.id, incident.id);
  check("IT can assess CERT-In applicability; the clock then RUNS plainly", assessed.clocks.find((c) => c.regime === "CERT_IN_6H")!.state === "RUNNING");
  check("the assessment is audited", (await prisma.event.count({ where: { action: "INCIDENT_CERT_IN_ASSESSED", targetId: incident.id } })) === 1);

  const later = await throws(
    () => reviseAwareness({ actorUserId: partner.id, practiceId: company.id, incidentId: incident.id, expectedVersion: 3, newAwarenessAt: new Date(awareness.getTime() + HOUR), reason: "Typo" }),
    PrivacyError,
  );
  check("awareness cannot be moved LATER — that would extend the deadline", later?.code === "AWARENESS_ONLY_EARLIER", later?.code);
  const earlier = new Date(awareness.getTime() - HOUR);
  await reviseAwareness({ actorUserId: partner.id, practiceId: company.id, incidentId: incident.id, expectedVersion: 3, newAwarenessAt: earlier, reason: "Log shows the alert was seen an hour earlier" });
  const revised = await getIncident(partner.id, company.id, incident.id);
  check("an EARLIER correction moves the deadline earlier", revised.clocks.find((c) => c.regime === "CERT_IN_6H")!.dueAt?.getTime() === earlier.getTime() + CERT_IN_HOURS * HOUR);
  check("...and the original awareness time is kept as a revision", revised.awarenessRevisions.length === 1 && revised.awarenessRevisions[0].previousAwarenessAt.getTime() === awareness.getTime());

  const noRef = await throws(
    () => recordIncidentReport({ actorUserId: itAdmin.id, practiceId: company.id, incidentId: incident.id, regime: "CERT_IN_6H", reportedAt: new Date(), reference: " " }),
    PrivacyError,
  );
  check("a report without the authority's reference is refused", noRef?.code === "REFERENCE_REQUIRED", noRef?.code);
  await recordIncidentReport({ actorUserId: itAdmin.id, practiceId: company.id, incidentId: incident.id, regime: "CERT_IN_6H", reportedAt: new Date(), reference: "FICT-ACK-001" });
  const met = await getIncident(partner.id, company.id, incident.id);
  check("a report inside 6 h reads MET — derived from the report, not a flag", met.clocks.find((c) => c.regime === "CERT_IN_6H")!.state === "MET");
  const dup = await throws(
    () => recordIncidentReport({ actorUserId: itAdmin.id, practiceId: company.id, incidentId: incident.id, regime: "CERT_IN_6H", reportedAt: new Date(), reference: "again" }),
    PrivacyError,
  );
  check("a second report for the same regime is refused", dup?.code === "ALREADY_REPORTED", dup?.code);

  // Overdue and late.
  const old = await reportIncident({ actorUserId: partner.id, practiceId: company.id, track: "SECURITY", awarenessAt: new Date(Date.now() - 9 * HOUR), title: "Malware alert (fictional)", summary: "Endpoint alert" });
  const overdue = await getIncident(partner.id, company.id, old.id);
  check("unreported past 6 h with the assessment still pending reads OVERDUE, and says so", overdue.clocks[0].state === "OVERDUE" && /STILL being assessed/.test(overdue.clocks[0].explanation));
  await recordIncidentReport({ actorUserId: partner.id, practiceId: company.id, incidentId: old.id, regime: "CERT_IN_6H", reportedAt: new Date(Date.now() - 1 * HOUR), reference: "FICT-ACK-002" });
  const late = await getIncident(partner.id, company.id, old.id);
  check("a report made after the deadline reads LATE, not MET", late.clocks[0].state === "LATE");

  const notApplicable = await reportIncident({ actorUserId: partner.id, practiceId: company.id, track: "SECURITY", awarenessAt: new Date(Date.now() - HOUR), title: "Lost unencrypted USB (fictional)", summary: "Staff lost a drive" });
  await assessCertIn({ actorUserId: partner.id, practiceId: company.id, incidentId: notApplicable.id, expectedVersion: 1, applicable: false, reason: "Not a specified cyber incident (fictional assessment)" });
  const naView = await getIncident(partner.id, company.id, notApplicable.id);
  check("CERT-In NOT_APPLICABLE shows its reason", naView.clocks[0].state === "NOT_APPLICABLE" && /specified/.test(naView.clocks[0].explanation));
  check("...while the DPDP clocks are still shown, independently", naView.clocks.filter((c) => c.regime.startsWith("DPDP")).length === 3);

  const routine = await reportIncident({ actorUserId: article.id, practiceId: company.id, track: "ROUTINE_SUPPORT", awarenessAt: new Date(), title: "Printer offline (fictional)", summary: "Cannot print" });
  const routineView = await getIncident(partner.id, company.id, routine.id);
  check("a routine support incident carries NO regulatory clock", routineView.clocks.length === 0);
  const routineAssess = await throws(
    () => assessCertIn({ actorUserId: partner.id, practiceId: company.id, incidentId: routine.id, expectedVersion: 1, applicable: true, category: "x", reason: "x" }),
    PrivacyError,
  );
  check("...and cannot be given a CERT-In assessment without reclassifying", routineAssess?.code === "NOT_A_SECURITY_INCIDENT", routineAssess?.code);

  // The other practice: DPDP not tracked, then tracked as operative.
  const assocIncident = await reportIncident({ actorUserId: outsider.id, practiceId: associates.id, track: "SECURITY", awarenessAt: new Date(Date.now() - HOUR), title: "Phishing (fictional)", summary: "Staff clicked a link" });
  const assocView = await getIncident(outsider.id, associates.id, assocIncident.id);
  check("where DPDP is not in the register the clocks read NOT_TRACKED (unknown), not 'not applicable'", assocView.clocks.filter((c) => c.regime.startsWith("DPDP")).every((c) => c.state === "NOT_TRACKED"));
  await recordRegulatoryRequirement({
    actorUserId: outsider.id, practiceId: associates.id, reason: "Fictional operative entry", now: d("2025-01-02"),
    input: { code: DPDP_BREACH_CODE, title: "Breach intimation (fictional)", instrument: "Fictional rules", state: "OPERATIONAL", sourceReference: "Fictional order", sourceDate: d("2025-01-01"), effectiveFrom: d("2025-01-01"), effectiveRule: "Intimate" },
  });
  const operative = await incidentClocks({ ...assocView, reports: [] });
  const detailed = operative.find((c) => c.regime === "DPDP_BOARD_DETAILED_72H")!;
  check("with the duty operative, the detailed Board clock is 72 h from awareness", detailed.dueAt?.getTime() === assocView.awarenessAt.getTime() + 72 * HOUR && detailed.state === "RUNNING");
  check("...and the 'without delay' duties show as such rather than inventing a deadline", operative.filter((c) => c.state === "WITHOUT_DELAY").length === 2);
  check("the CERT-In clock is unaffected by the DPDP change", operative[0].dueAt?.getTime() === assocView.clocks[0].dueAt?.getTime());

  console.log(`\n${passed} passed, ${failed} failed\n`);
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
