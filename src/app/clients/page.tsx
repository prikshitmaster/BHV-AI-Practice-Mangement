import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { screenContext } from "@/lib/screen-context";
import { EmptyState, PermissionState, Screen } from "@/components/states";

export const dynamic = "force-dynamic";

/**
 * Clients — the list that leads to the client workspace.
 *
 * The query is scoped to the active practice and nothing else. The same legal
 * person may be a client of both firms (ORG01), and this list must show only
 * the relationship belonging to the practice the user is currently in — which
 * is why it reads ClientRelationship, not Party.
 */
export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const scope = await screenContext("client.read");
  const { q = "" } = await searchParams;

  if (scope.state === "signed-out") {
    return (
      <Screen title="Clients">
        <EmptyState title="Sign in to see clients" />
      </Screen>
    );
  }
  if (scope.state === "no-practice" || scope.state === "denied") {
    return (
      <Screen title="Clients">
        <PermissionState />
      </Screen>
    );
  }

  const { ctx, practiceId } = scope;

  const clients = await prisma.clientRelationship.findMany({
    where: {
      practiceId,
      archivedAt: null,
      ...(q.trim()
        ? { party: { legalName: { contains: q.trim(), mode: "insensitive" as const } } }
        : {}),
    },
    orderBy: { party: { legalName: "asc" } },
    take: 100,
    select: {
      id: true,
      acceptanceStatus: true,
      confidentiality: true,
      party: { select: { legalName: true, type: true } },
      _count: { select: { engagements: true } },
    },
  });

  return (
    <Screen
      title="Clients"
      lede={`Clients of ${ctx.activePractice!.name}.`}
      breadcrumbs={[{ href: "/", label: "Home" }]}
    >
      <form method="get" className="row" style={{ marginBottom: 16 }} role="search">
        <label htmlFor="client-filter" className="field-label" style={{ marginBottom: 0 }}>
          Filter by name
        </label>
        <input
          id="client-filter"
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

      {clients.length === 0 ? (
        <EmptyState
          title={q ? "No client matches that name" : "No clients yet"}
          body={
            q
              ? "Nothing in this practice matches your filter. Check the spelling, or clear the filter to see every client."
              : "This practice has no client relationships recorded yet."
          }
          action={
            q ? (
              <Link className="btn" href="/clients">
                Clear the filter
              </Link>
            ) : null
          }
        />
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <caption>
              {clients.length} client{clients.length === 1 ? "" : "s"} in {ctx.activePractice!.name}.
            </caption>
            <thead>
              <tr>
                <th scope="col">Client</th>
                <th scope="col">Type</th>
                <th scope="col">Status</th>
                <th scope="col">Sensitivity</th>
                <th scope="col" className="numeric">
                  Engagements
                </th>
              </tr>
            </thead>
            <tbody>
              {clients.map((client) => (
                <tr key={client.id}>
                  <th scope="row">
                    <Link href={`/clients/${client.id}`}>{client.party.legalName}</Link>
                  </th>
                  <td>{client.party.type.replace(/_/g, " ").toLowerCase()}</td>
                  <td>
                    <span
                      className={`status status--${client.acceptanceStatus === "ACCEPTED" ? "ok" : "info"}`}
                    >
                      {client.acceptanceStatus.replace(/_/g, " ").toLowerCase()}
                    </span>
                  </td>
                  <td>
                    {client.confidentiality === "NORMAL" ? (
                      "Normal"
                    ) : (
                      <span className="status status--warn">
                        {client.confidentiality.replace(/_/g, " ").toLowerCase()}
                      </span>
                    )}
                  </td>
                  <td className="numeric">{client._count.engagements}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Screen>
  );
}
