import { NextResponse } from "next/server";
import { badRequest, errorResponse, notFound } from "@/lib/api";
import { assertCsrf } from "@/lib/csrf";
import { requireUserId } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { allocateReceipt } from "@/lib/receipts";

export const dynamic = "force-dynamic";

/**
 * FIN04 allocation. The practice comes from the invoice and is then checked
 * inside `allocateReceipt`, which also re-reads the live balance inside its
 * own transaction — so two clients racing this endpoint cannot together
 * over-allocate an invoice that each of them saw as open.
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

    const kind = String(body.kind ?? "");
    const amount = Number(body.amount);
    if (!kind || !Number.isFinite(amount)) {
      return badRequest("kind and amount are required", "BAD_REQUEST");
    }

    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { practiceId: true },
    });
    if (!invoice) {
      return notFound();
    }

    const allocation = await allocateReceipt({
      userId,
      practiceId: invoice.practiceId,
      invoiceId,
      kind: kind as never,
      amount,
      receiptId: body.receiptId ? String(body.receiptId) : undefined,
    });

    return NextResponse.json({
      ok: true,
      allocation: { id: allocation.id, kind: allocation.kind, amount: allocation.amount.toFixed(2) },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
