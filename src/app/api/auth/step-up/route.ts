import { NextResponse } from "next/server";
import { apiError, badRequest, errorResponse } from "@/lib/api";
import { assertCsrf } from "@/lib/csrf";
import { requireActor } from "@/lib/session";
import { requireStepUp } from "@/lib/auth";

export const dynamic = "force-dynamic";

const PURPOSES = ["EXPORT", "ROLE_CHANGE", "SECRET_REVEAL"] as const;
type Purpose = (typeof PURPOSES)[number];

/**
 * AUTH02 step-up: a fresh authenticator code for the most sensitive acts.
 *
 * Bound to the caller's own DB-backed session — the dev actor header has no
 * session, so it cannot step up, and a step-up can only ever vouch for the
 * session that proved it. Rate limited inside requireStepUp.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireActor();
    await assertCsrf(request);

    if (!actor.sessionId) {
      return apiError(401, "SESSION_REQUIRED", "Sign in with your account to confirm this action.");
    }

    const body = await request.json().catch(() => ({}));
    const purpose = body.purpose as Purpose;
    if (!PURPOSES.includes(purpose)) return badRequest("Unknown step-up purpose");
    if (typeof body.code !== "string" || !/^\d{6}$/.test(body.code.trim())) {
      return badRequest("Enter the 6-digit code from your authenticator app.", "MFA_INVALID");
    }

    const challenge = await requireStepUp(actor.sessionId, purpose, body.code.trim());
    return NextResponse.json({ ok: true, purpose, expiresAt: challenge.expiresAt });
  } catch (e) {
    return errorResponse(e);
  }
}
