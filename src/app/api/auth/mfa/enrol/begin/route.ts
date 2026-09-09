import { NextResponse } from "next/server";
import { beginMfaEnrolment } from "@/lib/auth";
import { verifyLoginChallenge } from "@/lib/login-challenge";
import { errorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

/** First-time login: no confirmed MFA enrolment exists yet, so it starts here. */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const userId = verifyLoginChallenge(String(body.challenge ?? ""));

    const { enrolmentId, secret } = await beginMfaEnrolment(userId);
    return NextResponse.json({
      enrolmentId,
      secret,
      otpauthUri: `otpauth://totp/BHV:${userId}?secret=${secret}&issuer=BHV`,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
