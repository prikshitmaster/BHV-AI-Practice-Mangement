import { NextResponse } from "next/server";
import { confirmMfaEnrolment, createSession } from "@/lib/auth";
import { verifyLoginChallenge, LoginChallengeError } from "@/lib/login-challenge";
import { sessionCookieOptions, SESSION_COOKIE } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { errorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const userId = verifyLoginChallenge(String(body.challenge ?? ""));
    const enrolmentId = String(body.enrolmentId ?? "");
    const code = String(body.code ?? "");

    const enrolment = await prisma.mfaEnrolment.findUniqueOrThrow({ where: { id: enrolmentId } });
    if (enrolment.userId !== userId) {
      // Would only happen if a challenge from one login attempt were replayed
      // against an enrolmentId minted for a different one.
      throw new LoginChallengeError("This enrolment does not belong to the current login attempt.");
    }

    const { recoveryCodes } = await confirmMfaEnrolment(enrolmentId, code);
    const { token, expiresAt } = await createSession(userId, {
      userAgent: request.headers.get("user-agent") ?? undefined,
    });

    const response = NextResponse.json({ ok: true, recoveryCodes });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
    return response;
  } catch (e) {
    return errorResponse(e);
  }
}
