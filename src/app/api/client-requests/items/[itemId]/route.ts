import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/session";
import { errorResponse } from "@/lib/api";
import { assertCsrf } from "@/lib/csrf";
import {
  acceptItemResponse,
  rejectItemResponse,
  submitItemResponse,
} from "@/lib/communication";

export const dynamic = "force-dynamic";

/**
 * COM02 — respond to ONE requested item.
 *
 * The item id is in the path and there is no body field that could name a
 * second item. That is the whole defence behind "one upload cannot close all
 * requests": the route has no vocabulary for fanning out.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ itemId: string }> },
) {
  try {
    await requireUserId();
    await assertCsrf(request);
    const { itemId } = await params;
    const body = await request.json();

    if (!body.practiceId || !body.kind) {
      return NextResponse.json(
        { error: "practiceId and kind are required", code: "BAD_REQUEST" },
        { status: 400 },
      );
    }

    return NextResponse.json(
      await submitItemResponse({
        practiceId: String(body.practiceId),
        itemId,
        kind: body.kind,
        documentVersionId: body.documentVersionId ?? null,
        explanation: body.explanation ?? null,
        respondedByContactId: body.respondedByContactId ?? null,
        respondedByUserId: body.respondedByUserId ?? null,
        expectedVersion:
          body.expectedVersion === undefined ? undefined : Number(body.expectedVersion),
      }),
    );
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * COM02 — the staff decision on a response. Accepting stops that item's
 * reminder under the ON_ACCEPTANCE rule; rejecting sends the item back to
 * OUTSTANDING and restarts it.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ itemId: string }> },
) {
  try {
    const userId = await requireUserId();
    await assertCsrf(request);
    await params;
    const body = await request.json();

    if (!body.practiceId || !body.responseId || !body.decision) {
      return NextResponse.json(
        { error: "practiceId, responseId and decision are required", code: "BAD_REQUEST" },
        { status: 400 },
      );
    }

    if (body.decision === "ACCEPT") {
      return NextResponse.json(
        await acceptItemResponse({
          practiceId: String(body.practiceId),
          actorUserId: userId,
          responseId: String(body.responseId),
        }),
      );
    }

    if (body.decision === "REJECT") {
      return NextResponse.json(
        await rejectItemResponse({
          practiceId: String(body.practiceId),
          actorUserId: userId,
          responseId: String(body.responseId),
          reason: String(body.reason ?? ""),
        }),
      );
    }

    return NextResponse.json(
      { error: "decision must be ACCEPT or REJECT", code: "BAD_DECISION" },
      { status: 400 },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
