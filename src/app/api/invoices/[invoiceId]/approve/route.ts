import { NextResponse } from "next/server";
import { badRequest, errorResponse, notFound } from "@/lib/api";
import { assertCsrf } from "@/lib/csrf";
import { requireUserId } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { approveInvoice } from "@/lib/invoicing";

export const dynamic = "force-dynamic";

/**
 * FIN02 approval. `expectedVersion` is required, not optional: this is one of
 * the four things API02 names (approvals, deadlines, allocations, signed
 * material) where a silent last-write-wins is forbidden, so a caller that
 * cannot say which version it approved has not approved anything.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ invoiceId: string }> },
) {
  try {
    const userId = await requireUserId();
    await assertCsrf(request);

    const { invoiceId } = await context.params;
    const body = await request.json();

    if (typeof body.expectedVersion !== "number") {
      return badRequest("expectedVersion is required", "BAD_REQUEST");
    }

    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { practiceId: true },
    });
    if (!invoice) {
      return notFound();
    }

    const actor = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { fullName: true },
    });

    const approved = await approveInvoice({
      userId,
      approverName: actor.fullName,
      practiceId: invoice.practiceId,
      invoiceId,
      expectedVersion: body.expectedVersion,
    });

    return NextResponse.json({ ok: true, status: approved.status, version: approved.version });
  } catch (e) {
    return errorResponse(e);
  }
}
