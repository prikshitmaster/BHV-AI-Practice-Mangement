import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { practiceScopeFilter } from "@/lib/practice-scope";
import { requireUserId } from "@/lib/session";
import { errorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * ORG acceptance path 4 — export.
 *
 * Exports are a classic isolation hole: the scope check is easy to skip when
 * generating a file rather than a screen. The filter is applied identically
 * here, and the export is stamped with the practices it actually covers so a
 * recipient can tell what they are holding.
 */
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const requested = new URL(request.url).searchParams.get("practiceId") ?? undefined;

    const scope = await practiceScopeFilter(userId, requested);

    const invoices = await prisma.invoice.findMany({
      where: { ...scope },
      select: {
        practiceId: true,
        sequenceNumber: true,
        status: true,
        currency: true,
        total: true,
        issuedAt: true,
        practice: { select: { name: true } },
      },
      orderBy: [{ practiceId: "asc" }, { sequenceNumber: "asc" }],
    });

    const header = "practice,sequence_number,status,currency,total,issued_at";
    const rows = invoices.map((i) =>
      [
        JSON.stringify(i.practice.name),
        i.sequenceNumber,
        i.status,
        i.currency,
        i.total.toString(),
        i.issuedAt?.toISOString() ?? "",
      ].join(","),
    );

    const csv = [header, ...rows].join("\n");

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="invoices.csv"',
        "x-bhv-export-scope": scope.practiceId.in.join(","),
        "x-bhv-export-row-count": String(invoices.length),
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
