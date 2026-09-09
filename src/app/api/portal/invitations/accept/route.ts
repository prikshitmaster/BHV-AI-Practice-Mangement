import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { assertCsrf } from "@/lib/csrf";
import {
  acceptPortalInvitation,
  PORTAL_SESSION_COOKIE,
  portalCookieOptions,
} from "@/lib/portal-auth";
import { listPortalEntities } from "@/lib/portal";

export const dynamic = "force-dynamic";

/**
 * POR02 redemption — the only way into the portal.
 *
 * Every failure inside `acceptPortalInvitation` throws one PortalAuthError with
 * one message, so this route has nothing to decide: an unknown, expired, used
 * and revoked token are indistinguishable from here too. That is deliberate —
 * a route that "helpfully" separated them would undo the property the library
 * is built to hold.
 */
export async function POST(request: Request) {
  try {
    await assertCsrf(request);

    const body = await request.json();
    const token = String(body.token ?? "").trim();
    if (!token) {
      return NextResponse.json(
        { error: "A sign-in link is required.", code: "NO_TOKEN" },
        { status: 400 },
      );
    }

    const session = await acceptPortalInvitation({
      token,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });

    const entities = await listPortalEntities({
      contactId: session.contactId,
      practiceId: session.practiceId,
    });

    const response = NextResponse.json({
      ok: true,
      // The landing entity is chosen here rather than left to the client, so a
      // contact with several entities never sees an unscoped screen.
      entities,
      activeEntityId: entities[0]?.clientRelationshipId ?? null,
    });
    response.cookies.set(
      PORTAL_SESSION_COOKIE,
      session.token,
      portalCookieOptions(session.expiresAt),
    );
    return response;
  } catch (e) {
    return errorResponse(e);
  }
}
