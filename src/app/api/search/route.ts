import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/session";
import { errorResponse } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getAccessiblePracticeIds } from "@/lib/practice-scope";
import { can, resolveMembership } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/**
 * NAV02 permission-aware global search.
 *
 * The scope is computed here and nowhere else: the practices the caller may
 * act in are resolved from live memberships, then each type is queried only
 * for those practices in which the caller holds the READ capability for that
 * type. A user with client.read but not document.read gets clients and no
 * documents — not documents with the titles blanked out.
 *
 * The `total` is the count of what is returned, deliberately. A total that
 * counts records the user cannot open has already disclosed that they exist,
 * which is the same reasoning behind T11's searchDocuments and behind
 * PracticeAccessError returning 404 rather than 403.
 *
 * Snippets are built from fields the type's read capability already covers, so
 * a snippet can never carry more than the row it belongs to.
 */

type Hit = {
  id: string;
  type: "client" | "job" | "document" | "reference";
  title: string;
  snippet: string | null;
  href: string;
  /**
   * Which of the CALLER'S OWN practices this hit belongs to.
   *
   * Not a disclosure: every hit here has already passed the per-practice
   * capability check below, so naming the practice tells the caller nothing
   * they could not already read. It is needed by both consumers — the shell
   * shows which firm a result belongs to (UX05: identity is never left to
   * inference), and the ORG isolation test asserts on it directly, which it
   * cannot do if the field is absent.
   */
  practiceId: string;
};

const PER_TYPE_LIMIT = 5;

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    const requestedTypes = url.searchParams.getAll("type");
    const requestedPracticeId = url.searchParams.get("practiceId");

    // NAV03 empty state: a short query is not an error and not "everything".
    if (q.length < 2) return NextResponse.json({ hits: [], results: [], total: 0 });

    let practiceIds = await getAccessiblePracticeIds(userId);

    // A practiceId in the query string is a REQUEST, never evidence. It can
    // only narrow the set the membership check already produced.
    if (requestedPracticeId) {
      practiceIds = practiceIds.filter((id) => id === requestedPracticeId);
    }
    if (practiceIds.length === 0) return NextResponse.json({ hits: [], results: [], total: 0 });

    const wants = (type: string) => requestedTypes.length === 0 || requestedTypes.includes(type);

    // Per-practice capability, resolved once.
    const memberships = await Promise.all(
      practiceIds.map(async (id) => ({ id, membership: await resolveMembership(userId, id) })),
    );
    const scopeFor = (action: Parameters<typeof can>[1]) =>
      memberships.filter((m) => m.membership && can(m.membership, action)).map((m) => m.id);

    const hits: Hit[] = [];

    if (wants("client")) {
      const scope = scopeFor("client.read");
      if (scope.length > 0) {
        const clients = await prisma.clientRelationship.findMany({
          where: {
            practiceId: { in: scope },
            archivedAt: null,
            party: { legalName: { contains: q, mode: "insensitive" } },
          },
          select: {
            id: true,
            practiceId: true,
            acceptanceStatus: true,
            party: { select: { legalName: true } },
          },
          take: PER_TYPE_LIMIT,
        });
        hits.push(
          ...clients.map((c) => ({
            id: `client:${c.id}`,
            type: "client" as const,
            title: c.party.legalName,
            snippet: c.acceptanceStatus,
            href: `/clients/${c.id}`,
            practiceId: c.practiceId,
          })),
        );
      }
    }

    if (wants("job")) {
      const scope = scopeFor("job.read");
      if (scope.length > 0) {
        const jobs = await prisma.job.findMany({
          where: {
            practiceId: { in: scope },
            archivedAt: null,
            title: { contains: q, mode: "insensitive" },
          },
          select: { id: true, practiceId: true, title: true, periodKey: true, state: true },
          take: PER_TYPE_LIMIT,
        });
        hits.push(
          ...jobs.map((j) => ({
            id: `job:${j.id}`,
            type: "job" as const,
            title: j.title,
            snippet: `${j.periodKey} · ${j.state.replace(/_/g, " ").toLowerCase()}`,
            href: `/jobs/${j.id}`,
            practiceId: j.practiceId,
          })),
        );
      }
    }

    if (wants("document")) {
      const scope = scopeFor("document.read");
      if (scope.length > 0) {
        // DOC03: protected working papers need their own grant, so they are
        // excluded unless the caller holds it in that practice.
        const protectedScope = memberships
          .filter((m) => m.membership && can(m.membership, "workpaper.protected.read"))
          .map((m) => m.id);

        const documents = await prisma.document.findMany({
          where: {
            practiceId: { in: scope },
            archivedAt: null,
            title: { contains: q, mode: "insensitive" },
            OR: [{ workingPaper: false }, { practiceId: { in: protectedScope } }],
          },
          select: { id: true, practiceId: true, title: true, documentType: true, periodLabel: true },
          take: PER_TYPE_LIMIT,
        });
        hits.push(
          ...documents.map((d) => ({
            id: `document:${d.id}`,
            type: "document" as const,
            title: d.title,
            snippet: [d.documentType, d.periodLabel].filter(Boolean).join(" · ") || null,
            href: `/documents/${d.id}`,
            practiceId: d.practiceId,
          })),
        );
      }
    }

    if (wants("reference")) {
      const scope = scopeFor("job.read");
      if (scope.length > 0) {
        // "Reference" is the filing acknowledgement number a client quotes on
        // the phone — the single most common thing staff paste into a search
        // box, and useless if it only matches document titles.
        const evidence = await prisma.filingEvidence.findMany({
          where: {
            practiceId: { in: scope },
            acknowledgementReference: { contains: q, mode: "insensitive" },
          },
          select: {
            id: true,
            practiceId: true,
            acknowledgementReference: true,
            obligationId: true,
            filedAt: true,
          },
          take: PER_TYPE_LIMIT,
        });
        hits.push(
          ...evidence.map((e) => ({
            id: `reference:${e.id}`,
            type: "reference" as const,
            title: e.acknowledgementReference,
            snippet: e.filedAt ? `Filed ${e.filedAt.toISOString().slice(0, 10)}` : null,
            href: `/obligations/${e.obligationId}`,
            practiceId: e.practiceId,
          })),
        );
      }
    }

    /**
     * `results` is the ORG-era name for the same rows and is still what the
     * practice-isolation test and any older caller reads. It is the SAME
     * array, not a second query — two lists that could ever disagree about
     * what a user may see is precisely the bug this endpoint exists to avoid.
     */
    return NextResponse.json({ hits, results: hits, total: hits.length });
  } catch (e) {
    return errorResponse(e);
  }
}
