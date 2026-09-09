import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import { screenContext } from "@/lib/screen-context";
import { EmptyState, PermissionState, Screen } from "@/components/states";

export const dynamic = "force-dynamic";

/**
 * Documents — the practice's filed material.
 *
 * DOC03's rule is applied here, not in a filter the user can turn off:
 * protected working papers are excluded from the query itself unless the
 * caller holds the explicit grant. A checkbox labelled "include working
 * papers" would put the control in the wrong place — the server decides, and
 * the screen simply does not know about what it may not show.
 */
export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const scope = await screenContext("document.read");
  const { q = "" } = await searchParams;

  if (scope.state === "signed-out") {
    return (
      <Screen title="Documents">
        <EmptyState title="Sign in to see documents" />
      </Screen>
    );
  }
  if (scope.state === "no-practice" || scope.state === "denied") {
    return (
      <Screen title="Documents">
        <PermissionState />
      </Screen>
    );
  }

  const { ctx, practiceId } = scope;
  const seesProtected = can(ctx.membership!, "workpaper.protected.read");

  const documents = await prisma.document.findMany({
    where: {
      practiceId,
      archivedAt: null,
      ...(seesProtected ? {} : { workingPaper: false }),
      ...(q.trim() ? { title: { contains: q.trim(), mode: "insensitive" as const } } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: {
      id: true,
      title: true,
      documentType: true,
      periodLabel: true,
      classification: true,
      workingPaper: true,
      kind: true,
      clientRelationship: { select: { party: { select: { legalName: true } } } },
      versions: {
        orderBy: { versionNo: "desc" },
        take: 1,
        select: { versionNo: true, status: true, scanVerdict: true },
      },
    },
  });

  return (
    <Screen
      title="Documents"
      lede={`Filed in ${ctx.activePractice!.name}.${seesProtected ? "" : " Protected working papers are not included."}`}
      breadcrumbs={[{ href: "/", label: "Home" }]}
    >
      <form method="get" className="row" style={{ marginBottom: 16 }} role="search">
        <label htmlFor="doc-filter" className="field-label" style={{ marginBottom: 0 }}>
          Filter by title
        </label>
        <input
          id="doc-filter"
          name="q"
          type="search"
          defaultValue={q}
          className="field-input"
          style={{ maxWidth: "24rem", minHeight: 36 }}
        />
        <button type="submit" className="btn">
          Filter
        </button>
      </form>

      {documents.length === 0 ? (
        <EmptyState
          title={q ? "No document matches that title" : "No documents filed"}
          body={
            q
              ? "Nothing you can open in this practice matches your filter."
              : "Nothing has been filed in this practice yet."
          }
          action={
            q ? (
              <Link className="btn" href="/documents">
                Clear the filter
              </Link>
            ) : null
          }
        />
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <caption>
              {documents.length} document{documents.length === 1 ? "" : "s"} you can open.
            </caption>
            <thead>
              <tr>
                <th scope="col">Title</th>
                <th scope="col">Client</th>
                <th scope="col">Type</th>
                <th scope="col">Period</th>
                <th scope="col" className="numeric">
                  Latest version
                </th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => {
                const latest = doc.versions[0];
                return (
                  <tr key={doc.id}>
                    <th scope="row">
                      <Link href={`/documents/${doc.id}`}>{doc.title}</Link>
                      {doc.workingPaper ? (
                        <span className="status status--warn" style={{ marginLeft: 8 }}>
                          Working paper
                        </span>
                      ) : null}
                      {doc.classification !== "NORMAL" ? (
                        <span className="status status--warn" style={{ marginLeft: 8 }}>
                          {doc.classification.replace(/_/g, " ").toLowerCase()}
                        </span>
                      ) : null}
                    </th>
                    <td>{doc.clientRelationship?.party.legalName ?? "—"}</td>
                    <td>{doc.documentType ?? "—"}</td>
                    <td>{doc.periodLabel ?? "—"}</td>
                    <td className="numeric">{latest ? latest.versionNo : "—"}</td>
                    <td>
                      {latest ? (
                        <span
                          className={`status status--${
                            latest.scanVerdict !== "CLEAN"
                              ? "overdue"
                              : latest.status === "APPROVED"
                                ? "ok"
                                : "info"
                          }`}
                        >
                          {latest.scanVerdict !== "CLEAN"
                            ? `Scan ${latest.scanVerdict.toLowerCase()}`
                            : latest.status.replace(/_/g, " ").toLowerCase()}
                        </span>
                      ) : (
                        "No version"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Screen>
  );
}
