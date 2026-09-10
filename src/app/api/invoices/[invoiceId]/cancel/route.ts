import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { assertCsrf } from "@/lib/csrf";
import { requireUserId } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { cancelInvoice } from "@/lib/invoicing";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ invoiceId: string }> },
) {
  try {
    const userId = await requireUserId();
    await assertCsrf(request);

    const { invoiceId } = await context.params;
    const body = await request.json();
    const reason = String(body.reason ?? "").trim();

    if (typeof body.expectedVersion !== "number" || !reason) {
      return NextResponse.json(
        { error: "expectedVersion and reason are required", code: "BAD_REQUEST" },
        { status: 400 },
      );
    }

    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { practiceId: true },
    });
    if (!invoice) {
      return NextResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
    }

    const cancelled = await cancelInvoice({
      userId,
      practiceId: invoice.practiceId,
      invoiceId,
      expectedVersion: body.expectedVersion,
      reason,
    });

    return NextResponse.json({ ok: true, status: cancelled.status });
  } catch (e) {
    return errorResponse(e);
  }
}
