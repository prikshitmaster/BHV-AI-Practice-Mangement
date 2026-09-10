import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { requireUserId } from "@/lib/session";
import { assertPracticeAccess } from "@/lib/practice-scope";
import { prisma } from "@/lib/prisma";
import { settlementOf, listAllocations } from "@/lib/receipts";

export const dynamic = "force-dynamic";

/**
 * Invoice detail, with its settlement.
 *
 * The practice is taken from the INVOICE and then checked, rather than read
 * from the query string: a caller cannot name a practice they hold in order to
 * be shown an invoice belonging to one they do not. If the check fails the
 * invoice is simply not there, which is the same shape every other read in
 * this codebase uses.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ invoiceId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { invoiceId } = await context.params;

    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        lines: { orderBy: { sortOrder: "asc" } },
        series: { select: { code: true, fiscalPeriod: true } },
        clientRelationship: { select: { party: { select: { legalName: true } } } },
      },
    });
    if (!invoice) {
      return NextResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
    }

    await assertPracticeAccess(userId, invoice.practiceId);

    const [settlement, allocations] = await Promise.all([
      settlementOf({ practiceId: invoice.practiceId, invoiceId: invoice.id }),
      listAllocations({ practiceId: invoice.practiceId, invoiceId: invoice.id }),
    ]);

    return NextResponse.json({
      invoice: {
        id: invoice.id,
        practiceId: invoice.practiceId,
        status: invoice.status,
        number: invoice.displayNumber,
        sequenceNumber: invoice.sequenceNumber,
        client: invoice.clientRelationship.party.legalName,
        series: invoice.series,
        currency: invoice.currency,
        subtotal: invoice.subtotal.toFixed(2),
        taxTotal: invoice.taxTotal.toFixed(2),
        total: invoice.total.toFixed(2),
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        version: invoice.version,
        lines: invoice.lines.map((l) => ({
          description: l.description,
          quantity: l.quantity.toString(),
          unitAmount: l.unitAmount.toFixed(2),
          taxRatePercent: l.taxRatePercent.toFixed(2),
          lineTotal: l.lineTotal.toFixed(2),
        })),
      },
      settlement,
      allocations: allocations.map((a) => ({
        id: a.id,
        kind: a.kind,
        amount: a.amount.toFixed(2),
        reversedAt: a.reversedAt,
        reversalReason: a.reversalReason,
        receipt: a.receipt,
        creditNote: a.creditNote,
      })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
