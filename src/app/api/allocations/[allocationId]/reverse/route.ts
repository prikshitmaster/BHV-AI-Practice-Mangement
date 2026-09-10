import { NextResponse } from "next/server";
import { badRequest, errorResponse, notFound } from "@/lib/api";
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
      return badRequest("A reason is required to reverse an allocation", "BAD_REQUEST");
    }

    const allocation = await prisma.receiptAllocation.findUnique({
      where: { id: allocationId },
      select: { practiceId: true },
    });
    if (!allocation) {
      return notFound();
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
