import { NextResponse } from "next/server";
import { badRequest, errorResponse, notFound } from "@/lib/api";
import { assertCsrf } from "@/lib/csrf";
import { requireUserId } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { issueInvoice } from "@/lib/invoicing";

export const dynamic = "force-dynamic";

/**
 * FIN02 issue — the point of no return. After this the particulars are locked
 * and the only correction is a credit note, so the version check matters more
 * here than anywhere else in the module: two clicks on one screen must issue
 * one invoice and take one number.
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

    const issued = await issueInvoice({
      userId,
      practiceId: invoice.practiceId,
      invoiceId,
      expectedVersion: body.expectedVersion,
      issueDate: body.issueDate ? new Date(body.issueDate) : undefined,
    });

    return NextResponse.json({
      ok: true,
      status: issued.status,
      number: issued.displayNumber,
      version: issued.version,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
