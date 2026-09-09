/**
 * Short-lived, signed proof that step 1 of login (AUTH01-03, PRD §10) already
 * succeeded.
 *
 * login() returns only a status — it was never asked to prove WHO passed the
 * password check. Without something like this, the MFA-verify and
 * MFA-enrolment routes that follow would have to trust a client-supplied
 * userId, which would let anyone drive step two for an account they never
 * authenticated against (worst case: confirm their own MFA secret against a
 * stranger's account).
 *
 * The challenge is delivered in the JSON response body, not a cookie: a
 * cross-origin page cannot read another origin's fetch response, so this
 * also removes the need to wire this flow into the app-wide CSRF
 * double-submit cookie (which nothing currently issues — see SECURITY.md).
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const TTL_MS = 5 * 60_000;

export class LoginChallengeError extends Error {
  readonly status = 401;
  readonly code = "LOGIN_CHALLENGE_INVALID";
  constructor(message: string) {
    super(message);
    this.name = "LoginChallengeError";
  }
}

function key(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) throw new Error("APP_ENCRYPTION_KEY is not set.");
  return Buffer.from(raw, "base64");
}

function sign(payload: string): string {
  return createHmac("sha256", key()).update(payload).digest("base64url");
}

export function issueLoginChallenge(userId: string): string {
  const payload = `${userId}.${Date.now() + TTL_MS}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyLoginChallenge(token: string): string {
  const parts = token.split(".");
  if (parts.length !== 3) throw new LoginChallengeError("Malformed login challenge.");
  const [userId, expStr, signature] = parts;
  const expected = sign(`${userId}.${expStr}`);

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new LoginChallengeError("Invalid login challenge.");
  }
  if (Number(expStr) < Date.now()) {
    throw new LoginChallengeError("That took too long — start again.");
  }
  return userId;
}
