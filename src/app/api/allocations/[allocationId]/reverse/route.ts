import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { assertCsrf } from "@/lib/csrf";
import { requireUserId } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { reverseAllocation } from "@/lib/receipts";

export const dynamic = "force-dynamic";

/**
 * FIN04 "preserve reconciliation adjustments" — there is deliberately no
 * DELETE on an allocation anywhere in this API. Correcting one is a reversal,
 * which leaves both rows behind for whoever reconciles.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ allocationId: string }> },
) {
  try {
    const userId = await requireUserId();
    await assertCsrf(request);

    const { allocationId } = await context.params;
    const body = await request.json();
    const reason = String(body.reason ?? "").trim();

    if (!reason) {
      return NextResponse.json(
        { error: "A reason is required to reverse an allocation", code: "BAD_REQUEST" },
        { status: 400 },
      );
    }

    const allocation = await prisma.receiptAllocation.findUnique({
      where: { id: allocationId },
      select: { practiceId: true },
    });
    if (!allocation) {
      return NextResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
    }

    const reversal = await reverseAllocation({
      userId,
      practiceId: allocation.practiceId,
      allocationId,
      reason,
    });

    return NextResponse.json({ ok: true, reversalId: reversal.id });
  } catch (e) {
    return errorResponse(e);
  }
}
