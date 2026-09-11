import { NextResponse } from "next/server";
import { badRequest, errorResponse } from "@/lib/api";
import { assertCsrf } from "@/lib/csrf";
import { requireUserId } from "@/lib/session";
import { createErasureRequest, listErasureRequests } from "@/lib/erasure";

export const dynamic = "force-dynamic";

/** PRV06: erasure requests in one practice, with every item and its decision. */
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const practiceId = new URL(request.url).searchParams.get("practiceId");
    if (!practiceId) return badRequest("practiceId is required");
    return NextResponse.json({ requests: await listErasureRequests(userId, practiceId) });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * Log an erasure request against an engagement. The library lists every item
 * with what must be retained; the engagement and contact must belong to the
 * named practice or the answer is a 404.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    await assertCsrf(request);
    const body = await request.json().catch(() => ({}));
    if (typeof body.practiceId !== "string") return badRequest("practiceId is required");
    if (typeof body.engagementId !== "string") return badRequest("engagementId is required");
    const created = await createErasureRequest({
      actorUserId: userId,
      practiceId: body.practiceId,
      engagementId: body.engagementId,
      contactId: typeof body.contactId === "string" && body.contactId ? body.contactId : null,
      receivedVia: String(body.receivedVia ?? ""),
      requestText: String(body.requestText ?? ""),
    });
    return NextResponse.json({ ok: true, id: created.id }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
