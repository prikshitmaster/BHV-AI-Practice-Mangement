import { NextResponse } from "next/server";
import { badRequest, errorResponse, notFound } from "@/lib/api";
import { assertCsrf } from "@/lib/csrf";
import { requireUserId } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { reconcileDowntimeWork } from "@/lib/continuity";

export const dynamic = "force-dynamic";

/**
 * BCP04 reconciliation of one downtime record. The practice is read from the
 * STORED record, never the body (IAM01), and the library then checks the
 * caller's authority in that practice — so an unknown id and someone else's id
 * both come back as the same 404.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ recordId: string }> },
) {
  try {
    const userId = await requireUserId();
    await assertCsrf(request);
    const { recordId } = await context.params;
    const body = await request.json().catch(() => ({}));

    if (typeof body.expectedVersion !== "number") return badRequest("expectedVersion is required");
    if (typeof body.note !== "string") return badRequest("note is required", "NOTE_REQUIRED");

    const record = await prisma.downtimeWorkRecord.findUnique({
      where: { id: recordId },
      select: { practiceId: true },
    });
    if (!record) return notFound();

    const result = await reconcileDowntimeWork({
      actorUserId: userId,
      practiceId: record.practiceId,
      recordId,
      expectedVersion: body.expectedVersion,
      note: body.note,
    });
    return NextResponse.json({ ok: true, version: result.version });
  } catch (e) {
    return errorResponse(e);
  }
}
