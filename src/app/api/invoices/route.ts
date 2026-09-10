import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { practiceScopeFilter } from "@/lib/practice-scope";
import { requireUserId } from "@/lib/session";
import { badRequest, errorResponse } from "@/lib/api";
import { assertCsrf } from "@/lib/csrf";
import { draftInvoice } from "@/lib/invoicing";

export const dynamic = "force-dynamic";

/**
 * ORG acceptance path 2 — API access.
 * The practiceId query parameter is a REQUEST, not an authorisation: it goes
 * through practiceScopeFilter, which rejects anything the user cannot see.
 */
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const requested = new URL(request.url).searchParams.get("practiceId") ?? undefined;

    const scope = await practiceScopeFilter(userId, requested);

    const invoices = await prisma.invoice.findMany({
      where: { ...scope },
      select: {
        id: true,
        practiceId: true,
        sequenceNumber: true,
        status: true,
        total: true,
        currency: true,
        issuedAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return NextResponse.json({
      invoices: invoices.map((i) => ({ ...i, total: i.total.toString() })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * FIN02 draft. A draft is deliberately unnumbered — FIN02 numbers an invoice
 * at ISSUE, so abandoning a draft costs nothing and leaves no gap in a
 * statutory series that somebody later has to explain.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    await assertCsrf(request);

    const body = await request.json();
    const practiceId = String(body.practiceId ?? "").trim();
    const seriesId = String(body.seriesId ?? "").trim();
    const clientRelationshipId = String(body.clientRelationshipId ?? "").trim();
    const lines = Array.isArray(body.lines) ? body.lines : [];

    if (!practiceId || !seriesId || !clientRelationshipId || lines.length === 0) {
      return badRequest("practiceId, seriesId, clientRelationshipId and at least one line are required", "BAD_REQUEST");
    }

    const invoice = await draftInvoice({
      userId,
      practiceId,
      seriesId,
      clientRelationshipId,
      engagementId: body.engagementId ? String(body.engagementId) : undefined,
      feeArrangementId: body.feeArrangementId ? String(body.feeArrangementId) : undefined,
      currency: body.currency ? String(body.currency) : undefined,
      dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
      lines: lines.map((l: Record<string, unknown>) => ({
        description: String(l.description ?? ""),
        quantity: Number(l.quantity ?? 1),
        unitAmount: Number(l.unitAmount ?? 0),
        taxRatePercent: l.taxRatePercent === undefined ? undefined : Number(l.taxRatePercent),
      })),
    });

    return NextResponse.json({
      ok: true,
      invoiceId: invoice.id,
      total: invoice.total.toFixed(2),
      version: invoice.version,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
