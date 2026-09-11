/**
 * Authentication — AUTH01, AUTH02, AUTH03, AUTH05 (PRD §10).
 * AUTH04 (portal secret vault) is R1; AUTH06 (SSO) is R2.
 *
 * Design note, recorded deliberately: SPEC.md names Auth.js. AUTH02 requires
 * "server enforced expiry ... and immediate revocation", which a stateless JWT
 * session cannot give — a signed token stays valid until it expires, whoever
 * has been walked out of the building. So sessions are database-backed, using
 * the Session table built in T04 (idleExpiresAt / absoluteExpiresAt /
 * revokedAt) that suspendUser() already revokes. Auth.js can still be layered
 * on top later as a login-flow front end; the authority stays here.
 * See PROGRESS.md for this decision.
 */

import { prisma } from "@/lib/prisma";
import {
  decryptSecret,
  encryptSecret,
  generateRecoveryCode,
  generateToken,
  generateTotpSecret,
  hashPassword,
  hashToken,
  verifyPassword,
  verifyTotp,
} from "@/lib/crypto";

// AUTH02 proposed defaults.
export const IDLE_TIMEOUT_MS = 30 * 60_000;
export const ABSOLUTE_TIMEOUT_MS = 12 * 3600_000;
// AUTH03 default.
export const INVITATION_TTL_MS = 48 * 3600_000;
const STEP_UP_TTL_MS = 5 * 60_000;

// AUTH03 rate limits.
const LOGIN_LIMIT = { max: 5, windowMs: 15 * 60_000 };
const INVITE_LIMIT = { max: 20, windowMs: 60 * 60_000 };
// AUTH01/AUTH02: a step-up is a second login for the most sensitive acts. It
// had no limit until T18 exposed it over HTTP — a 6-digit code with unlimited
// guesses is not a second factor.
const STEP_UP_LIMIT = { max: 5, windowMs: 15 * 60_000 };
const ACCOUNT_LOCK_MS = 15 * 60_000;

export class AuthError extends Error {
  readonly status = 401;
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export class RateLimitError extends Error {
  readonly status = 429;
  readonly code = "RATE_LIMITED";
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}

/**
 * AUTH01: reject credentials that must never reach production. This is
 * enforced at the point a password is SET, so a demo "admin/admin" account
 * cannot be created in the first place — not merely warned about later.
 */
const FORBIDDEN_PASSWORDS = new Set([
  "admin", "admin123", "password", "password1", "passw0rd",
  "12345678", "123456789", "changeme", "letmein", "welcome",
  "qwerty", "default", "test1234", "demo", "bhv123",
]);

export function assertPasswordAllowed(email: string, password: string): void {
  const lowered = password.toLowerCase();

  if (password.length < 12) {
    throw new AuthError("Password must be at least 12 characters.", "WEAK_PASSWORD");
  }
  if (FORBIDDEN_PASSWORDS.has(lowered)) {
    throw new AuthError(
      "That password appears on the forbidden list and can never be deployed.",
      "FORBIDDEN_PASSWORD",
    );
  }
  const localPart = email.split("@")[0]?.toLowerCase() ?? "";
  if (localPart.length > 2 && lowered.includes(localPart)) {
    throw new AuthError("Password must not contain the account name.", "WEAK_PASSWORD");
  }
  // "admin/admin" in any casing or with trivial padding.
  if (/^a+d+m+i+n+[0-9!@#$%^&*]*$/.test(lowered)) {
    throw new AuthError("Administrative default passwords are not permitted.", "FORBIDDEN_PASSWORD");
  }
}

// ------------------------------------------------------------- rate limiting

async function consumeRateLimit(key: string, limit: { max: number; windowMs: number }) {
  const now = new Date();
  const windowStart = new Date(now.getTime() - limit.windowMs);

  const existing = await prisma.rateLimitCounter.findUnique({ where: { key } });

  if (!existing || existing.windowStart < windowStart) {
    await prisma.rateLimitCounter.upsert({
      where: { key },
      create: { key, windowStart: now, count: 1 },
      update: { windowStart: now, count: 1 },
    });
    return;
  }

  if (existing.count >= limit.max) {
    throw new RateLimitError("Too many attempts. Try again later.");
  }

  await prisma.rateLimitCounter.update({
    where: { key },
    data: { count: { increment: 1 } },
  });
}

// ------------------------------------------------------------- credentials

export async function setPassword(userId: string, plaintext: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { email: true },
  });

