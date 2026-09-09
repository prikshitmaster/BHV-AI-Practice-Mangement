/**
 * T05 acceptance test — AUTH01, AUTH02, AUTH03, AUTH05 (PRD §10).
 *
 * PRD acceptance evidence, verbatim:
 *   "Verify reset and MFA recovery with the owner absent; there must be a
 *    documented authorised substitute process. Search logs and exported
 *    backups for plaintext secrets. A demo 'admin/admin' account must never
 *    be deployable to production."
 *
 * The plaintext-secret check is done properly: a real password and a real
 * TOTP seed are set, then a genuine `pg_dump` of the database and the audit
 * Event log are searched for those exact values.
 *
 * All fixture data is fictional.
 * Run: npm run test:t05
 */

import "dotenv/config";
import { execFileSync } from "node:child_process";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  AuthError,
  RateLimitError,
  RecoveryNotApprovedError,
  approveRecovery,
  assertPasswordAllowed,
  beginMfaEnrolment,
  completeLoginWithTotp,
  confirmMfaEnrolment,
  consumeRecovery,
  createInvitation,
  acceptInvitation,
  hasValidStepUp,
  login,
  requestRecovery,
  requireStepUp,
  setPassword,
  validateSession,
  IDLE_TIMEOUT_MS,
  ABSOLUTE_TIMEOUT_MS,
  INVITATION_TTL_MS,
} from "../src/lib/auth";
import { totpCode } from "../src/lib/crypto";
import { assertNoDevAuthInProduction } from "../src/lib/session";

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

// Distinctive values so a dump search cannot match them by accident.
const OWNER_PASSWORD = `Prtnr-Corr3ct-Horse-${RUN}`;
const STAFF_PASSWORD = `Staff-Un1que-Phrase-${RUN}`;

