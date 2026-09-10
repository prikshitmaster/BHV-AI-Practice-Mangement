import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { assertCsrf } from "@/lib/csrf";
import { requireUserId } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { approveFeeArrangement } from "@/lib/fees";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ arrangementId: string }> },
) {
  try {
    const userId = await requireUserId();
    await assertCsrf(request);

    const { arrangementId } = await context.params;
    const body = await request.json();

    if (typeof body.expectedVersion !== "number") {
      return NextResponse.json(
        { error: "expectedVersion is required", code: "BAD_REQUEST" },
        { status: 400 },
      );
    }

    const arrangement = await prisma.feeArrangement.findUnique({
      where: { id: arrangementId },
      select: { practiceId: true },
    });
    if (!arrangement) {
      return NextResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
    }

    const actor = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { fullName: true },
    });

    const approved = await approveFeeArrangement({
      userId,
      approverName: actor.fullName,
      practiceId: arrangement.practiceId,
      arrangementId,
      expectedVersion: body.expectedVersion,
    });

    return NextResponse.json({ ok: true, status: approved.status, version: approved.version });
  } catch (e) {
    return errorResponse(e);
  }
}