  assertPasswordAllowed(user.email, plaintext);
  const passwordHash = await hashPassword(plaintext);

  return prisma.userCredential.upsert({
    where: { userId },
    create: { userId, passwordHash },
    update: { passwordHash, passwordUpdatedAt: new Date(), mustChangePassword: false },
  });
}

// -------------------------------------------------------------------- MFA

/**
 * Begin TOTP enrolment. Returns the secret ONCE so it can be shown as a QR
 * code; from then on only the encrypted copy exists.
 */
export async function beginMfaEnrolment(userId: string) {
  const secret = generateTotpSecret();
  const encrypted = encryptSecret(secret);

  const enrolment = await prisma.mfaEnrolment.create({
    data: {
      userId,
      method: "TOTP",
      secretCiphertext: encrypted.ciphertext,
      secretIv: encrypted.iv,
      secretAuthTag: encrypted.authTag,
    },
  });

  return { enrolmentId: enrolment.id, secret };
}

/** Confirm enrolment with a live code, then issue single-use recovery codes. */
export async function confirmMfaEnrolment(enrolmentId: string, code: string) {
  const enrolment = await prisma.mfaEnrolment.findUniqueOrThrow({ where: { id: enrolmentId } });
  const secret = decryptSecret({
    ciphertext: enrolment.secretCiphertext,
    iv: enrolment.secretIv,
    authTag: enrolment.secretAuthTag,
  });

  const result = verifyTotp(secret, code, { lastUsedStep: enrolment.lastUsedStep });
  if (!result.valid) throw new AuthError(result.reason ?? "Invalid code", "MFA_INVALID");

  await prisma.mfaEnrolment.update({
    where: { id: enrolmentId },
    data: {
      confirmedAt: new Date(),
      lastUsedAt: new Date(),
      lastUsedStep: BigInt(result.step!),
    },
  });

  await prisma.user.update({
    where: { id: enrolment.userId },
    data: { mfaEnrolledAt: new Date() },
  });

  const codes = Array.from({ length: 10 }, generateRecoveryCode);
  await prisma.mfaRecoveryCode.createMany({
    data: codes.map((c) => ({ userId: enrolment.userId, codeHash: hashToken(c) })),
  });

  // Returned once, never retrievable again.
  return { recoveryCodes: codes };
}

// ------------------------------------------------------------------ login

export type LoginResult =
  | { status: "MFA_REQUIRED"; userId: string }
  | { status: "MFA_ENROLMENT_REQUIRED"; userId: string };

/**
 * Step 1 of login. Never returns a session on its own: AUTH01 requires MFA
 * for staff, so a correct password alone is not an authenticated state.
 */
