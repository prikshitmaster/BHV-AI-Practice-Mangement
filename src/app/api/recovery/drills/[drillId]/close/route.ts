import { NextResponse } from "next/server";
import { badRequest } from "@/lib/api";
import { requireUserId } from "@/lib/session";
import { assertCsrf } from "@/lib/csrf";
import { closeRemediation } from "@/lib/drills";
import { recoveryErrorResponse } from "@/lib/recovery-api";

export const dynamic = "force-dynamic";

/** BCP06: close a drill's remediation. The findings stay; the closure is appended. */
export async function POST(
  request: Request,
  context: { params: Promise<{ drillId: string }> },
) {
  try {
    const userId = await requireUserId();
    await assertCsrf(request);
    const { drillId } = await context.params;
    const body = await request.json().catch(() => ({}));

    if (typeof body.expectedVersion !== "number") return badRequest("expectedVersion is required");
    if (typeof body.note !== "string") return badRequest("note is required", "NOTE_REQUIRED");

    const result = await closeRemediation({
      drillId,
      actorUserId: userId,
      expectedVersion: body.expectedVersion,
      note: body.note,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return recoveryErrorResponse(e);
  }
}
