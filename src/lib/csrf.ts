/**
 * SEC03 — CSRF protection (PRD §35).
 *
 * The session cookie is SameSite=Lax, which stops cross-site POSTs in current
 * browsers. That is not enough on its own: Lax still permits top-level
 * navigations, and older clients vary. So state-changing requests must also
 * carry a double-submit token AND come from a same-origin request.
 *
 * Safe methods are exempt; anything that mutates is not.
 */

import { cookies } from "next/headers";
import { generateToken, hashToken } from "@/lib/crypto";

/**
 * The names and the error type live in csrf-shared.ts so that client
 * components and middleware can reach them without dragging `next/headers` and
 * `node:crypto` along. Re-exported here so server code has one import path.
 */
export {
  /** Holds the token's HASH. httpOnly — script must not be able to read it. */
  CSRF_COOKIE,
  /**
   * Holds the RAW token, deliberately readable by the app's own script so it
   * can echo it in the header below. Same-origin policy is what protects it:
   * another origin can read neither cookie, which is the whole basis of
   * double submit.
   */
  CSRF_RAW_COOKIE,
  CSRF_HEADER,
  CsrfError,
} from "@/lib/csrf-shared";

import { CSRF_COOKIE, CSRF_HEADER, CsrfError } from "@/lib/csrf-shared";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function issueCsrfToken(): { token: string; cookieValue: string } {
  const token = generateToken(32);
  // The cookie holds the hash, the client echoes the raw token in a header.
  return { token, cookieValue: hashToken(token) };
}

export function csrfCookieOptions() {
  return {
    httpOnly: false, // the client script must read it to echo it back
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
  };
}

/** Throws unless this mutating request carries a valid, same-origin CSRF proof. */
export async function assertCsrf(request: Request): Promise<void> {
  if (SAFE_METHODS.has(request.method)) return;

  // Origin check first — cheap, and catches the common case.
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");

  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw new CsrfError("Malformed Origin header");
    }
    if (originHost !== host) {
      throw new CsrfError("Cross-origin request refused");
    }
  }

  const submitted = request.headers.get(CSRF_HEADER);
  if (!submitted) throw new CsrfError("Missing CSRF token");

  const cookieStore = await cookies();
  const expected = cookieStore.get(CSRF_COOKIE)?.value;
  if (!expected) throw new CsrfError("Missing CSRF cookie");

  if (hashToken(submitted) !== expected) {
    throw new CsrfError("CSRF token mismatch");
  }
}
