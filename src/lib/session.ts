/**
 * Actor resolution for API routes — AUTH02 (PRD §10).
 *
 * As of T05 this reads a real, database-backed session cookie and enforces
 * expiry and revocation server-side on every request.
 *
 * The `x-bhv-user-id` header from T03 still works, but ONLY outside
 * production: the T03/T04 test suites drive the scope guard through it, and
 * removing it would cost that coverage. `assertNoDevAuthInProduction()` makes
 * the bypass impossible to ship (AUTH01: no shared admin login, no default
 * credential, nothing demo-derived reaching production).
 */

import { headers, cookies } from "next/headers";
import { validateSession } from "@/lib/auth";

export class UnauthenticatedError extends Error {
  readonly code = "UNAUTHENTICATED";
  readonly status = 401;

  constructor(message = "Authentication required") {
    super(message);
    this.name = "UnauthenticatedError";
  }
}

export const SESSION_COOKIE = "bhv_session";
const DEV_ACTOR_HEADER = "x-bhv-user-id";

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * AUTH01 deployment guard. Called at startup and by the test suite: if the
 * development actor bypass is somehow enabled in production, fail loudly
 * rather than serve a request with it.
 */
export function assertNoDevAuthInProduction(): void {
  if (isProduction() && process.env.ALLOW_DEV_ACTOR_HEADER === "true") {
    throw new Error(
      "ALLOW_DEV_ACTOR_HEADER must never be enabled in production — it bypasses authentication.",
    );
  }
}

/** The cookie attributes AUTH02 requires. */
export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}

export type Actor = { userId: string; sessionId: string | null };

export async function requireActor(): Promise<Actor> {
  assertNoDevAuthInProduction();

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (token) {
    const session = await validateSession(token);
    return { userId: session.userId, sessionId: session.sessionId };
  }

  // Development/test bypass — never available in production.
  if (!isProduction()) {
    const headerList = await headers();
    const devUserId = headerList.get(DEV_ACTOR_HEADER)?.trim();
    if (devUserId) return { userId: devUserId, sessionId: null };
  }

  throw new UnauthenticatedError();
}

export async function requireUserId(): Promise<string> {
  return (await requireActor()).userId;
}