export async function login(email: string, password: string): Promise<LoginResult> {
  await consumeRateLimit(`login:${email.toLowerCase()}`, LOGIN_LIMIT);

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true, status: true, suspendedAt: true,
      credential: { select: { passwordHash: true, failedAttempts: true, lockedUntil: true } },
      mfaEnrolments: { where: { confirmedAt: { not: null }, revokedAt: null }, select: { id: true } },
    },
  });

  // Same error whether the account is unknown or the password is wrong, so
  // login cannot be used to enumerate staff email addresses.
  const invalid = new AuthError("Invalid email or password.", "INVALID_CREDENTIALS");

  if (!user?.credential) throw invalid;
  if (user.status === "SUSPENDED" || user.suspendedAt) {
    throw new AuthError("This account is suspended.", "ACCOUNT_SUSPENDED");
  }
  if (user.status === "DEACTIVATED") throw invalid;

  if (user.credential.lockedUntil && user.credential.lockedUntil > new Date()) {
    throw new AuthError("Account temporarily locked.", "ACCOUNT_LOCKED");
  }

  const ok = await verifyPassword(password, user.credential.passwordHash);

  if (!ok) {
    const attempts = user.credential.failedAttempts + 1;
    await prisma.userCredential.update({
      where: { userId: user.id },
      data: {
        failedAttempts: attempts,
        lockedUntil: attempts >= LOGIN_LIMIT.max ? new Date(Date.now() + ACCOUNT_LOCK_MS) : null,
      },
    });
    await audit(user.id, null, "LOGIN_FAILED", "FAILURE", "Invalid password");
    throw invalid;
  }

  await prisma.userCredential.update({
    where: { userId: user.id },
    data: { failedAttempts: 0, lockedUntil: null },
  });

  if (user.mfaEnrolments.length === 0) {
    return { status: "MFA_ENROLMENT_REQUIRED", userId: user.id };
  }
  return { status: "MFA_REQUIRED", userId: user.id };
}

/** Step 2 of login. Only this creates a session. */
export async function completeLoginWithTotp(
  userId: string,
  code: string,
  // `at` exists so tests can advance the TOTP clock deterministically instead
  // of sleeping 30 s per login. It only shifts which time step is checked; the
  // replay guard below still applies, so it cannot be used to reuse a code.
  context: { deviceLabel?: string; userAgent?: string; at?: Date } = {},
) {
  const enrolment = await prisma.mfaEnrolment.findFirst({
    where: { userId, confirmedAt: { not: null }, revokedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!enrolment) throw new AuthError("No active MFA enrolment.", "MFA_NOT_ENROLLED");

  const secret = decryptSecret({
    ciphertext: enrolment.secretCiphertext,
    iv: enrolment.secretIv,
    authTag: enrolment.secretAuthTag,
  });

  const result = verifyTotp(secret, code, {
    at: context.at,
    lastUsedStep: enrolment.lastUsedStep,
  });
  if (!result.valid) {
    await audit(userId, null, "MFA_FAILED", "FAILURE", result.reason);
    throw new AuthError(result.reason ?? "Invalid code", "MFA_INVALID");
  }

  await prisma.mfaEnrolment.update({
    where: { id: enrolment.id },
    data: { lastUsedAt: new Date(), lastUsedStep: BigInt(result.step!) },
  });

  return createSession(userId, context);
}

export async function createSession(
  userId: string,
  context: { deviceLabel?: string; userAgent?: string } = {},
) {
  const token = generateToken();
  const now = new Date();

  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      deviceLabel: context.deviceLabel,
      userAgent: context.userAgent,
      mfaVerifiedAt: now,
      idleExpiresAt: new Date(now.getTime() + IDLE_TIMEOUT_MS),
      absoluteExpiresAt: new Date(now.getTime() + ABSOLUTE_TIMEOUT_MS),
    },
  });

  await audit(userId, null, "LOGIN_SUCCEEDED", "SUCCESS");

  // The raw token is returned once, to be set as a secure, httpOnly,
  // SameSite=Lax cookie by the caller. Only its hash is stored.
  return { sessionId: session.id, token, expiresAt: session.absoluteExpiresAt };
}

export type ValidatedSession = { sessionId: string; userId: string };

/**
 * AUTH02: expiry is enforced HERE, on the server, on every request — an
 * unexpired cookie is not evidence of a live session.
 */
