import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { assertCsrf } from "@/lib/csrf";
import { requestInvitationRenewal } from "@/lib/portal-auth";

export const dynamic = "force-dynamic";

/**
 * POR05 expired-link recovery, and the §17 acceptance evidence: "an expired
 * invitation gives a safe renewal request without identifying the client to an
 * unauthenticated visitor."
 *
 * The response is 200 with the same acknowledgement whether or not the token
 * matched anything — including for a token that never existed. A 404 here, or
 * a different message, would turn this endpoint into the account-discovery
 * oracle POR02 forbids.
 */
export async function POST(request: Request) {
  try {
    await assertCsrf(request);

    const body = await request.json();
    const token = String(body.token ?? "").trim();
    if (!token) {
      return NextResponse.json(
        { error: "Paste the link you were sent so we can renew it.", code: "NO_TOKEN" },
        { status: 400 },
      );
    }

    const result = await requestInvitationRenewal({ token });
    return NextResponse.json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
