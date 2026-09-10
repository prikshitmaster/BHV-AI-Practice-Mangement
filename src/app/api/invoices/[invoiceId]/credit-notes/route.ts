import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { assertCsrf } from "@/lib/csrf";
import { requireUserId } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { draftCreditNote } from "@/lib/invoicing";

export const dynamic = "force-dynamic";

/**
 * FIN02: the correction path for an issued invoice. Raising the note and
 * issuing it are two endpoints on purpose — the requirement says *reviewed*
 * credit notes, and a single endpoint that did both would let one person
 * raise and issue a revenue reduction alone.
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
    const seriesId = String(body.seriesId ?? "").trim();
    const reason = String(body.reason ?? "").trim();
    const amount = Number(body.amount);

    if (!seriesId || !reason || !Number.isFinite(amount)) {
      return NextResponse.json(
        { error: "seriesId, amount and reason are required", code: "BAD_REQUEST" },
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

    const note = await draftCreditNote({
      userId,
      practiceId: invoice.practiceId,
      invoiceId,
      seriesId,
      amount,
      reason,
    });

    return NextResponse.json({ ok: true, creditNoteId: note.id, version: note.version });
  } catch (e) {
    return errorResponse(e);
  }
}