export async function validateSession(token: string): Promise<ValidatedSession> {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true, userId: true, revokedAt: true,
      idleExpiresAt: true, absoluteExpiresAt: true,
      user: { select: { status: true, suspendedAt: true } },
    },
  });

  if (!session) throw new AuthError("Session not found.", "SESSION_INVALID");

  const now = new Date();
  if (session.revokedAt) throw new AuthError("Session revoked.", "SESSION_REVOKED");
  if (session.absoluteExpiresAt <= now) {
    throw new AuthError("Session expired (12 hour maximum).", "SESSION_EXPIRED");
  }
  if (session.idleExpiresAt <= now) {
    throw new AuthError("Session expired (30 minutes idle).", "SESSION_IDLE_EXPIRED");
  }
  if (session.user.status === "SUSPENDED" || session.user.suspendedAt) {
    throw new AuthError("Account suspended.", "ACCOUNT_SUSPENDED");
  }

  // Sliding idle window, but never past the absolute deadline.
  await prisma.session.update({
    where: { id: session.id },
    data: {
      lastSeenAt: now,
      idleExpiresAt: new Date(
        Math.min(now.getTime() + IDLE_TIMEOUT_MS, session.absoluteExpiresAt.getTime()),
      ),
    },
  });

  return { sessionId: session.id, userId: session.userId };
}

