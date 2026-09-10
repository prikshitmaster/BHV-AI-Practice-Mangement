import { NextResponse } from "next/server";
import { login } from "@/lib/auth";
import { issueLoginChallenge } from "@/lib/login-challenge";
import { badRequest, errorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Step 1 of login (AUTH01-03, PRD §10). Never sets a session on its own — a
 * correct password alone is not an authenticated state, see login()'s own
 * comment in src/lib/auth.ts. `challenge` proves this step succeeded for
 * step 2 (MFA verify, or first-time MFA enrolment).
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    if (!email || !password) {
      return badRequest("Email and password are required.", "BAD_REQUEST");
    }

    const result = await login(email, password);
    return NextResponse.json({
      status: result.status,
      challenge: issueLoginChallenge(result.userId),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
