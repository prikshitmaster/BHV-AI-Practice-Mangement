/**
 * T18 acceptance test — BCP01-04, BCP06 (PRD §37). BCP05 (export and vendor
 * exit) is R1 and not covered.
 *
 * PRD acceptance evidence, verbatim:
 *   "Restore a synthetic production copy into an isolated environment with
 *    external sending disabled. Verify a random sample of original and signed
 *    file hashes, permissions, active obligations and receipt balances. Report
 *    measured RPO / RTO rather than a successful backup job alone."
 *
 * The EVIDENCE section drives the real backup and restore engines end to end:
 * a fictional practice is built through the real libraries (invoice issued,
 * receipt allocated, documents filed into MinIO and a deliverable approved),
 * backed up to disk, CHANGED afterwards (a user suspended, a legal hold
 * placed), and restored from the OFFSITE copy into the isolated drill
 * database, which is then read directly and compared with live.
 *
 * Every safeguard is paired with a CONTROL, so no assertion can pass with the
 * mechanism switched off.
 *
 * Needs: Postgres, MinIO and Redis up (`docker compose up -d db minio redis`),
 * BACKUP_ENCRYPTION_KEY and RESTORE_TARGET_DATABASE_URL in .env. No HTTP
 * server. All fixture data is fictional. Run: npm run test:t18
 */

import "dotenv/config";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  backupEncryptionKey,
  keyFingerprint,
  readArtifact,
  recoveryPosture,
  runBackup,
  type BackupResult,
} from "../src/lib/backup";
import {
  assertRestoreTargetSafe,
  releaseOutboundHold,
  RestoreSafetyError,
  runRestore,
  OutboundHoldError,
  type RestoreResult,
} from "../src/lib/restore";
import { dispatchOutbox } from "../src/lib/outbox";
import { ExternalSendingDisabledError } from "../src/lib/external-sending";
import {
  ContinuityError,
  csvCell,
  emergencyObligationExport,
  localFunctionAvailability,
  probeServices,
  recordDowntimeWork,
  reconcileDowntimeWork,
  reportServiceState,
  serviceStatusBoard,
  STATUS_STALE_AFTER_MS,
  unreconciledDowntimeWork,
} from "../src/lib/continuity";
import {
  closeRemediation,
  drillSchedule,
  productionDrillGate,
  runDrill,
} from "../src/lib/drills";
import { PracticeAccessError } from "../src/lib/practice-scope";
import { PermissionDeniedError } from "../src/lib/permissions";
import { VersionConflictError } from "../src/lib/concurrency";
import {
  activateRule,
  createObligationInstance,
  createObligationRule,
  markFiled,
  reviewRule,
} from "../src/lib/statutory-calendar";
import {
  approveInvoice,
  createInvoiceSeries,
  draftInvoice,
  issueInvoice,
} from "../src/lib/invoicing";
import { allocateReceipt, recordReceipt } from "../src/lib/receipts";
import { receiveUpload, setMalwareScanner } from "../src/lib/document-intake";
import { approveVersion, fileUpload, placeLegalHold } from "../src/lib/documents";
import { ensureBucket, sha256Hex } from "../src/lib/object-store";
import { suspendUser } from "../src/lib/user-lifecycle";

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

async function caught(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}

const RUN = Date.now();
const tag = (s: string) => `${s}-${RUN}`;
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const sum = (xs: { amount: unknown }[]) =>
  xs.reduce((acc, x) => acc + Math.round(Number(String(x.amount)) * 100), 0);