export async function revokeSession(sessionId: string, reason: string) {
  return prisma.session.update({
    where: { id: sessionId },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}

// -------------------------------------------------------------- step-up

/** AUTH02: exports, role changes and secret reveal need a fresh MFA proof. */
export async function requireStepUp(
  sessionId: string,
  purpose: "EXPORT" | "ROLE_CHANGE" | "SECRET_REVEAL",
  code: string,
  at?: Date,
) {
  const session = await prisma.session.findUniqueOrThrow({
    where: { id: sessionId },
    select: { id: true, userId: true, revokedAt: true },
  });
  if (session.revokedAt) throw new AuthError("Session revoked.", "SESSION_REVOKED");

  await consumeRateLimit(`stepup:${session.userId}`, STEP_UP_LIMIT);

  const enrolment = await prisma.mfaEnrolment.findFirst({
    where: { userId: session.userId, confirmedAt: { not: null }, revokedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!enrolment) throw new AuthError("No active MFA enrolment.", "MFA_NOT_ENROLLED");

  const secret = decryptSecret({
    ciphertext: enrolment.secretCiphertext,
    iv: enrolment.secretIv,
    authTag: enrolment.secretAuthTag,
  });

  const result = verifyTotp(secret, code, { at, lastUsedStep: enrolment.lastUsedStep });
  if (!result.valid) throw new AuthError(result.reason ?? "Invalid code", "MFA_INVALID");

  await prisma.mfaEnrolment.update({
    where: { id: enrolment.id },
    data: { lastUsedAt: new Date(), lastUsedStep: BigInt(result.step!) },
  });

  const challenge = await prisma.stepUpChallenge.create({
    data: {
      sessionId,
      purpose,
      satisfiedAt: new Date(),
      expiresAt: new Date(Date.now() + STEP_UP_TTL_MS),
    },
  });

  await audit(session.userId, null, `STEP_UP_${purpose}`, "SUCCESS");
  return challenge;
}

export async function hasValidStepUp(
  sessionId: string,
  purpose: "EXPORT" | "ROLE_CHANGE" | "SECRET_REVEAL",
): Promise<boolean> {
  const challenge = await prisma.stepUpChallenge.findFirst({
    where: {
      sessionId,
      purpose,
      satisfiedAt: { not: null },
      expiresAt: { gt: new Date() },
    },
  });
  return challenge !== null;
}

// ------------------------------------------------------------ invitations

/**
 * AUTH03. An invitation names exactly ONE practice: sharing an email domain
 * with an existing user must never enrol someone in both practices.
 */
export async function createInvitation(params: {
  email: string;
  practiceId: string;
  role: Parameters<typeof prisma.invitation.create>[0]["data"]["role"];
  invitedByUserId: string;
  invitedByName: string;
  channel: string;
  ttlMs?: number;
}) {
  await consumeRateLimit(`invite:${params.practiceId}`, INVITE_LIMIT);

  const token = generateToken();

  const invitation = await prisma.invitation.create({
    data: {
      email: params.email,
      practiceId: params.practiceId,
      role: params.role,
      tokenHash: hashToken(token),
      channel: params.channel,
      expiresAt: new Date(Date.now() + (params.ttlMs ?? INVITATION_TTL_MS)),
      invitedByUserId: params.invitedByUserId,
      invitedByName: params.invitedByName,
    },
  });

  await audit(params.invitedByUserId, params.practiceId, "INVITATION_CREATED", "SUCCESS");

  // Token returned once, for delivery through the approved channel.
  return { invitationId: invitation.id, token, expiresAt: invitation.expiresAt };
}

/** Single-use: accepting consumes the invitation and enrols in ONE practice. */
export async function acceptInvitation(token: string, password: string, fullName: string) {
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
  });

  if (!invitation) throw new AuthError("Invitation not found.", "INVITATION_INVALID");
  if (invitation.revokedAt) throw new AuthError("Invitation revoked.", "INVITATION_REVOKED");
  if (invitation.acceptedAt) throw new AuthError("Invitation already used.", "INVITATION_USED");
  if (invitation.expiresAt <= new Date()) {
    throw new AuthError("Invitation expired.", "INVITATION_EXPIRED");
  }

  assertPasswordAllowed(invitation.email, password);

  const user = await prisma.user.upsert({
    where: { email: invitation.email },
    create: {
      email: invitation.email,
      fullName,
      status: "ACTIVE",
      acceptedAt: new Date(),
      invitedByUserId: invitation.invitedByUserId,
    },
    update: { status: "ACTIVE", acceptedAt: new Date() },
  });

  await setPassword(user.id, password);

  // Exactly one membership, in the invited practice only.
  await prisma.practiceMembership.create({
    data: {
      practiceId: invitation.practiceId,
      userId: user.id,
      role: invitation.role,
      effectiveFrom: new Date(),
    },
  });

  await prisma.invitation.update({
    where: { id: invitation.id },
    data: { acceptedAt: new Date(), acceptedByUserId: user.id },
  });

  await audit(user.id, invitation.practiceId, "INVITATION_ACCEPTED", "SUCCESS");

  return { userId: user.id, practiceId: invitation.practiceId };
}

// --------------------------------------------------------------- recovery

/**
 * AUTH02 acceptance evidence: "Verify reset and MFA recovery with the owner
 * absent; there must be a documented authorised substitute process."
 *
 * An MFA reset therefore cannot be self-served. It requires a named
 * substitute approver, and it does NOT switch MFA off — it revokes the old
 * enrolment and forces a new one, so MFA can never be silently removed.
 */
export async function requestRecovery(params: {
  userId: string;
  kind: "PASSWORD_RESET" | "MFA_RESET";
  reason: string;
  requestedByName: string;
  ttlMs?: number;
}) {
  const token = generateToken();

  const request = await prisma.recoveryRequest.create({
    data: {
      userId: params.userId,
      kind: params.kind,
      tokenHash: hashToken(token),
      reason: params.reason,
      requestedByName: params.requestedByName,
      expiresAt: new Date(Date.now() + (params.ttlMs ?? 3600_000)),
    },
  });

  await audit(params.userId, null, `RECOVERY_REQUESTED_${params.kind}`, "SUCCESS", params.reason);
  return { requestId: request.id, token };
}

export class RecoveryNotApprovedError extends Error {
  readonly status = 403;
  readonly code = "RECOVERY_NOT_APPROVED";
  constructor(message: string) {
    super(message);
    this.name = "RecoveryNotApprovedError";
  }
}

/** The documented substitute process: a second entitled person authorises. */
export async function approveRecovery(params: {
  requestId: string;
  approverUserId: string;
  approverName: string;
}) {
  const request = await prisma.recoveryRequest.findUniqueOrThrow({
    where: { id: params.requestId },
  });

  if (request.userId === params.approverUserId) {
    throw new RecoveryNotApprovedError(
      "A recovery request cannot be approved by its own subject.",
    );
  }

  const approved = await prisma.recoveryRequest.update({
    where: { id: params.requestId },
    data: {
      approverUserId: params.approverUserId,
      approverName: params.approverName,
      approvedAt: new Date(),
    },
  });

  await audit(
    params.approverUserId,
    null,
    `RECOVERY_APPROVED_${request.kind}`,
    "SUCCESS",
    `Approved for user ${request.userId} by substitute ${params.approverName}`,
  );

  return approved;
}

export async function consumeRecovery(token: string, newPassword?: string) {
  const request = await prisma.recoveryRequest.findUnique({
    where: { tokenHash: hashToken(token) },
  });

  if (!request) throw new AuthError("Recovery request not found.", "RECOVERY_INVALID");
  if (request.usedAt) throw new AuthError("Recovery already used.", "RECOVERY_USED");
  if (request.expiresAt <= new Date()) {
    throw new AuthError("Recovery expired.", "RECOVERY_EXPIRED");
  }
  if (!request.approvedAt) {
    throw new RecoveryNotApprovedError(
      "Recovery requires approval by an authorised substitute before it can be used.",
    );
  }

  if (request.kind === "PASSWORD_RESET") {
    if (!newPassword) throw new AuthError("A new password is required.", "PASSWORD_REQUIRED");
    await setPassword(request.userId, newPassword);
  } else {
    // MFA_RESET: revoke the old enrolment and force re-enrolment. MFA is
    // never left simply switched off.
    await prisma.mfaEnrolment.updateMany({
      where: { userId: request.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await prisma.mfaRecoveryCode.deleteMany({ where: { userId: request.userId, usedAt: null } });
    await prisma.user.update({
      where: { id: request.userId },
      data: { mfaEnrolledAt: null },
    });
  }

  // Any live session is killed — recovery implies the account may be compromised.
  await prisma.session.updateMany({
    where: { userId: request.userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: `Recovery performed: ${request.kind}` },
  });

  await prisma.recoveryRequest.update({
    where: { id: request.id },
    data: { usedAt: new Date() },
  });

  await audit(request.userId, null, `RECOVERY_COMPLETED_${request.kind}`, "SUCCESS", request.reason);

  return {
    kind: request.kind,
    // The caller must now walk the user through fresh enrolment.
    mfaReenrolmentRequired: request.kind === "MFA_RESET",
  };
}

/** Single-use backup code path, for a lost authenticator without a reset. */
export async function consumeRecoveryCode(userId: string, code: string) {
  const candidates = await prisma.mfaRecoveryCode.findMany({
    where: { userId, usedAt: null },
  });

  const match = candidates.find((c) => c.codeHash === hashToken(code.trim().toUpperCase()));
  if (!match) throw new AuthError("Invalid recovery code.", "RECOVERY_CODE_INVALID");

  await prisma.mfaRecoveryCode.update({
    where: { id: match.id },
    data: { usedAt: new Date() },
  });

  await audit(userId, null, "RECOVERY_CODE_USED", "SUCCESS");
  return createSession(userId);
}

async function audit(
  userId: string | null,
  practiceId: string | null,
  action: string,
  result: "SUCCESS" | "FAILURE",
  reason?: string,
) {
  try {
    await prisma.event.create({
      data: {
        practiceId,
        actorUserId: userId,
        targetType: "Auth",
        targetId: userId ?? "unknown",
        action,
        result,
        reason,
      },
    });
  } catch {
    // Audit failure must not mask the auth decision.
  }
}
