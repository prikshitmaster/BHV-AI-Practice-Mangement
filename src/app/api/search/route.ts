import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { practiceScopeFilter } from "@/lib/practice-scope";
import { requireUserId } from "@/lib/session";
import { errorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * ORG acceptance path 3 — search.
 *
 * The subtle leak this guards against: a party is tenant-level (the same
 * company can be a client of both practices), so searching parties directly
 * would reveal the other practice's clients. Search therefore runs over
 * CLIENT RELATIONSHIPS, which are practice-scoped, and only ever within the
 * caller's own scope.
 */
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    const requested = url.searchParams.get("practiceId") ?? undefined;

    const scope = await practiceScopeFilter(userId, requested);

    if (q.length < 2) return NextResponse.json({ results: [] });

    const relationships = await prisma.clientRelationship.findMany({
      where: {
        ...scope,
        archivedAt: null,
        party: { legalName: { contains: q, mode: "insensitive" } },
      },
      select: {
        id: true,
        practiceId: true,
        acceptanceStatus: true,
        party: { select: { legalName: true, type: true } },
      },
      take: 50,
    });

    return NextResponse.json({
      results: relationships.map((r) => ({
        clientRelationshipId: r.id,
        practiceId: r.practiceId,
        legalName: r.party.legalName,
        partyType: r.party.type,
        acceptanceStatus: r.acceptanceStatus,
      })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
