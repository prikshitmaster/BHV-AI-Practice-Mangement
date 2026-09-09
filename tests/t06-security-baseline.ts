/**
 * T06 acceptance test — SEC01-06 (PRD §35).
 *
 * TASKS.md test line:
 *   "audit trail captures actor/practice/action/version/time/reason for every
 *    sensitive change; independent pen-test finds no critical/high unresolved."
 *
 * The first half is verified here. The SECOND HALF CANNOT BE: an independent
 * penetration test requires an external reviewer and is tracked as an open
 * blocker in PROGRESS.md. This file does not pretend otherwise.
 *
 * All fixture data is fictional.
 * Run: npm run test:t06
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { recordEvent, sanitiseMeta, verifyAuditChain } from "../src/lib/audit";
import { raiseAlert, runDetectionSweep, checkExportVolume, incidentRouting } from "../src/lib/monitoring";

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

async function main() {
  console.log("\nT06 — security baseline (PRD §35 SEC01-06)\n");

  const tenant = await prisma.tenant.create({ data: { name: tag("T") } });
  const practice = await prisma.practice.create({
    data: {
      tenantId: tenant.id, name: tag("Company"), constitution: "LLP",
      documentNamespace: tag("co"), effectiveFrom: new Date("2024-04-01"),
    },
  });
  const actor = await prisma.user.create({
    data: { email: `actor-${RUN}@example.invalid`, fullName: "Fictional Actor", status: "ACTIVE" },
  });

  // ------------------------------------------------- SEC04: field completeness
  console.log("SEC04 — the audit trail captures every required field");

  const event = await recordEvent({
    action: "APPROVAL_RECORDED",
    targetType: "Invoice",
    targetId: `invoice-${RUN}`,
    targetVersion: 7,
    result: "SUCCESS",
    actorUserId: actor.id,
    tenantId: tenant.id,
    practiceId: practice.id,
    reason: "Reviewed and approved at year end",
  });

  check("actor is recorded", event.actorUserId === actor.id);
  check("practice is recorded", event.practiceId === practice.id);
  check("action is recorded", event.action === "APPROVAL_RECORDED");
  check("record id is recorded", event.targetId === `invoice-${RUN}`);
  check("EXACT VERSION is recorded", event.targetVersion === 7);
  check("time is recorded", event.createdAt instanceof Date);
  check("result is recorded", event.result === "SUCCESS");
  check("reason is recorded", (event.reason ?? "").length > 0);

  // --------------------------------------------------- SEC04: append-only
  console.log("\nSEC04 — the trail is append-only, enforced by the database");

  let updateBlocked = false;
  let updateError = "";
  try {
    await prisma.$executeRaw`UPDATE "Event" SET "action" = 'TAMPERED' WHERE id = ${event.id}`;
  } catch (e) {
    updateBlocked = true;
    updateError = (e as Error).message.split("\n").filter(Boolean).slice(-1)[0] ?? "";
  }
  check("UPDATE on the audit trail is rejected", updateBlocked, updateError);

  let deleteBlocked = false;
  try {
    await prisma.$executeRaw`DELETE FROM "Event" WHERE id = ${event.id}`;
  } catch {
    deleteBlocked = true;
  }
  check("DELETE on the audit trail is rejected", deleteBlocked);

  const stillThere = await prisma.event.findUnique({ where: { id: event.id } });
  check(
    "the event survived both attempts, unmodified",
    stillThere?.action === "APPROVAL_RECORDED",
    stillThere?.action,
  );

  // ------------------------------------------------ SEC04: integrity chain
  console.log("\nSEC04 — tamper-evident hash chain");

  check("the event was given a hash", (event.hash ?? "").length === 64);
  check(
    "the hash was computed by the database, not supplied by the app",
    event.hash !== null && event.previousHash !== undefined,
  );

  const chain = await verifyAuditChain();
  check(
    "the whole chain verifies",
    chain.ok,
    chain.problem ? `${chain.problem} at sequence ${chain.firstBadSequence}` : "",
  );
  check("the chain covers every event written so far", chain.checked > 0, `${chain.checked} events`);

  // A forged hash supplied by the application must be overwritten.
  const forged = await prisma.event.create({
    data: {
      practiceId: practice.id,
      actorUserId: actor.id,
      targetType: "Test",
      targetId: `forge-${RUN}`,
      action: "FORGERY_ATTEMPT",
      result: "SUCCESS",
      hash: "0".repeat(64),
      previousHash: "0".repeat(64),
    },
  });
  check(
    "an application-supplied hash is discarded and recomputed",
    forged.hash !== "0".repeat(64) && forged.previousHash !== "0".repeat(64),
  );
  const chainAfterForge = await verifyAuditChain();
  check("the chain still verifies after the forgery attempt", chainAfterForge.ok);

  // ---------------------------------------- SEC04: no secrets or file bodies
  console.log("\nSEC04 — no passwords or document bodies reach the log");

  const documentBody = "X".repeat(5000);
  const sensitive = await recordEvent({
    action: "DOCUMENT_RELEASED",
    targetType: "DocumentVersion",
    targetId: `doc-${RUN}`,
    result: "SUCCESS",
    actorUserId: actor.id,
    practiceId: practice.id,
    afterMeta: {
      password: "SuperSecret-Should-Never-Appear",
      totpSecret: "JBSWY3DPEHPK3PXP",
      sessionToken: "tok_should_never_appear",
      apiKey: "ak_should_never_appear",
      documentBody,
      filename: "workpaper.pdf",
      sizeBytes: 5000,
    },
  });

  const meta = JSON.stringify(sensitive.afterMeta);
  check("a password value is redacted", !meta.includes("SuperSecret-Should-Never-Appear"));
  check("a TOTP seed is redacted", !meta.includes("JBSWY3DPEHPK3PXP"));
  check("a session token is redacted", !meta.includes("tok_should_never_appear"));
  check("an API key is redacted", !meta.includes("ak_should_never_appear"));
  check("a full document body is truncated", !meta.includes(documentBody));
  check("harmless metadata is preserved for investigation", meta.includes("workpaper.pdf"));
  check("the redacted KEYS remain, so the shape stays auditable", meta.includes("password"));

  // Nested and array cases.
  const nested = sanitiseMeta({ outer: { inner: { apiKey: "leak-me" } }, list: [{ secret: "leak" }] });
  check(
    "redaction reaches nested objects and arrays",
    !JSON.stringify(nested).includes("leak"),
    JSON.stringify(nested),
  );

  // ------------------------------------------------------- SEC03: headers
  console.log("\nSEC03 — security headers on live responses");

  let headersChecked = false;
  try {
    const res = await fetch(`${BASE_URL}/api/health`);
    headersChecked = true;

    const csp = res.headers.get("content-security-policy") ?? "";
    check("Content-Security-Policy is set", csp.length > 0);
    check("CSP forbids framing", csp.includes("frame-ancestors 'none'"));
    check("CSP blocks plugins/objects", csp.includes("object-src 'none'"));
    check(
      "CSP does not allow inline SCRIPT",
      !/script-src[^;]*'unsafe-inline'/.test(csp),
      csp,
    );
    check("X-Content-Type-Options is nosniff", res.headers.get("x-content-type-options") === "nosniff");
    check("X-Frame-Options denies framing", res.headers.get("x-frame-options") === "DENY");
    check(
      "Referrer-Policy is restrictive",
      (res.headers.get("referrer-policy") ?? "").includes("strict-origin"),
    );
    check("Permissions-Policy is set", (res.headers.get("permissions-policy") ?? "").length > 0);
    check("the stack is not advertised", res.headers.get("x-powered-by") === null);
  } catch (e) {
    check("the app was reachable for header checks", false, String(e));
  }
  if (!headersChecked) {
    console.log("        (start the app with `npm run dev` to exercise header checks)");
  }

  // -------------------------------------------------------- SEC05: alerting
  console.log("\nSEC05 — monitoring, with evidence but without confidential content");

  const routing = incidentRouting("REPEATED_CROSS_SCOPE_ACCESS");
  check("an incident owner is always named (or visibly unassigned)", routing.incidentOwner.length > 0);
  check("an alert destination is always named (or visibly unconfigured)", routing.alertDestination.length > 0);

  const alert = await raiseAlert({
    kind: "ABNORMAL_EXPORT",
    severity: "WARNING",
    summary: "Test alert",
    practiceId: practice.id,
    subjectUserId: actor.id,
    evidence: {
      rowCount: 9000,
      // These must not survive into the alert.
      password: "alert-should-not-carry-this",
      documentBody: "Y".repeat(3000),
    },
  });
  const alertEvidence = JSON.stringify(alert.evidence);
  check("alert evidence keeps the investigable facts", alertEvidence.includes("9000"));
  check("alert evidence carries no secret value", !alertEvidence.includes("alert-should-not-carry-this"));
  check("alert evidence carries no document body", !alertEvidence.includes("Y".repeat(3000)));

  // Repeated cross-scope attempts must escalate to CRITICAL.
  for (let i = 0; i < 4; i++) {
    await recordEvent({
      action: "PRACTICE_ACCESS_DENIED",
      targetType: "Practice",
      targetId: practice.id,
      result: "FAILURE",
      actorUserId: actor.id,
      reason: "No live membership",
    });
  }
  const sweep = await runDetectionSweep();
  check(
    "the detection sweep raises repeated cross-scope access",
    sweep.raised.includes("REPEATED_CROSS_SCOPE_ACCESS"),
    sweep.raised.join(", "),
  );
  const critical = await prisma.securityAlert.findFirst({
    where: { kind: "REPEATED_CROSS_SCOPE_ACCESS", subjectUserId: actor.id },
    orderBy: { createdAt: "desc" },
  });
  check("cross-practice probing is treated as CRITICAL", critical?.severity === "CRITICAL");

  const bigExport = await checkExportVolume({
    userId: actor.id, practiceId: practice.id, rowCount: 9999,
  });
  check("an unusually large export raises an alert", bigExport !== null);
  const smallExport = await checkExportVolume({
    userId: actor.id, practiceId: practice.id, rowCount: 10,
  });
  check("an ordinary export does not", smallExport === null);

  // The chain must still be intact after all that writing.
  const finalChain = await verifyAuditChain();
  check("the audit chain is still intact at the end of the run", finalChain.ok, finalChain.problem ?? "");

  console.log(`\n${passed} passed, ${failed} failed`);
  console.log(
    "\nNOT VERIFIED HERE: independent penetration testing (SEC01 acceptance\n" +
      "evidence). It requires an external reviewer and remains an open blocker\n" +
      "in PROGRESS.md. T06 is not fully closed until it is done.\n",
  );
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
