import { NextResponse } from "next/server";
import { badRequest } from "@/lib/api";
import { requireUserId } from "@/lib/session";
import { assertCsrf } from "@/lib/csrf";
import { releaseOutboundHold } from "@/lib/restore";
import { recoveryErrorResponse } from "@/lib/recovery-api";

export const dynamic = "force-dynamic";

/**
 * BCP03: release the outbound hold on a reconciled restore. Refused on any
 * failed or absent reconciliation check, on a stale version, and for anyone
 * without system administration — all inside releaseOutboundHold.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ restoreRunId: string }> },
) {
  try {
    const userId = await requireUserId();
    await assertCsrf(request);
    const { restoreRunId } = await context.params;
    const body = await request.json().catch(() => ({}));

    if (typeof body.expectedVersion !== "number") return badRequest("expectedVersion is required");
    if (typeof body.reason !== "string" || !body.reason.trim()) {
      return badRequest("Say why the hold can be released", "REASON_REQUIRED");
    }

    const result = await releaseOutboundHold({
      restoreRunId,
      releasedByUserId: userId,
      reason: body.reason.trim(),
      expectedVersion: body.expectedVersion,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return recoveryErrorResponse(e);
  }
}
