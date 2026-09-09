import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { assertCsrf } from "@/lib/csrf";
import { requirePortalContact } from "@/lib/portal-session";
import { PORTAL_SESSION_COOKIE, revokePortalSession } from "@/lib/portal-auth";

export const dynamic = "force-dynamic";

/**
 * Signing out revokes server-side and clears the cookie, in that order — the
 * same rule as staff logout. Clearing only the cookie would leave a live
 * session behind for anyone holding a copy of the token.
 */
export async function POST(request: Request) {
  try {
    const actor = await requirePortalContact();
    await assertCsrf(request);

    await revokePortalSession(actor.sessionId, "Signed out by the contact");

    const response = NextResponse.json({ ok: true });
    // Must match the path the cookie was SET with, or the browser keeps the
    // original alongside this one and keeps sending it.
    response.cookies.set(PORTAL_SESSION_COOKIE, "", {
      httpOnly: true,
      path: "/",
      expires: new Date(0),
    });
    return response;
  } catch (e) {
    return errorResponse(e);
  }
}
