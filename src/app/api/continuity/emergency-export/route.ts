import { NextResponse } from "next/server";
import { apiError, badRequest, errorResponse } from "@/lib/api";
import { assertCsrf } from "@/lib/csrf";
import { requireActor } from "@/lib/session";
import { emergencyObligationExport } from "@/lib/continuity";

export const dynamic = "force-dynamic";

/**
 * BCP04 controlled emergency obligation export. POST, not GET: it is a
 * logged, step-up-gated act with a stated reason, and a GET would let a link
 * or a prefetch trigger it. Every control lives in the library; this route
 * only carries the session id through so the step-up can be checked against
 * the caller's OWN session.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireActor();
    await assertCsrf(request);
    if (!actor.sessionId) {
      return apiError(401, "SESSION_REQUIRED", "Sign in with your account to export.");
    }

    const body = await request.json().catch(() => ({}));
    if (typeof body.practiceId !== "string") return badRequest("practiceId is required");
    if (typeof body.reason !== "string") return badRequest("reason is required", "REASON_REQUIRED");

    const exp = await emergencyObligationExport({
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      practiceId: body.practiceId,
      reason: body.reason,
    });

    return new NextResponse(exp.csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${exp.filename}"`,
        "cache-control": "no-store",
        "x-bhv-export-scope": exp.practiceId,
        "x-bhv-export-row-count": String(exp.rowCount),
        "x-bhv-export-sha256": exp.sha256,
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
