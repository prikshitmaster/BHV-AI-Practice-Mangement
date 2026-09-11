import { NextResponse } from "next/server";
import { badRequest, errorResponse, notFound } from "@/lib/api";
import { assertCsrf } from "@/lib/csrf";
import { requireUserId } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { updateProcessingActivity } from "@/lib/privacy-register";

export const dynamic = "force-dynamic";

/** PRV01: activate or retire a register entry, version-checked (API02). */
export async function POST(request: Request, context: { params: Promise<{ activityId: string }> }) {
  try {
    const userId = await requireUserId();
    await assertCsrf(request);
    const { activityId } = await context.params;
    const body = await request.json().catch(() => ({}));
    if (typeof body.expectedVersion !== "number") return badRequest("expectedVersion is required");
    if (body.status !== "ACTIVE" && body.status !== "RETIRED") return badRequest("status must be ACTIVE or RETIRED");

    const stored = await prisma.processingActivity.findUnique({
      where: { id: activityId },
      select: { practiceId: true },
    });
    if (!stored) return notFound();

    const row = await updateProcessingActivity({
      actorUserId: userId,
      practiceId: stored.practiceId,
      activityId,
      expectedVersion: body.expectedVersion,
      status: body.status,
    });
    return NextResponse.json({ ok: true, version: row.version });
  } catch (e) {
    return errorResponse(e);
  }
}
