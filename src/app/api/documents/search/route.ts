import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/session";
import { errorResponse } from "@/lib/api";
import { searchDocuments } from "@/lib/documents";

export const dynamic = "force-dynamic";

/**
 * DOC03 search. The route does no filtering of its own — results, counts and
 * suggestions all come back already authorised from `searchDocuments`, so
 * there is no shape of this handler that can widen the answer.
 */
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const url = new URL(request.url);
    const q = url.searchParams.get("q") ?? "";
    const practiceId = url.searchParams.get("practiceId") ?? undefined;

    if (!q.trim()) {
      // NAV03 empty state: an empty query is not an error and not "everything".
      return NextResponse.json({ results: [], totalCount: 0, suggestions: [] });
    }

    return NextResponse.json(
      await searchDocuments({ actorUserId: userId, query: q, practiceId }),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
