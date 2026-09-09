import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/session";
import { errorResponse } from "@/lib/api";
import { assertCsrf } from "@/lib/csrf";
import { commitVisibilityChange, previewVisibilityChange } from "@/lib/communication";

export const dynamic = "force-dynamic";

/**
 * COM01 — the preview half.
 *
 * Deliberately a POST that writes a record rather than a GET that renders a
 * page: the requirement is that the content WAS previewed, and only a stored
 * preview can be evidence of that at commit time.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ threadId: string }> },
) {
  try {
    const userId = await requireUserId();
    await assertCsrf(request);
    const { threadId } = await params;
    const body = await request.json();

    if (!body.practiceId || !body.toVisibility) {
      return NextResponse.json(
        { error: "practiceId and toVisibility are required", code: "BAD_REQUEST" },
        { status: 400 },
      );
    }

    return NextResponse.json(
      await previewVisibilityChange({
        practiceId: String(body.practiceId),
        actorUserId: userId,
        threadId,
        toVisibility: body.toVisibility,
      }),
    );
  } catch (e) {
    return errorResponse(e);
  }
}

/** COM01 — the commit half. Refused without a live, matching, own preview. */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ threadId: string }> },
) {
  try {
    const userId = await requireUserId();
    await assertCsrf(request);
    const { threadId } = await params;
    const body = await request.json();

    if (!body.practiceId || !body.previewId || body.expectedVersion === undefined) {
      return NextResponse.json(
        {
          error: "practiceId, previewId and expectedVersion are required",
          code: "BAD_REQUEST",
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      await commitVisibilityChange({
        practiceId: String(body.practiceId),
        actorUserId: userId,
        threadId,
        previewId: String(body.previewId),
        expectedVersion: Number(body.expectedVersion),
      }),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
