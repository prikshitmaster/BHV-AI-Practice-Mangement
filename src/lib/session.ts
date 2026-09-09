/**
 * Actor resolution.
 *
 * TEMPORARY (T03) — real authentication is T05 (AUTH01-05: MFA, 30 min idle /
 * 12 hr max sessions, invitation bootstrap). Until then the actor is read from
 * a request header so the practice-scope guard can be built and tested ahead
 * of the login screen.
 *
 * This deliberately FAILS CLOSED: no header means no actor, and no actor means
 * no data. There is no fallback user and no "anonymous sees everything" path.
 * T05 replaces the body of requireUserId() with a real session lookup; every
 * caller keeps working unchanged.
 */

import { headers } from "next/headers";

export class UnauthenticatedError extends Error {
  readonly code = "UNAUTHENTICATED";
  readonly status = 401;

  constructor() {
    super("Authentication required");
    this.name = "UnauthenticatedError";
  }
}

const DEV_ACTOR_HEADER = "x-bhv-user-id";

export async function requireUserId(): Promise<string> {
  const headerList = await headers();
  const userId = headerList.get(DEV_ACTOR_HEADER)?.trim();

  if (!userId) throw new UnauthenticatedError();

  return userId;
}
