/**
 * Portal actor resolution — the client-side twin of `src/lib/session.ts`.
 *
 * Kept in its own file for the same reason `session.ts` is separate from
 * `auth.ts`: this one imports `next/headers` and so can only run inside a
 * request, while `portal-auth.ts` stays importable from scripts and tests.
 *
 * There is no development header bypass here, unlike the staff resolver. The
 * `x-bhv-user-id` escape hatch exists because the T03/T04 suites drive the
 * staff scope guard through it; the portal suite signs in through the real
 * invitation flow instead, so the bypass would be a hole with nothing on the
 * other side of it.
 */

import { cookies } from "next/headers";
import {
  PORTAL_SESSION_COOKIE,
  PortalAuthError,
  validatePortalSession,
  type PortalActor,
} from "@/lib/portal-auth";

export async function requirePortalContact(): Promise<PortalActor> {
  const cookieStore = await cookies();
  const token = cookieStore.get(PORTAL_SESSION_COOKIE)?.value;

  if (!token) {
    throw new PortalAuthError("Sign in to continue.", "PORTAL_UNAUTHENTICATED", 401);
  }

  return validatePortalSession(token);
}

/** Returns null instead of throwing, for screens that render a signed-out state. */
export async function optionalPortalContact(): Promise<PortalActor | null> {
  try {
    return await requirePortalContact();
  } catch {
    return null;
  }
}
