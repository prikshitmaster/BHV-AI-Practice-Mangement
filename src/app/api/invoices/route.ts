import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { practiceScopeFilter } from "@/lib/practice-scope";
import { requireUserId } from "@/lib/session";
import { errorResponse } from "@/lib/api";

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
