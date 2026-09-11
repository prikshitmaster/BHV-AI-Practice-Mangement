import { NextResponse } from "next/server";
import { badRequest, errorResponse } from "@/lib/api";
import { assertCsrf } from "@/lib/csrf";
import { requireUserId } from "@/lib/session";
import { listIncidents, reportIncident } from "@/lib/incidents";

export const dynamic = "force-dynamic";

/** PRV04: incidents in one practice, each with its derived clocks. */
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const practiceId = new URL(request.url).searchParams.get("practiceId");
    if (!practiceId) return badRequest("practiceId is required");
    return NextResponse.json({ incidents: await listIncidents(userId, practiceId) });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * Report a suspected incident. Open to all staff (incident.report): the
 * clocks run from awareness, so the report must not wait for a partner.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    await assertCsrf(request);
    const body = await request.json().catch(() => ({}));
    if (typeof body.practiceId !== "string") return badRequest("practiceId is required");
    if (body.track !== "SECURITY" && body.track !== "ROUTINE_SUPPORT") {
      return badRequest("track must be SECURITY or ROUTINE_SUPPORT");
    }
    const awarenessAt = new Date(body.awarenessAt);
    if (typeof body.awarenessAt !== "string" || Number.isNaN(awarenessAt.getTime())) {
      return badRequest("awarenessAt must be a date and time", "AWARENESS_REQUIRED");
    }
    const incident = await reportIncident({
      actorUserId: userId,
      practiceId: body.practiceId,
      track: body.track,
      awarenessAt,
      title: String(body.title ?? ""),
      summary: String(body.summary ?? ""),
    });
    return NextResponse.json({ ok: true, id: incident.id }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
