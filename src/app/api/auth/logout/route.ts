import { NextResponse } from "next/server";
import { requireActor, SESSION_COOKIE } from "@/lib/session";
import { revokeSession } from "@/lib/auth";
import { errorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const actor = await requireActor();
    if (actor.sessionId) {
      await revokeSession(actor.sessionId, "User signed out");
    }
    const response = NextResponse.json({ ok: true });
    response.cookies.delete(SESSION_COOKIE);
    return response;
  } catch (e) {
    return errorResponse(e);
  }
}