async function main() {
  console.log("\nT18 — backup, restore, continuity and drills (PRD §37)\n");

  const targetUrl = process.env.RESTORE_TARGET_DATABASE_URL;
  if (!targetUrl) throw new Error("RESTORE_TARGET_DATABASE_URL must be set for T18.");
  backupEncryptionKey(); // fail fast, with the engine's own message, if the key is missing

  const workRoot = path.join(os.tmpdir(), `bhv-t18-${RUN}`);
  const primaryRoot = path.join(workRoot, "primary");
  const offsiteRoot = path.join(workRoot, "offsite");

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
  const company = await makePractice("Fictional Company LLP", "t18co");
  const associates = await makePractice("Fictional Associates", "t18as");

  async function makeUser(label: string) {
    return prisma.user.create({
      data: { email: `${label}-${RUN}@example.invalid`, fullName: `Fictional ${label} ${RUN}`, status: "ACTIVE" },
    });
  }
  const partner = await makeUser("Partner");
  const reviewer = await makeUser("Reviewer");
  const manager = await makeUser("Manager");
  const biller = await makeUser("Biller");
  const article = await makeUser("Article");
  const outsider = await makeUser("Outsider");
  const itAdmin = await makeUser("ITAdmin");
  const leaver = await makeUser("Leaver");

  const from = d("2024-04-01");
  await prisma.practiceMembership.createMany({
    data: [
      { practiceId: company.id, userId: partner.id, role: "PRACTICE_PARTNER", assignmentScope: "PRACTICE", effectiveFrom: from },
      { practiceId: company.id, userId: reviewer.id, role: "REVIEWER", assignmentScope: "PRACTICE", effectiveFrom: from },
      // ASSIGNED_ENGAGEMENTS: an emergency export must not widen this to the practice.
      { practiceId: company.id, userId: manager.id, role: "MANAGER", assignmentScope: "ASSIGNED_ENGAGEMENTS", effectiveFrom: from },
      { practiceId: company.id, userId: biller.id, role: "FINANCE", assignmentScope: "PRACTICE", effectiveFrom: from },
      { practiceId: company.id, userId: article.id, role: "STAFF_ARTICLE", assignmentScope: "OWN_WORK", effectiveFrom: from },
      { practiceId: associates.id, userId: outsider.id, role: "PRACTICE_PARTNER", assignmentScope: "PRACTICE", effectiveFrom: from },
      { practiceId: company.id, userId: itAdmin.id, role: "IT_ADMIN", assignmentScope: "PRACTICE", effectiveFrom: from },
      { practiceId: company.id, userId: leaver.id, role: "MANAGER", assignmentScope: "PRACTICE", effectiveFrom: from },
    ],
  });

  const party = await prisma.party.create({
    data: { tenantId: tenant.id, legalName: tag("Fictional Client Private Limited"), type: "COMPANY" },
  });
  // A legal name a spreadsheet would execute. The export must neutralise it.
  const hostileParty = await prisma.party.create({
    data: { tenantId: tenant.id, legalName: `=HYPERLINK("https://example.invalid")-${RUN}`, type: "COMPANY" },
  });
  const client = await prisma.clientRelationship.create({
    data: { practiceId: company.id, partyId: party.id, acceptanceStatus: "ACCEPTED" },
  });
  const hostileClient = await prisma.clientRelationship.create({
    data: { practiceId: company.id, partyId: hostileParty.id, acceptanceStatus: "ACCEPTED" },
  });
  const assocClient = await prisma.clientRelationship.create({
    data: { practiceId: associates.id, partyId: party.id, acceptanceStatus: "ACCEPTED" },
  });

  async function makeEngagement(practiceId: string, clientRelationshipId: string, ownerUserId: string) {
    return prisma.engagement.create({
      data: {
        practiceId,
        clientRelationshipId,
        serviceCode: "GST_ANNUAL",
        templateVersion: "1",
        periodStart: d("2025-04-01"),
        periodEnd: d("2026-03-31"),
        state: "ACTIVE",
        ownerUserId,
      },
    });
  }
  const managersEngagement = await makeEngagement(company.id, client.id, manager.id);
  const partnersEngagement = await makeEngagement(company.id, hostileClient.id, partner.id);
  const assocEngagement = await makeEngagement(associates.id, assocClient.id, outsider.id);

  // Obligations: open (manager's), review-required (partner's), filed, and one
  // in the OTHER practice.
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

  const obligation = (practiceId: string, clientRelationshipId: string, engagementId: string, periodKey: string) =>
    createObligationInstance({
      practiceId,
      clientRelationshipId,
      engagementId,
      ruleId: rule.id,
      periodKey,
      statutoryDate: d("2026-12-31"),
      taxpayerCategory: "AUDIT_CASE",
      formVersion: "GSTR-9",
      governingLaw: "CGST_ACT_2017",
    });
  const openOb = await obligation(company.id, client.id, managersEngagement.id, "FY2025-26");
  const reviewOb = await obligation(company.id, hostileClient.id, partnersEngagement.id, "FY2025-26");
  await prisma.obligation.update({
    where: { id: reviewOb.id },
    // An extended obligation, so the export has to show both dates.
    data: { status: "REVIEW_REQUIRED", currentStatutoryDate: d("2027-01-31"), internalTargetDate: d("2026-12-15") },
  });
  const filedOb = await obligation(company.id, client.id, managersEngagement.id, "FY2024-25");
  await markFiled({
    obligationId: filedOb.id,
    practiceId: company.id,
    acknowledgementReference: `ACK-${RUN}`,
    filedAt: d("2026-09-01"),
    reviewerName: "Fictional Reviewer",
  });
  const assocOb = await obligation(associates.id, assocClient.id, assocEngagement.id, "FY2025-26");

  // Billing: an issued invoice, a part payment and a TDS deduction.
  const series = await createInvoiceSeries({
    userId: biller.id,
    practiceId: company.id,
    code: "T18",
    fiscalPeriod: "2025-26",
    numberFormat: "{code}/{fiscalPeriod}/{number}",
    startAt: 1,
  });
  const invoice = await draftInvoice({
    userId: biller.id,
    practiceId: company.id,
    seriesId: series.id,
    clientRelationshipId: client.id,
    engagementId: managersEngagement.id,
    lines: [{ description: "Fictional professional fees", quantity: 1, unitAmount: 25000 }],
    dueDate: d("2026-10-31"),
  });
  const approved = await approveInvoice({
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
    expectedVersion: approved.version,
    issueDate: d("2026-09-01"),
  });
  const bank = await prisma.practiceBankAccount.create({
    data: {
      practiceId: company.id,
      label: "Current account",
      bankName: "Fictional Bank",
      accountNumber: "0000000000",
      ifsc: "FAKE0000000",
      effectiveFrom: from,
      verifiedAt: new Date(),
      verifiedBy: "Fictional Partner",
    },
  });
  const receipt = await recordReceipt({
    userId: biller.id,
    practiceId: company.id,
    clientRelationshipId: client.id,
    bankAccountId: bank.id,
    amount: 10000,
    receivedAt: d("2026-09-05"),
    method: "BANK_TRANSFER",
    reference: `REF-${RUN}`,
  });
  await allocateReceipt({
    userId: biller.id,
    practiceId: company.id,
    receiptId: receipt.id,
    invoiceId: issued.id,
    kind: "PAYMENT",
    amount: 10000,
  });
  await allocateReceipt({ userId: biller.id, practiceId: company.id, invoiceId: issued.id, kind: "TDS", amount: 2500 });

  // Documents: a client-supplied original, and a deliverable a reviewer approves
  // (the "signed" file of the PRD evidence).
  const pdf = (text: string) =>
    Buffer.from(`%PDF-1.7\n% fictional test document\n${text} ${RUN}\n%%EOF\n`, "latin1");
  const staffCtx = (userId: string) => ({
    actorUserId: userId,
    practiceId: company.id,
    clientRelationshipId: client.id,
    source: "STAFF_UPLOAD" as const,
  });
  const originalReceipt = await receiveUpload({
    ctx: staffCtx(article.id),
    body: pdf("purchase register"),
    filename: "purchase-register.pdf",
    declaredMimeType: "application/pdf",
  });
  const original = await fileUpload({
    actorUserId: article.id,
    practiceId: company.id,
    receipt: originalReceipt,
    filename: "purchase-register.pdf",
    clientRelationshipId: client.id,
    kind: "CLIENT_SUPPLIED",
  });
  const signedReceipt = await receiveUpload({
    ctx: staffCtx(article.id),
    body: pdf("signed audit report"),
    filename: "audit-report-signed.pdf",
    declaredMimeType: "application/pdf",
  });
  const signed = await fileUpload({
    actorUserId: article.id,
    practiceId: company.id,
    receipt: signedReceipt,
    filename: "audit-report-signed.pdf",
    clientRelationshipId: client.id,
    engagementId: managersEngagement.id,
    kind: "APPROVED_DELIVERABLE",
  });
  await approveVersion({ actorUserId: partner.id, practiceId: company.id, versionId: signed.version.id });

  // The leaver has a LIVE session and a queued export at backup time.
  const leaverSession = await prisma.session.create({
    data: {
      userId: leaver.id,
      tokenHash: sha256Hex(randomBytes(32)),
      idleExpiresAt: new Date(Date.now() + 30 * 60_000),
      absoluteExpiresAt: new Date(Date.now() + 12 * 3600_000),
      mfaVerifiedAt: new Date(),
    },
  });
  const leaverExport = await prisma.queuedJob.create({
    data: {
      practiceId: company.id,
      requestedByUserId: leaver.id,
      kind: "EXPORT",
      payload: { report: "fictional" },
      state: "QUEUED",
    },
  });

  // =================================================== BCP01 backup + gates
  console.log("BCP01 — what the backup takes, and under what key");

  const sendingFlag = process.env.EXTERNAL_SENDING_DISABLED;
  delete process.env.EXTERNAL_SENDING_DISABLED;

  const backup: BackupResult = await runBackup({
    includeObjectPayloads: true,
    createdByUserId: itAdmin.id,
    rootOverride: primaryRoot,
    offsiteOverride: offsiteRoot,
  });
  check(
    "the backup holds database rows, audit events, object manifest, configuration, templates and a key inventory",
    ["DATABASE_ROWS", "AUDIT_EVENTS", "OBJECT_MANIFEST", "CONFIGURATION", "TEMPLATE", "KEY_INVENTORY"].every((k) =>
      backup.artifacts.some((a) => a.kind === k),
    ),
    backup.artifacts.map((a) => a.kind).join(","),
  );
  check("the backup has a copy in a separate failure domain", !!backup.offsiteDirectory);
  const inventory = JSON.parse(
    (await readArtifact(backup.backupRunId, "KEY_INVENTORY", "key-inventory.json")).body.toString("utf8"),
  );
  const inventoryText = JSON.stringify(inventory);
  check(
    "the key inventory names keys by fingerprint and holds NO key material",
    inventory.keys.every((k: { fingerprint: string | null }) => !k.fingerprint || k.fingerprint.length === 16) &&
      !inventoryText.includes(process.env.BACKUP_ENCRYPTION_KEY as string) &&
      !inventoryText.includes(process.env.APP_ENCRYPTION_KEY as string),
  );
  const rawArchive = await fs.readFile(
    path.join(primaryRoot, backup.backupRunId, "database-rows.ndjson.enc"),
  );
  check(
    "the archive on disk is ciphertext — a fixture client name is not readable in it",
    !rawArchive.includes(Buffer.from(tag("Fictional Client Private Limited"))),
  );

  // ============================================ changes made AFTER the backup
  await new Promise((r) => setTimeout(r, 1100));
  await suspendUser({ userId: leaver.id, reason: "Left the firm (fictional)", actorUserId: partner.id, actorName: "Fictional Partner" });
  const hold = await placeLegalHold({
    actorUserId: partner.id,
    practiceId: company.id,
    reason: "Fictional regulatory enquiry",
    documentId: original.document.id,
  });
  const liveLeaverAfter = await prisma.session.findUnique({ where: { id: leaverSession.id } });
  check("CONTROL — the leaver's session really was revoked on live after the backup", !!liveLeaverAfter?.revokedAt);

  // ======================================================== BCP03 restore
  console.log("\n  EVIDENCE — restore into an isolated environment with external sending disabled");

  const restoreRunsBefore = await prisma.restoreRun.count();
  const unsafe = await caught(() => runRestore({ backupRunId: backup.backupRunId, source: "offsite" }));
  check(
    "EVIDENCE: with external sending ENABLED the restore refuses to start",
    unsafe instanceof RestoreSafetyError && /EXTERNAL_SENDING_DISABLED/.test((unsafe as Error).message),
    String(unsafe),
  );
  check("…and refuses before writing anything (no restore run recorded)", (await prisma.restoreRun.count()) === restoreRunsBefore);

  process.env.EXTERNAL_SENDING_DISABLED = "1";
  const intoLive = await caught(async () => assertRestoreTargetSafe(process.env.DATABASE_URL));
  check("a restore INTO the live database is refused outright", intoLive instanceof RestoreSafetyError);
  check(
    "CONTROL — the isolated target passes the same gate",
    (await caught(async () => assertRestoreTargetSafe(targetUrl))) === null,
  );

  const outboxRefusal = await caught(() => dispatchOutbox({ consumers: [] }));
  check(
    "with sending disabled, the outbox dispatcher refuses outright",
    outboxRefusal instanceof ExternalSendingDisabledError,
    String(outboxRefusal),
  );

  const restore: RestoreResult = await runRestore({
    backupRunId: backup.backupRunId,
    source: "offsite",
    targetLabel: "t18-acceptance",
    performedByUserId: itAdmin.id,
    objectHashSampleSize: 10,
  });
  const failedChecks = restore.checks.filter((c) => !c.passed);
  check(
    "EVIDENCE: every reconciliation check passes",
    restore.reconciled && failedChecks.length === 0,
    failedChecks.map((c) => `${c.subject}: ${c.actual}`).join(" | "),
  );
  for (const category of ["OBJECT_HASH", "PERMISSION", "OBLIGATION", "RECEIPT_BALANCE", "OUTBOUND_HOLD", "AUDIT_CHAIN"]) {
    check(`the ${category} reconciliation actually ran`, restore.checks.some((c) => c.category === category));
  }

  const target = new PrismaClient({ adapter: new PrismaPg({ connectionString: targetUrl }) });
  try {
    // --- original and signed file hashes
    for (const [label, filed] of [["original", original], ["signed deliverable", signed]] as const) {
      const restoredVersion = await target.documentVersion.findUnique({ where: { id: filed.version.id } });
      const payload = await readArtifact(backup.backupRunId, "OBJECT_PAYLOAD", `objects/${filed.version.sha256}`, "offsite");
      check(
        `EVIDENCE: the ${label} file's hash survives — restored row, offsite bytes and live row all agree`,
        restoredVersion?.sha256 === filed.version.sha256 && sha256Hex(payload.body) === filed.version.sha256,
        `${restoredVersion?.sha256} / ${sha256Hex(payload.body)} / ${filed.version.sha256}`,
      );
    }
    const restoredSigned = await target.documentVersion.findUnique({ where: { id: signed.version.id } });
    check("the signed deliverable is restored still APPROVED", !!restoredSigned?.approvedAt);

    // --- permissions: decisions made AFTER the backup must survive the restore
    const restoredLeaver = await target.user.findUnique({ where: { id: leaver.id } });
    check(
      "EVIDENCE: a user suspended after the backup is still suspended after restore",
      restoredLeaver?.status === "SUSPENDED" && !!restoredLeaver?.suspendedAt,
      `status=${restoredLeaver?.status}`,
    );
    const restoredSession = await target.session.findUnique({ where: { id: leaverSession.id } });
    check(
      "EVIDENCE: their session, live in the archive, is REVOKED in the restored copy",
      !!restoredSession?.revokedAt,
      `revokedAt=${restoredSession?.revokedAt?.toISOString() ?? "null"}`,
    );
    const restoredMemberships = await target.practiceMembership.findMany({ where: { userId: leaver.id } });
    check(
      "their practice membership is revoked in the restored copy",
      restoredMemberships.length > 0 && restoredMemberships.every((m) => !!m.revokedAt),
    );
    const restoredExport = await target.queuedJob.findUnique({ where: { id: leaverExport.id } });
    check(
      "their export, QUEUED in the archive, cannot run from the restored copy",
      restoredExport?.state === "CANCELLED",
      `state=${restoredExport?.state}`,
    );
    const restoredPartner = await target.user.findUnique({ where: { id: partner.id } });
    check("CONTROL — an unaffected user is restored ACTIVE", restoredPartner?.status === "ACTIVE");
    const restoredHold = await target.legalHold.findUnique({ where: { id: hold.id } });
    check("a legal hold placed after the backup is present after restore", !!restoredHold && !restoredHold.releasedAt);

    // --- active obligations
    const liveOpen = await prisma.obligation.findMany({
      where: { practiceId: company.id, status: { notIn: ["FILED", "NOT_APPLICABLE", "CANCELLED"] } },
      orderBy: { id: "asc" },
      select: { id: true, status: true, currentStatutoryDate: true },
    });
    const restoredOpen = await target.obligation.findMany({
      where: { practiceId: company.id, status: { notIn: ["FILED", "NOT_APPLICABLE", "CANCELLED"] } },
      orderBy: { id: "asc" },
      select: { id: true, status: true, currentStatutoryDate: true },
    });
    check(
      "EVIDENCE: active obligations are restored with the same statuses and statutory dates",
      liveOpen.length === 2 && JSON.stringify(liveOpen) === JSON.stringify(restoredOpen),
      `${liveOpen.length} vs ${restoredOpen.length}`,
    );

    // --- receipt balances, in paise, never through a float total
    const liveAlloc = await prisma.receiptAllocation.findMany({ where: { invoiceId: issued.id } });
    const restoredAlloc = await target.receiptAllocation.findMany({ where: { invoiceId: issued.id } });
    check(
      "EVIDENCE: receipt balances match — part payment and TDS both restored distinctly",
      sum(liveAlloc) === 1250000 &&
        sum(restoredAlloc) === sum(liveAlloc) &&
        restoredAlloc.map((a) => a.kind).sort().join(",") === "PAYMENT,TDS",
      `${sum(liveAlloc)} vs ${sum(restoredAlloc)}`,
    );

    // --- history cannot resend
    const issuedEvent = await prisma.outboxEvent.findFirst({
      where: { subjectId: issued.id, eventType: "INVOICE_ISSUED" },
    });
    const restoredEvent = issuedEvent
      ? await target.outboxEvent.findUnique({ where: { id: issuedEvent.id } })
      : null;
    check(
      "the invoice-issued event, pending at backup time, is HELD in the restored copy, not re-sent",
      issuedEvent?.state === "PENDING" && restoredEvent?.state === "HELD_RESTORE_RECONCILIATION",
      `live=${issuedEvent?.state} restored=${restoredEvent?.state}`,
    );
  } finally {
    await target.$disconnect();
  }

  // --- BCP02: measured, not assumed
  console.log("\n  EVIDENCE — measured RPO / RTO, not a successful backup job");
  const run = await prisma.restoreRun.findUniqueOrThrow({ where: { id: restore.restoreRunId } });
  check(
    "EVIDENCE: the restore run records a MEASURED RPO and RTO against the 1h / 8h targets",
    run.measuredRpoSeconds !== null &&
      run.measuredRtoSeconds !== null &&
      run.rpoTargetSeconds === 3600 &&
      run.rtoTargetSeconds === 28800 &&
      run.targetsMet === (run.measuredRpoSeconds <= 3600 && run.measuredRtoSeconds <= 28800),
    `rpo=${run.measuredRpoSeconds} rto=${run.measuredRtoSeconds} met=${run.targetsMet}`,
  );
  const posture = await recoveryPosture();
  check(
    "recovery posture reports THIS restore's measured time, not an estimate",
    posture.lastMeasuredRtoSeconds === run.measuredRtoSeconds && posture.rtoWithinTarget !== null,
    `${posture.lastMeasuredRtoSeconds} vs ${run.measuredRtoSeconds}`,
  );
  check(
    "the outbound hold is still ON after a successful restore — release is a separate human act",
    run.outboundReleasedAt === null && run.quarantinedOutboundCount >= 0,
  );

  // --- hold release
  const stale = await caught(() =>
    releaseOutboundHold({ restoreRunId: run.id, releasedByUserId: itAdmin.id, reason: "reconciled", expectedVersion: run.version - 1 }),
  );
  check("releasing the hold against a stale version is refused", stale instanceof OutboundHoldError);
  const released = await releaseOutboundHold({
    restoreRunId: run.id,
    releasedByUserId: itAdmin.id,
    reason: "Reconciliation reviewed (fictional)",
    expectedVersion: run.version,
  });
  check("CONTROL — the same release at the current version succeeds", !!released.releasedAt);
  const failedRun = await prisma.restoreRun.create({
    data: {
      backupRunId: backup.backupRunId,
      targetLabel: "t18-failed-control",
      isolated: true,
      externalSendingDisabled: true,
      dataAsOf: backup.dataAsOf,
      rpoTargetSeconds: 3600,
      rtoTargetSeconds: 28800,
      status: "HELD",
      checks: {
        create: [{ category: "RECEIPT_BALANCE", subject: "fictional mismatch", expected: "1", actual: "2", passed: false }],
      },
    },
  });
  const blocked = await caught(() =>
    releaseOutboundHold({ restoreRunId: failedRun.id, releasedByUserId: itAdmin.id, reason: "hurry", expectedVersion: failedRun.version }),
  );
  check("a restore with a failed reconciliation check cannot be released", blocked instanceof OutboundHoldError);

  // ========================================================= BCP04 status
  console.log("\nBCP04 — degraded status and what still works");

  const probe = await probeServices();
  check(
    "the database, object store and queue are MEASURED, and all three answer",
    ["DATABASE", "OBJECT_STORE", "QUEUE"].every((s) => probe.find((p) => p.service === s)?.state === "OPERATIONAL"),
    probe.map((p) => `${p.service}=${p.state}`).join(" "),
  );

  const redis = process.env.REDIS_URL;
  process.env.REDIS_URL = "redis://127.0.0.1:1";
  await probeServices();
  process.env.REDIS_URL = redis;
  const downBoard = await serviceStatusBoard();
  const queueDown = downBoard.find((b) => b.service === "QUEUE")!;
  check("an unreachable queue reads OFFLINE", queueDown.effectiveState === "OFFLINE", queueDown.effectiveState);
  const downFns = localFunctionAvailability(downBoard);
  check(
    "reminders are UNAVAILABLE while the queue is down…",
    downFns.find((f) => f.name.startsWith("Reminders"))?.availability === "UNAVAILABLE",
  );
  check(
    "…while work queues and client records stay AVAILABLE (BCP04 local functions)",
    downFns.find((f) => f.name.startsWith("Work queues"))?.availability === "AVAILABLE",
  );
  check("the guidance says what still works", !!queueDown.guidance && /still work/.test(queueDown.guidance));

  await probeServices();
  const upOnce = (await serviceStatusBoard()).find((b) => b.service === "QUEUE")!;
  await new Promise((r) => setTimeout(r, 50));
  await probeServices();
  const upTwice = (await serviceStatusBoard()).find((b) => b.service === "QUEUE")!;
  check(
    "`since` marks when the state BEGAN — a second healthy probe does not move it",
    upOnce.since?.getTime() === upTwice.since?.getTime() && upTwice.checkedAt! > upOnce.checkedAt!,
  );
  check("CONTROL — the recovery itself did move it", upOnce.since!.getTime() > queueDown.since!.getTime());

  const future = new Date(Date.now() + STATUS_STALE_AFTER_MS + 60_000);
  const staleDb = (await serviceStatusBoard(future)).find((b) => b.service === "DATABASE")!;
  check(
    "a status not re-checked for 15 minutes is shown UNKNOWN, not as its last good value",
    staleDb.recordedState === "OPERATIONAL" && staleDb.effectiveState === "UNKNOWN" && staleDb.stale,
  );

  const handSetDb = await caught(() =>
    reportServiceState({ actorUserId: itAdmin.id, service: "DATABASE", state: "OPERATIONAL", detail: "looks fine to me" }),
  );
  check(
    "a person cannot declare a probed service healthy",
    handSetDb instanceof ContinuityError && (handSetDb as ContinuityError).code === "SERVICE_IS_PROBED",
  );
  const byPartner = await caught(() =>
    reportServiceState({ actorUserId: partner.id, service: "EMAIL", state: "OFFLINE", detail: "provider outage" }),
  );
  check(
    "a partner without system administration cannot report service status",
    byPartner instanceof ContinuityError && (byPartner as ContinuityError).code === "PERMISSION_DENIED",
  );
  const emailBefore = (await serviceStatusBoard()).find((b) => b.service === "EMAIL")!;
  await reportServiceState({
    actorUserId: itAdmin.id,
    service: "EMAIL",
    state: "OFFLINE",
    detail: "Fictional provider outage reported by the provider status page",
  });
  const emailBoard = await serviceStatusBoard();
  const email = emailBoard.find((b) => b.service === "EMAIL")!;
  check("CONTROL — an administrator CAN report the email outage", email.effectiveState === "OFFLINE");
  check(
    "an email outage makes reminders unavailable, and says to telephone instead",
    localFunctionAvailability(emailBoard).find((f) => f.name.startsWith("Reminders"))?.availability ===
      "UNAVAILABLE" && /telephone/i.test(email.guidance ?? ""),
  );
  const stateEvent = await prisma.event.findFirst({
    where: { action: "SERVICE_STATE_CHANGED", targetId: "EMAIL", actorUserId: itAdmin.id },
    orderBy: { createdAt: "desc" },
  });
  check("the change of state is on the audit trail with who reported it", !!stateEvent);
  await reportServiceState({
    actorUserId: itAdmin.id,
    service: "EMAIL",
    state: emailBefore.recordedState,
    detail: "T18 test: restored to the state it was in before the test",
  });

  // ============================================ BCP04 emergency export
  console.log("\nBCP04 — controlled emergency obligation export");

  const partnerSession = await prisma.session.create({
    data: {
      userId: partner.id,
      tokenHash: sha256Hex(randomBytes(32)),
      idleExpiresAt: new Date(Date.now() + 30 * 60_000),
      absoluteExpiresAt: new Date(Date.now() + 12 * 3600_000),
      mfaVerifiedAt: new Date(),
    },
  });
  const exportArgs = { actorUserId: partner.id, sessionId: partnerSession.id, practiceId: company.id, reason: "Fictional server outage drill" };

  const noStepUp = await caught(() => emergencyObligationExport(exportArgs));
  check(
    "without a fresh MFA step-up the export is refused",
    noStepUp instanceof ContinuityError && (noStepUp as ContinuityError).code === "STEP_UP_REQUIRED",
  );
  await prisma.stepUpChallenge.create({
    data: { sessionId: partnerSession.id, purpose: "EXPORT", satisfiedAt: new Date(), expiresAt: new Date(Date.now() + 5 * 60_000) },
  });

  const managerSession = await prisma.session.create({
    data: {
      userId: manager.id,
      tokenHash: sha256Hex(randomBytes(32)),
      idleExpiresAt: new Date(Date.now() + 30 * 60_000),
      absoluteExpiresAt: new Date(Date.now() + 12 * 3600_000),
    },
  });
  const borrowed = await caught(() =>
    emergencyObligationExport({ ...exportArgs, actorUserId: manager.id, sessionId: partnerSession.id }),
  );
  check(
    "someone else's step-up session cannot be borrowed",
    borrowed instanceof ContinuityError && (borrowed as ContinuityError).code === "STEP_UP_REQUIRED",
  );
  check(
    "an export with no stated reason is refused",
    (await caught(() => emergencyObligationExport({ ...exportArgs, reason: "  " }))) instanceof ContinuityError,
  );
  check(
    "an article (no export.run) is refused",
    (await caught(() => emergencyObligationExport({ ...exportArgs, actorUserId: article.id }))) instanceof
      PermissionDeniedError,
  );
  check(
    "a partner of the OTHER practice is refused as not-found",
    (await caught(() => emergencyObligationExport({ ...exportArgs, actorUserId: outsider.id }))) instanceof
      PracticeAccessError,
  );

  const exp = await emergencyObligationExport(exportArgs);
  const lines = exp.csv.trimEnd().split("\r\n");
  const header = lines[0].split(",");
  check(
    "CONTROL — with step-up, the partner's export succeeds",
    exp.rowCount === 2 && lines.length === 3,
    `${exp.rowCount} rows`,
  );
  check(
    "only OPEN obligations are listed — the filed one is not",
    exp.csv.includes(openOb.id) && exp.csv.includes(reviewOb.id) && !exp.csv.includes(filedOb.id),
  );
  check("nothing from the other practice appears", !exp.csv.includes(assocOb.id));
  check(
    "the six DUE02 dates are separate, labelled columns",
    [
      "original_statutory_date",
      "current_statutory_date",
      "payment_deadline",
      "client_document_cutoff",
      "internal_target_date",
      "review_target_date",
    ].every((c) => header.includes(c)),
  );
  const reviewLine = lines.find((l) => l.includes(reviewOb.id)) ?? "";
  check(
    "an extended obligation shows BOTH its original and current statutory date",
    reviewLine.includes('"2026-12-31"') && reviewLine.includes('"2027-01-31"') && reviewLine.includes('"REVIEW_REQUIRED"'),
    reviewLine,
  );
  check(
    "a legal name beginning with = is neutralised so a spreadsheet will not execute it",
    reviewLine.includes(`"'=HYPERLINK(`) && !reviewLine.includes(`,"=HYPERLINK`),
  );
  check("csvCell CONTROL — an ordinary value is left alone", csvCell("Fictional Ltd") === '"Fictional Ltd"');
  check("the returned digest is the digest of the file", exp.sha256 === sha256Hex(exp.csv));
  const exportEvent = await prisma.event.findFirst({
    where: { action: "EXPORT_RUN", targetType: "EmergencyObligationExport", actorUserId: partner.id },
    orderBy: { createdAt: "desc" },
  });
  const exportMeta = JSON.stringify(exportEvent?.afterMeta ?? {});
  check(
    "the export is audited with its count, digest and reason — and not its contents",
    !!exportEvent &&
      exportMeta.includes(exp.sha256) &&
      exportEvent.reason === exportArgs.reason &&
      !exportMeta.includes(party.legalName),
  );
  const refusedEvent = await prisma.event.findFirst({
    where: { action: "EMERGENCY_OBLIGATION_EXPORT", result: "FAILURE", actorUserId: partner.id },
  });
  check("the refused attempt is on the audit trail too", !!refusedEvent);

  await prisma.stepUpChallenge.create({
    data: { sessionId: managerSession.id, purpose: "EXPORT", satisfiedAt: new Date(), expiresAt: new Date(Date.now() + 5 * 60_000) },
  });
  const managerExport = await emergencyObligationExport({ ...exportArgs, actorUserId: manager.id, sessionId: managerSession.id });
  check(
    "IAM03: a manager scoped to their own engagements exports only those — the file does not widen their scope",
    managerExport.rowCount === 1 && managerExport.csv.includes(openOb.id) && !managerExport.csv.includes(reviewOb.id),
    `${managerExport.rowCount} rows`,
  );

  // ================================================ BCP04 downtime work
  console.log("\nBCP04 — work done during downtime, recorded when the core returns");

  const job = await prisma.job.create({
    data: {
      practiceId: company.id,
      engagementId: managersEngagement.id,
      title: "Fictional GSTR-9 preparation",
      periodKey: "FY2025-26",
      dedupKey: tag("t18-job"),
      state: "IN_PROGRESS",
    },
  });
  const assocJob = await prisma.job.create({
    data: {
      practiceId: associates.id,
      engagementId: assocEngagement.id,
      title: "Fictional Associates job",
      periodKey: "FY2025-26",
      dedupKey: tag("t18-assoc-job"),
    },
  });
  const twoHoursAgo = new Date(Date.now() - 2 * 3600_000);

  const before = await prisma.downtimeWorkRecord.count({ where: { practiceId: company.id } });
  const mixed = await caught(() =>
    recordDowntimeWork({
      actorUserId: article.id,
      practiceId: company.id,
      entries: [
        { occurredAt: twoHoursAgo, description: "Reconciled purchase register on paper", jobId: job.id },
        { occurredAt: twoHoursAgo, description: "Looked at the other firm's job", jobId: assocJob.id },
      ],
    }),
  );
  check(
    "a sheet with one line pointing into the other practice is refused WHOLE, as not-found",
    mixed instanceof ContinuityError &&
      (mixed as ContinuityError).code === "JOB_NOT_FOUND" &&
      /Line 2/.test((mixed as Error).message),
    String(mixed),
  );
  check(
    "…and none of its lines were entered",
    (await prisma.downtimeWorkRecord.count({ where: { practiceId: company.id } })) === before,
  );
  check(
    "work cannot be dated in the future",
    (await caught(() =>
      recordDowntimeWork({
        actorUserId: article.id,
        practiceId: company.id,
        entries: [{ occurredAt: new Date(Date.now() + 3600_000), description: "Tomorrow's work" }],
      }),
    )) instanceof ContinuityError,
  );
  const sheet = await recordDowntimeWork({
    actorUserId: article.id,
    practiceId: company.id,
    entries: [
      { occurredAt: twoHoursAgo, description: "Reconciled purchase register on paper", jobId: job.id, service: "DATABASE" },
      { occurredAt: twoHoursAgo, description: "Called client about GSTR-9 figures", obligationId: openOb.id },
    ],
  });
  check("CONTROL — a valid sheet is entered", sheet.ids.length === 2);
  const rec = await prisma.downtimeWorkRecord.findUniqueOrThrow({ where: { id: sheet.ids[0] } });
  check(
    "a downtime record keeps WHEN the work happened apart from when it was typed in",
    rec.occurredAt.getTime() === twoHoursAgo.getTime() && rec.recordedAt.getTime() > rec.occurredAt.getTime(),
  );
  const outstanding = await unreconciledDowntimeWork(partner.id, company.id);
  check("both records are outstanding until reconciled", sheet.ids.every((id) => outstanding.some((o) => o.id === id)));

  const timeBefore = await prisma.timeEntry.count({ where: { jobId: job.id } });
  check(
    "reconciling needs a note saying where the work went",
    (await caught(() =>
      reconcileDowntimeWork({ actorUserId: partner.id, practiceId: company.id, recordId: rec.id, expectedVersion: rec.version, note: "" }),
    )) instanceof ContinuityError,
  );
  check(
    "reconciling against a stale version is a conflict, not an overwrite",
    (await caught(() =>
      reconcileDowntimeWork({ actorUserId: partner.id, practiceId: company.id, recordId: rec.id, expectedVersion: rec.version + 5, note: "x" }),
    )) instanceof VersionConflictError,
  );
  check(
    "a partner of the other practice cannot reconcile it (not-found)",
    (await caught(() =>
      reconcileDowntimeWork({ actorUserId: outsider.id, practiceId: company.id, recordId: rec.id, expectedVersion: rec.version, note: "x" }),
    )) instanceof PracticeAccessError,
  );
  await reconcileDowntimeWork({
    actorUserId: partner.id,
    practiceId: company.id,
    recordId: rec.id,
    expectedVersion: rec.version,
    note: "Entered as a time entry on the GSTR-9 job",
  });
  check(
    "reconciling does NOT itself create billable time or move the job",
    (await prisma.timeEntry.count({ where: { jobId: job.id } })) === timeBefore &&
      (await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).state === "IN_PROGRESS",
  );
  check(
    "a record cannot be reconciled twice",
    (await caught(() =>
      reconcileDowntimeWork({ actorUserId: partner.id, practiceId: company.id, recordId: rec.id, expectedVersion: rec.version + 1, note: "again" }),
    )) instanceof ContinuityError,
  );
  const stillOut = await unreconciledDowntimeWork(partner.id, company.id);
  check("only the unreconciled record is still outstanding", !stillOut.some((o) => o.id === rec.id) && stillOut.some((o) => o.id === sheet.ids[1]));

  // ============================================================ BCP06 drills
  console.log("\nBCP06 — drills: primary server loss, key service, sole administrator");

  const drillBase = {
    performedByUserId: itAdmin.id,
    remediationOwnerName: "Fictional Remediation Owner",
    remediationDueAt: new Date(Date.now() + 14 * 86400_000),
    backupRunId: backup.backupRunId,
  };
  check(
    "someone without system administration cannot run a drill",
    (await caught(() => runDrill({ ...drillBase, performedByUserId: partner.id, scenario: "KEY_SERVICE_UNAVAILABLE" }))) instanceof
      ContinuityError,
  );
  check(
    "a drill must name a remediation owner",
    (await caught(() => runDrill({ ...drillBase, remediationOwnerName: " ", scenario: "KEY_SERVICE_UNAVAILABLE" }))) instanceof
      ContinuityError,
  );

  const primary = await runDrill({ ...drillBase, scenario: "PRIMARY_SERVER_LOSS", restore: { objectHashSampleSize: 5 } });
  check(
    "PRIMARY_SERVER_LOSS: restored from the OFFSITE copy, clean, with achieved RPO and RTO recorded",
    primary.clean && !!primary.restoreRunId && primary.achievedRpoSeconds !== null && primary.achievedRtoSeconds !== null,
    [...primary.missingItems, ...primary.exceptions].join(" | "),
  );
  check(
    "the drill's evidence says every offsite artifact was checked",
    primary.evidence.some((e) => /offsite artifacts decrypted/.test(e)),
  );
  const drillRow = await prisma.restoreDrill.findUniqueOrThrow({ where: { id: primary.drillId } });
  check(
    "the next drill is due one quarter later",
    drillRow.nextDueAt.getUTCMonth() === (drillRow.performedAt.getUTCMonth() + 3) % 12,
  );

  // Tamper with one byte of the offsite copy: the drill must find it.
  const manifestArtifact = await prisma.backupArtifact.findFirstOrThrow({
    where: { backupRunId: backup.backupRunId, kind: "CONFIGURATION" },
  });
  const offsiteFile = path.join(
    offsiteRoot,
    backup.backupRunId,
    path.relative(path.join(primaryRoot, backup.backupRunId), manifestArtifact.storedAt),
  );
  const original64 = await fs.readFile(offsiteFile);
  const tampered = Buffer.from(original64);
  tampered[tampered.length - 1] ^= 0xff;
  await fs.writeFile(offsiteFile, tampered);
  const tamperedDrill = await runDrill({ ...drillBase, scenario: "PRIMARY_SERVER_LOSS" });
  await fs.writeFile(offsiteFile, original64);
  check(
    "a single altered byte in the offsite copy fails the drill as a MISSING item, and no restore is attempted",
    !tamperedDrill.clean && tamperedDrill.missingItems.some((m) => /offsite artifacts unreadable/.test(m)) && !tamperedDrill.restoreRunId,
    tamperedDrill.missingItems.join(" | "),
  );

  const heldFp = keyFingerprint(backupEncryptionKey());
  const keyNoEscrow = await runDrill({ ...drillBase, scenario: "KEY_SERVICE_UNAVAILABLE", keyCustodianNames: ["A", "B"] });
  check(
    "KEY_SERVICE: without demonstrated escrow retrieval, the drill records it as missing",
    keyNoEscrow.missingItems.some((m) => /escrowed backup key was not demonstrated/.test(m)),
  );
  const keyWrongEscrow = await runDrill({
    ...drillBase,
    scenario: "KEY_SERVICE_UNAVAILABLE",
    keyCustodianNames: ["A", "B"],
    escrow: { retrievedByName: "Fictional Escrow Holder", keyFingerprint: "0000000000000000" },
  });
  check(
    "KEY_SERVICE: an escrowed key that does not match the real key is caught, not accepted on say-so",
    keyWrongEscrow.missingItems.some((m) => /does not match the key the backups use/.test(m)),
  );
  const keyGood = await runDrill({
    ...drillBase,
    scenario: "KEY_SERVICE_UNAVAILABLE",
    keyCustodianNames: ["A", "B"],
    escrow: { retrievedByName: "Fictional Escrow Holder", keyFingerprint: heldFp },
  });
  check(
    "CONTROL — the matching escrowed key clears the item, and a WRONG key is refused on decrypt",
    keyGood.clean && keyGood.evidence.some((e) => /wrong key was refused/.test(e)),
    [...keyGood.missingItems, ...keyGood.exceptions].join(" | "),
  );

  await prisma.dscCustodyRecord.create({
    data: {
      practiceId: company.id,
      ownerName: "Fictional Partner",
      certificateIdentifier: tag("DSC"),
      issuedOn: d("2025-01-01"),
      expiresOn: d("2027-01-01"),
      custodianUserId: itAdmin.id,
      custodianName: itAdmin.fullName,
      issuedToCustodianAt: new Date(),
      purpose: "Fictional custody for the drill",
    },
  });
  const soleAdmin = await runDrill({
    ...drillBase,
    scenario: "SOLE_ADMINISTRATOR_DEPARTED",
    remediationDueAt: null,
    keyCustodianNames: [itAdmin.fullName],
  });
  check(
    "SOLE_ADMIN: with one administrator in this firm, the drill finds nobody else can administer — other tenants' admins do not count",
    soleAdmin.missingItems.some((m) => /No other person holds system administration/.test(m)),
    soleAdmin.missingItems.join(" | "),
  );
  check(
    "SOLE_ADMIN: the only key custodian being the leaver is a missing item",
    soleAdmin.missingItems.some((m) => /No named key custodian other than/.test(m)),
  );
  check(
    "SOLE_ADMIN: the DSC token in the leaver's custody is flagged",
    soleAdmin.exceptions.some((x) => /DSC token/.test(x)),
  );
  check(
    "findings recorded without a due date are themselves an exception",
    soleAdmin.exceptions.some((x) => /without a remediation due date/.test(x)),
  );
  check(
    "a partner remains who could appoint a replacement",
    soleAdmin.evidence.some((e) => e.includes(partner.fullName)),
  );

  const gateOpen = await productionDrillGate();
  check(
    "the production gate is BLOCKED while the sole-administrator finding is open",
    !gateOpen.passed && gateOpen.blockers.some((b) => b.startsWith("SOLE_ADMINISTRATOR_DEPARTED")),
    gateOpen.blockers.join(" | "),
  );

  const secondAdmin = await makeUser("SecondITAdmin");
  await prisma.practiceMembership.create({
    data: { practiceId: company.id, userId: secondAdmin.id, role: "IT_ADMIN", assignmentScope: "PRACTICE", effectiveFrom: from },
  });
  const withSecond = await runDrill({
    ...drillBase,
    scenario: "SOLE_ADMINISTRATOR_DEPARTED",
    departingUserId: itAdmin.id,
    keyCustodianNames: [itAdmin.fullName, "Fictional Custodian B"],
  });
  check(
    "CONTROL — once a second administrator exists, that finding is gone",
    !withSecond.missingItems.some((m) => /No other person holds system administration/.test(m)) &&
      !withSecond.missingItems.some((m) => /No named key custodian/.test(m)),
    withSecond.missingItems.join(" | "),
  );

  const soleRow = await prisma.restoreDrill.findUniqueOrThrow({ where: { id: soleAdmin.drillId } });
  const closed = await closeRemediation({
    drillId: soleAdmin.drillId,
    actorUserId: itAdmin.id,
    expectedVersion: soleRow.version,
    note: "Second administrator appointed; custodians named (fictional)",
  });
  const soleAfter = await prisma.restoreDrill.findUniqueOrThrow({ where: { id: soleAdmin.drillId } });
  check(
    "closing a remediation records it WITHOUT erasing the findings",
    !!closed.closedAt && soleAfter.missingItems.length === soleRow.missingItems.length && /Remediation closed/.test(soleAfter.notes ?? ""),
  );
  check(
    "a clean drill has nothing to remediate",
    (await caught(() =>
      closeRemediation({ drillId: keyGood.drillId, actorUserId: itAdmin.id, expectedVersion: keyGood.version, note: "n/a" }),
    )) instanceof ContinuityError,
  );

  const schedule = await drillSchedule();
  check(
    "the schedule tracks all three named scenarios plus the quarterly drill",
    ["SCHEDULED_QUARTERLY", "PRIMARY_SERVER_LOSS", "KEY_SERVICE_UNAVAILABLE", "SOLE_ADMINISTRATOR_DEPARTED"].every((s) =>
      schedule.some((x) => x.scenario === s),
    ),
  );

  const audit = await prisma.event.count({ where: { action: "RESTORE_DRILL_RECORDED", actorUserId: itAdmin.id } });
  check("every drill is on the audit trail", audit >= 7, `${audit}`);

  // ---------------------------------------------------------------- tidy
  if (sendingFlag === undefined) delete process.env.EXTERNAL_SENDING_DISABLED;
  else process.env.EXTERNAL_SENDING_DISABLED = sendingFlag;
  await fs.rm(workRoot, { recursive: true, force: true }).catch(() => undefined);

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
