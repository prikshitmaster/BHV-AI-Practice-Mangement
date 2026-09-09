import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { practiceScopeFilter } from "@/lib/practice-scope";
import { requireUserId } from "@/lib/session";
import { errorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * CLI06 / CLI02 acceptance evidence: "expose no other client data through
 * autocomplete or duplicate detection."
 *
 * Autocomplete is the classic leak — it is fast, incremental, and a natural
 * oracle: type a name, see whether the firm acts for them. This one queries
 * ClientRelationship (practice-scoped) rather than Party (tenant-wide), so a
 * name only appears if the caller's own practice acts for that client.
 */
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    const requested = url.searchParams.get("practiceId") ?? undefined;

    const scope = await practiceScopeFilter(userId, requested);

    // Refuse to answer a one-character probe — it would enumerate the book.
    if (q.length < 2) return NextResponse.json({ suggestions: [] });

    const rows = await prisma.clientRelationship.findMany({
      where: {
        ...scope,
        archivedAt: null,
        party: { legalName: { contains: q, mode: "insensitive" }, archivedAt: null },
      },
      select: {
        id: true,
        practiceId: true,
        acceptanceStatus: true,
        party: { select: { id: true, legalName: true, type: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    return NextResponse.json({
      suggestions: rows.map((r) => ({
        clientRelationshipId: r.id,
        practiceId: r.practiceId,
        partyId: r.party.id,
        legalName: r.party.legalName,
        type: r.party.type,
        acceptanceStatus: r.acceptanceStatus,
      })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