async function main() {
  console.log("\nT05 — authentication (PRD §10 AUTH01-03, AUTH05)\n");

  const tenant = await prisma.tenant.create({ data: { name: tag("T") } });
  const practice = await prisma.practice.create({
    data: {
      tenantId: tenant.id, name: tag("Company"), constitution: "LLP",
      documentNamespace: tag("co"), effectiveFrom: new Date("2024-04-01"),
    },
  });
  const otherPractice = await prisma.practice.create({
    data: {
      tenantId: tenant.id, name: tag("Associates"), constitution: "PARTNERSHIP",
      documentNamespace: tag("as"), effectiveFrom: new Date("2024-04-01"),
    },
  });

  const owner = await prisma.user.create({
    data: { email: `owner-${RUN}@example.invalid`, fullName: "Fictional Owner", status: "ACTIVE" },
  });
  const substitute = await prisma.user.create({
    data: { email: `sub-${RUN}@example.invalid`, fullName: "Authorised Substitute", status: "ACTIVE" },
  });
  await prisma.practiceMembership.createMany({
    data: [
      { practiceId: practice.id, userId: owner.id, role: "GROUP_OWNER", assignmentScope: "COMBINED", effectiveFrom: new Date("2024-04-01") },
      { practiceId: practice.id, userId: substitute.id, role: "PRACTICE_PARTNER", assignmentScope: "PRACTICE", effectiveFrom: new Date("2024-04-01") },
    ],
  });

  // ------------------------------------- AUTH01: no demo/default credentials
  console.log("AUTH01 — a demo 'admin/admin' account must never be deployable");

  for (const bad of ["admin", "admin123", "ADMIN", "Admin1!", "password", "changeme"]) {
    const rejected = await throws(
      async () => assertPasswordAllowed("admin@example.invalid", bad),
      AuthError,
    );
    if (!rejected) {
      check(`password "${bad}" is rejected`, false, "it was ACCEPTED");
    }
  }
  check("all demo/default passwords rejected at the point of setting", true);

  const shortRejected = await throws(
    async () => assertPasswordAllowed("someone@example.invalid", "Sh0rt!"),
    AuthError,
  );
  check("a too-short password is rejected", shortRejected !== null);

  const nameRejected = await throws(
    async () => assertPasswordAllowed("jsmith@example.invalid", "jsmith-longer-password"),
    AuthError,
  );
  check("a password containing the account name is rejected", nameRejected !== null);

  // The production bypass guard.
  const env = process.env as Record<string, string | undefined>;
  const priorEnv = env.NODE_ENV;
  const priorFlag = env.ALLOW_DEV_ACTOR_HEADER;
  try {
    env.NODE_ENV = "production";
    env.ALLOW_DEV_ACTOR_HEADER = "true";
    let guardFired = false;
    try {
      assertNoDevAuthInProduction();
    } catch {
      guardFired = true;
    }
    check("the dev actor-header bypass cannot be enabled in production", guardFired);
  } finally {
    env.NODE_ENV = priorEnv;
    if (priorFlag === undefined) delete env.ALLOW_DEV_ACTOR_HEADER;
    else env.ALLOW_DEV_ACTOR_HEADER = priorFlag;
  }

  // --------------------------------------------------- AUTH01: MFA required
  console.log("\nAUTH01 — password alone is never an authenticated state");

  await setPassword(owner.id, OWNER_PASSWORD);
  await setPassword(substitute.id, STAFF_PASSWORD);

  const firstLogin = await login(owner.email, OWNER_PASSWORD);
  check(
    "correct password yields MFA_ENROLMENT_REQUIRED, not a session",
    firstLogin.status === "MFA_ENROLMENT_REQUIRED",
    firstLogin.status,
  );

  const wrongPassword = await throws(
    () => login(owner.email, "definitely-the-wrong-password"),
    AuthError,
  );
  check("a wrong password is refused", wrongPassword?.code === "INVALID_CREDENTIALS");

  const unknownUser = await throws(
    () => login(`nobody-${RUN}@example.invalid`, "irrelevant-password"),
    AuthError,
  );
  check(
    "an unknown account gives the SAME error as a wrong password (no enumeration)",
    unknownUser?.code === "INVALID_CREDENTIALS",
  );

  // Enrol MFA.
  const enrolment = await beginMfaEnrolment(owner.id);
  const mfaSecret = enrolment.secret;
  const { recoveryCodes } = await confirmMfaEnrolment(enrolment.enrolmentId, totpCode(mfaSecret));
  check("MFA enrolment issues single-use recovery codes", recoveryCodes.length === 10);

  const second = await login(owner.email, OWNER_PASSWORD);
  check("after enrolment, login asks for MFA", second.status === "MFA_REQUIRED");

  const badCode = await throws(() => completeLoginWithTotp(owner.id, "000000"), AuthError);
  check("a wrong TOTP code is refused", badCode !== null);

  // Enrolment consumed the current time step, so advance the clock rather
  // than sleeping 30 s. Each login below uses a genuinely later step.
  let clock = Date.now();
  const nextStep = () => new Date((clock += 31_000));

  const loginAt = nextStep();
  const loginCode = totpCode(mfaSecret, loginAt);
  const session = await completeLoginWithTotp(owner.id, loginCode, {
    deviceLabel: "Test device",
    at: loginAt,
  });
  check("a correct TOTP code creates a session", !!session.token);

  // Replay of the very same code, in the very same time step.
  const replay = await throws(
    () => completeLoginWithTotp(owner.id, loginCode, { at: loginAt }),
    AuthError,
  );
  check("the same TOTP code cannot be replayed in its time step", replay !== null, replay?.message);

  // ------------------------------------------------ AUTH02: session lifetime
  console.log("\nAUTH02 — server-enforced expiry, revocation, step-up");

  const validated = await validateSession(session.token);
  check("a fresh session validates", validated.userId === owner.id);

  const stored = await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } });
  const idleWindow = stored.idleExpiresAt.getTime() - stored.lastSeenAt.getTime();
  const absWindow = stored.absoluteExpiresAt.getTime() - stored.createdAt.getTime();
  check(
    "idle timeout is 30 minutes",
    Math.abs(idleWindow - IDLE_TIMEOUT_MS) < 5_000,
    `${Math.round(idleWindow / 60000)} min`,
  );
  check(
    "absolute session limit is 12 hours",
    Math.abs(absWindow - ABSOLUTE_TIMEOUT_MS) < 5_000,
    `${Math.round(absWindow / 3600000)} h`,
  );
  check(
    "the session cookie value is NOT stored — only its hash",
    stored.tokenHash !== session.token && stored.tokenHash.length === 64,
  );

  // Idle expiry, enforced server-side.
  await prisma.session.update({
    where: { id: session.sessionId },
    data: { idleExpiresAt: new Date(Date.now() - 1000) },
  });
  const idleExpired = await throws(() => validateSession(session.token), AuthError);
  check(
    "an idle-expired session is refused by the server",
    idleExpired?.code === "SESSION_IDLE_EXPIRED",
  );

  // Absolute expiry wins even if the session is active.
  const at2 = nextStep();
  const s2 = await completeLoginWithTotp(owner.id, totpCode(mfaSecret, at2), { at: at2 });
  await prisma.session.update({
    where: { id: s2.sessionId },
    data: {
      idleExpiresAt: new Date(Date.now() + 60_000),
      absoluteExpiresAt: new Date(Date.now() - 1000),
    },
  });
  const absExpired = await throws(() => validateSession(s2.token), AuthError);
  check("an absolutely-expired session is refused even while active", absExpired?.code === "SESSION_EXPIRED");

  // Immediate revocation.
  const at3 = nextStep();
  const s3 = await completeLoginWithTotp(owner.id, totpCode(mfaSecret, at3), { at: at3 });
  await validateSession(s3.token);
  await prisma.session.update({
    where: { id: s3.sessionId },
    data: { revokedAt: new Date(), revokedReason: "Test revocation" },
  });
  const revoked = await throws(() => validateSession(s3.token), AuthError);
  check("revocation takes effect immediately", revoked?.code === "SESSION_REVOKED");

  // Step-up.
  const at4 = nextStep();
  const s4 = await completeLoginWithTotp(owner.id, totpCode(mfaSecret, at4), { at: at4 });
  check(
    "a normal session does NOT carry export authority",
    !(await hasValidStepUp(s4.sessionId, "EXPORT")),
  );
  const atStepUp = nextStep();
  await requireStepUp(s4.sessionId, "EXPORT", totpCode(mfaSecret, atStepUp), atStepUp);
  check("step-up grants export authority", await hasValidStepUp(s4.sessionId, "EXPORT"));
  check(
    "step-up for EXPORT does not grant SECRET_REVEAL",
    !(await hasValidStepUp(s4.sessionId, "SECRET_REVEAL")),
  );

  // ------------------------------------------------- AUTH03: invitations
  console.log("\nAUTH03 — invitation bootstrap");

  const invite = await createInvitation({
    email: `newjoiner-${RUN}@example.invalid`,
    practiceId: practice.id,
    role: "STAFF_ARTICLE",
    invitedByUserId: owner.id,
    invitedByName: "Fictional Owner",
    channel: "approved-email",
  });

  const inviteRow = await prisma.invitation.findUniqueOrThrow({ where: { id: invite.invitationId } });
  const ttl = inviteRow.expiresAt.getTime() - inviteRow.createdAt.getTime();
  check("invitations expire after 48 hours by default", Math.abs(ttl - INVITATION_TTL_MS) < 5_000);
  check("the invitation token is stored hashed, not in the clear", inviteRow.tokenHash !== invite.token);

  const joined = await acceptInvitation(invite.token, `Newjoiner-Str0ng-${RUN}`, "New Joiner");
  check("the invitation can be accepted once", joined.practiceId === practice.id);

  const reuse = await throws(
    () => acceptInvitation(invite.token, `Another-Str0ng-${RUN}`, "Someone Else"),
    AuthError,
  );
  check("the invitation is single-use", reuse?.code === "INVITATION_USED");

  // The domain-sharing trap.
  const joinedMemberships = await prisma.practiceMembership.findMany({
    where: { userId: joined.userId },
  });
  check(
    "accepting enrols the user in EXACTLY ONE practice",
    joinedMemberships.length === 1 && joinedMemberships[0].practiceId === practice.id,
    `${joinedMemberships.length} memberships`,
  );
  check(
    "sharing an email domain did not enrol them in the other practice",
    !joinedMemberships.some((m) => m.practiceId === otherPractice.id),
  );

  const expiredInvite = await createInvitation({
    email: `expired-${RUN}@example.invalid`,
    practiceId: practice.id, role: "STAFF_ARTICLE",
    invitedByUserId: owner.id, invitedByName: "Fictional Owner",
    channel: "approved-email", ttlMs: -1000,
  });
  const expiredUse = await throws(
    () => acceptInvitation(expiredInvite.token, `Expired-Str0ng-${RUN}`, "Too Late"),
    AuthError,
  );
  check("an expired invitation is refused", expiredUse?.code === "INVITATION_EXPIRED");

  // Rate limiting.
  // Each failed attempt throws INVALID_CREDENTIALS; keep going until the
  // limiter cuts in, and record how many attempts it allowed.
  let attemptsAllowed = 0;
  let limitHit: RateLimitError | null = null;
  for (let i = 0; i < 12; i++) {
    try {
      await login(`ratelimit-${RUN}@example.invalid`, "wrong-password-attempt");
      attemptsAllowed++;
    } catch (e) {
      if (e instanceof RateLimitError) {
        limitHit = e;
        break;
      }
      attemptsAllowed++;
    }
  }
  check(
    "repeated login attempts are rate limited",
    limitHit !== null,
    `${attemptsAllowed} attempts allowed before the limiter engaged`,
  );
  check(
    "the limiter engages within a small number of attempts",
    limitHit !== null && attemptsAllowed <= 6,
    `${attemptsAllowed} allowed`,
  );

  // ---------------------- ACCEPTANCE EVIDENCE: recovery with the owner absent
  console.log("\nAcceptance evidence — MFA recovery with the OWNER ABSENT");

  const request = await requestRecovery({
    userId: owner.id,
    kind: "MFA_RESET",
    reason: "Owner travelling, authenticator device lost",
    requestedByName: "Practice Administrator",
  });

  const unapproved = await throws(() => consumeRecovery(request.token), RecoveryNotApprovedError);
  check(
    "recovery CANNOT be used before an authorised substitute approves it",
    unapproved !== null,
  );

  const selfApproval = await throws(
    () => approveRecovery({ requestId: request.requestId, approverUserId: owner.id, approverName: "Fictional Owner" }),
    RecoveryNotApprovedError,
  );
  check("the subject of a recovery cannot approve their own request", selfApproval !== null);

  await approveRecovery({
    requestId: request.requestId,
    approverUserId: substitute.id,
    approverName: "Authorised Substitute",
  });

  const outcome = await consumeRecovery(request.token);
  check("after substitute approval, recovery proceeds", outcome.kind === "MFA_RESET");
  check("MFA recovery forces re-enrolment", outcome.mfaReenrolmentRequired === true);

  // The critical part: MFA must not be silently switched OFF.
  const ownerAfter = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
  const activeEnrolments = await prisma.mfaEnrolment.count({
    where: { userId: owner.id, revokedAt: null },
  });
  check("the old MFA enrolment is revoked", activeEnrolments === 0);
  check("the user is marked as NOT MFA-enrolled, forcing re-enrolment", ownerAfter.mfaEnrolledAt === null);

  const afterRecoveryLogin = await login(owner.email, OWNER_PASSWORD);
  check(
    "logging in after recovery demands MFA enrolment again — MFA was never removed",
    afterRecoveryLogin.status === "MFA_ENROLMENT_REQUIRED",
  );

  const sessionsAfter = await prisma.session.count({
    where: { userId: owner.id, revokedAt: null },
  });
  check("recovery revoked every live session", sessionsAfter === 0, `${sessionsAfter} still live`);

  const recoveryRow = await prisma.recoveryRequest.findUniqueOrThrow({ where: { id: request.requestId } });
  check(
    "the recovery is logged with reason, requester and named approver",
    recoveryRow.reason.length > 0 &&
      recoveryRow.requestedByName.length > 0 &&
      recoveryRow.approverName === "Authorised Substitute" &&
      recoveryRow.approvedAt !== null,
  );
  check("the recovery token is stored hashed", recoveryRow.tokenHash !== request.token);

  const recoveryEvents = await prisma.event.count({
    where: { actorUserId: { in: [owner.id, substitute.id] }, action: { startsWith: "RECOVERY_" } },
  });
  check("recovery steps are written to the audit trail", recoveryEvents >= 3, `${recoveryEvents} events`);

  // ------------------------------------------------------------- AUTH05: DSC
  console.log("\nAUTH05 — DSC custody register holds metadata only");

  const dsc = await prisma.dscCustodyRecord.create({
    data: {
      practiceId: practice.id,
      ownerName: "Fictional Signatory",
      certificateIdentifier: "TEST-SERIAL-0000-FICTIONAL",
      issuedOn: new Date("2025-01-01"),
      expiresOn: new Date("2027-01-01"),
      custodianName: "Fictional Custodian",
      issuedToCustodianAt: new Date("2025-01-05"),
      purpose: "MCA and income-tax filings",
    },
  });
  const dscFields = Object.keys(dsc);
  const forbidden = dscFields.filter((f) =>
    /privatekey|private_key|pin|passphrase|secret|password/i.test(f),
  );
  check(
    "the DSC register has no private-key or PIN column",
    forbidden.length === 0,
    `found: ${forbidden.join(", ")}`,
  );
  check("custody records track issue and return dates", dsc.issuedToCustodianAt !== null);

  // ------------- ACCEPTANCE EVIDENCE: no plaintext secrets in DB dump or logs
  console.log("\nAcceptance evidence — search the database dump and logs for plaintext secrets");

  const dump = execFileSync(
    "docker",
    ["exec", "tasktwo-db-1", "pg_dump", "-U", "bhv", "-d", "bhv_practice"],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );

  check("a database dump was produced to search", dump.length > 1000, `${dump.length} bytes`);
  check(
    "the owner's password does NOT appear in the dump",
    !dump.includes(OWNER_PASSWORD),
  );
  check(
    "the staff password does NOT appear in the dump",
    !dump.includes(STAFF_PASSWORD),
  );
  check(
    "the TOTP seed does NOT appear in the dump",
    !dump.includes(mfaSecret),
    "MFA seed found in plaintext",
  );
  check(
    "no recovery code appears in the dump",
    !recoveryCodes.some((c) => dump.includes(c)),
  );
  check(
    "the session cookie token does NOT appear in the dump",
    !dump.includes(session.token),
  );
  check(
    "the invitation token does NOT appear in the dump",
    !dump.includes(invite.token),
  );
  check(
    "the recovery token does NOT appear in the dump",
    !dump.includes(request.token),
  );
  // Sanity: the search would actually find something if it were there.
  check(
    "control — the dump search is capable of finding a known stored value",
    dump.includes("TEST-SERIAL-0000-FICTIONAL"),
  );

  // The audit trail is a log we control; check it holds no secret material.
  const events = await prisma.event.findMany({
    where: { actorUserId: { in: [owner.id, substitute.id, joined.userId] } },
    select: { action: true, reason: true, beforeMeta: true, afterMeta: true },
  });
  const eventText = JSON.stringify(events);
  check(
    "the audit trail contains no password, seed, or token",
    !eventText.includes(OWNER_PASSWORD) &&
      !eventText.includes(mfaSecret) &&
      !eventText.includes(session.token) &&
      !recoveryCodes.some((c) => eventText.includes(c)),
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
