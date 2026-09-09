import { NextResponse } from "next/server";
import { completeLoginWithTotp } from "@/lib/auth";
import { verifyLoginChallenge } from "@/lib/login-challenge";
import { sessionCookieOptions, SESSION_COOKIE } from "@/lib/session";
import { errorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Step 2 for a user with an already-confirmed MFA enrolment. */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const userId = verifyLoginChallenge(String(body.challenge ?? ""));
    const code = String(body.code ?? "");

    const { token, expiresAt } = await completeLoginWithTotp(userId, code, {
      userAgent: request.headers.get("user-agent") ?? undefined,
    });

    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
    return response;
  } catch (e) {
    return errorResponse(e);
  }
}
