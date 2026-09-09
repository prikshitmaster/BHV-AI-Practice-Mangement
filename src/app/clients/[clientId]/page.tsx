import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import { screenContext } from "@/lib/screen-context";
import { EmptyState, PermissionState, Screen } from "@/components/states";

export const dynamic = "force-dynamic";

/**
 * Client workspace — PRD §39: "Identity and authority → engagements →
 * requests / files / timeline → finance if permitted."
 *
 * Two things this screen is careful about:
 *
 *  1. The record is fetched WITH the practice filter in the same query, not
 *     fetched and then checked. A deep link to another practice's client id
 *     therefore returns nothing at all — NAV03's "a deep link to the wrong
 *     practice is rejected safely and does not silently switch authority". It
 *     does not offer to switch practice, because that would confirm the record
 *     exists somewhere.
 *
 *  2. Finance is a separate gate, per CLI06's per-tab permission model. A user
 *     without invoice.read does not see an empty finance section; they see no
 *     finance section, and no totals.
 */
export default async function ClientWorkspacePage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const scope = await screenContext("client.read");
  const { clientId } = await params;

  if (scope.state === "signed-out") {
    return (
      <Screen title="Client">
        <EmptyState title="Sign in to see this client" />
      </Screen>
    );
  }
  if (scope.state === "no-practice" || scope.state === "denied") {
    return (
      <Screen title="Client">
        <PermissionState />
      </Screen>
    );
  }

  const { ctx, practiceId } = scope;
  const showFinance = can(ctx.membership!, "invoice.read");
  const showDocuments = can(ctx.membership!, "document.read");

  const client = await prisma.clientRelationship.findFirst({
    where: { id: clientId, practiceId, archivedAt: null },
    select: {
      id: true,
      acceptanceStatus: true,
      confidentiality: true,
      acceptedAt: true,
      party: {
        select: {
          legalName: true,
          type: true,
          identifiers: {
            where: { archivedAt: null },
            select: { kind: true, value: true, stateCode: true, verificationStatus: true },
          },
        },
      },
      contactAuthorities: {
        where: { revokedAt: null },
        select: {
          authority: true,
          effectiveFrom: true,
          contact: { select: { fullName: true, designation: true, emailVerificationStatus: true } },
        },
      },
      engagements: {
        where: { archivedAt: null },
        select: {
          id: true,
          serviceCode: true,
          state: true,
          kind: true,
          periodStart: true,
          periodEnd: true,
        },
        orderBy: { createdAt: "desc" },
      },
      clientRequests: {
        where: { state: { notIn: ["CLOSED", "CANCELLED"] } },
        select: {
          id: true,
          title: true,
          state: true,
          dueDate: true,
          items: { where: { remindersStoppedAt: null }, select: { id: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      },
    },
  });

  // Not found and not permitted are the SAME answer on purpose.
  if (!client) {
    return (
      <Screen title="Client" breadcrumbs={[{ href: "/", label: "Home" }, { href: "/clients", label: "Clients" }]}>
        <PermissionState />
      </Screen>
    );
  }

  const invoices = showFinance
    ? await prisma.invoice.findMany({
        where: { practiceId, clientRelationshipId: clientId },
        select: { id: true, sequenceNumber: true, status: true, total: true, currency: true, issuedAt: true },
        orderBy: { createdAt: "desc" },
        take: 10,
      })
    : [];

  const documents = showDocuments
    ? await prisma.document.findMany({
        where: { practiceId, clientRelationshipId: clientId, archivedAt: null, workingPaper: false },
        select: { id: true, title: true, documentType: true, periodLabel: true },
        orderBy: { updatedAt: "desc" },
        take: 10,
      })
    : [];

  return (
    <Screen
      title={client.party.legalName}
      lede={`Client of ${ctx.activePractice!.name}.`}
      breadcrumbs={[
        { href: "/", label: "Home" },
        { href: "/clients", label: "Clients" },
      ]}
    >
      <h2>Identity and authority</h2>
      <div className="card">
        <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 16px" }}>
          <dt className="secondary">Legal name</dt>
          <dd style={{ margin: 0 }}>{client.party.legalName}</dd>
          <dt className="secondary">Type</dt>
          <dd style={{ margin: 0 }}>{client.party.type.replace(/_/g, " ").toLowerCase()}</dd>
          <dt className="secondary">Status</dt>
          <dd style={{ margin: 0 }}>{client.acceptanceStatus.replace(/_/g, " ").toLowerCase()}</dd>
          <dt className="secondary">Sensitivity</dt>
          <dd style={{ margin: 0 }}>{client.confidentiality.replace(/_/g, " ").toLowerCase()}</dd>
        </dl>
      </div>

      <h3>Registrations</h3>
      {client.party.identifiers.length === 0 ? (
        <EmptyState title="No registrations recorded" body="No statutory identifiers have been recorded for this client yet." />
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <caption>Statutory identifiers. A format check is not a verification.</caption>
            <thead>
              <tr>
                <th scope="col">Kind</th>
                <th scope="col">Value</th>
                <th scope="col">State</th>
                <th scope="col">Verified</th>
              </tr>
            </thead>
            <tbody>
              {client.party.identifiers.map((id, i) => (
                <tr key={`${id.kind}-${id.value}-${i}`}>
                  <th scope="row">{id.kind}</th>
                  <td>{id.value}</td>
                  <td>{id.stateCode ?? "—"}</td>
                  <td>
                    <span
                      className={`status status--${id.verificationStatus === "VERIFIED" ? "ok" : "warn"}`}
                    >
                      {id.verificationStatus.replace(/_/g, " ").toLowerCase()}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3>Authorised contacts</h3>
      {client.contactAuthorities.length === 0 ? (
        <EmptyState
          title="No authorised contacts"
          body="Nobody is currently authorised to act for this client. Correspondence and portal access need an authority recorded first."
        />
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <caption>Who may act for this client, and at what level.</caption>
            <thead>
              <tr>
                <th scope="col">Contact</th>
                <th scope="col">Role</th>
                <th scope="col">Authority</th>
                <th scope="col">Email channel</th>
              </tr>
            </thead>
            <tbody>
              {client.contactAuthorities.map((a, i) => (
                <tr key={i}>
                  <th scope="row">{a.contact.fullName}</th>
                  <td>{a.contact.designation ?? "—"}</td>
                  <td>{a.authority.replace(/_/g, " ").toLowerCase()}</td>
                  <td>
                    <span
                      className={`status status--${a.contact.emailVerificationStatus === "VERIFIED" ? "ok" : "warn"}`}
                    >
                      {a.contact.emailVerificationStatus.replace(/_/g, " ").toLowerCase()}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Engagements</h2>
      {client.engagements.length === 0 ? (
        <EmptyState title="No engagements" body="No engagement has been recorded for this client in this practice." />
      ) : (
        <ul className="nav-list">
          {client.engagements.map((e) => (
            <li key={e.id}>
              <span className="nav-link">
                <span className="status status--info">{e.state.replace(/_/g, " ").toLowerCase()}</span>
                <span>
                  {e.serviceCode}
                  <span className="muted" style={{ display: "block", fontSize: 13 }}>
                    {e.periodStart.toISOString().slice(0, 10)} to{" "}
                    {e.periodEnd.toISOString().slice(0, 10)} ·{" "}
                    {e.kind.replace(/_/g, " ").toLowerCase()}
                  </span>
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      <h2>Open requests</h2>
      {client.clientRequests.length === 0 ? (
        <EmptyState title="Nothing outstanding" body="No document requests are currently open with this client." />
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <caption>Requests still awaiting a response.</caption>
            <thead>
              <tr>
                <th scope="col">Request</th>
                <th scope="col">State</th>
                <th scope="col" className="numeric">Items outstanding</th>
                <th scope="col">Due</th>
              </tr>
            </thead>
            <tbody>
              {client.clientRequests.map((r) => (
                <tr key={r.id}>
                  <th scope="row">{r.title}</th>
                  <td>{r.state.replace(/_/g, " ").toLowerCase()}</td>
                  <td className="numeric">{r.items.length}</td>
                  <td>{r.dueDate ? r.dueDate.toISOString().slice(0, 10) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showDocuments ? (
        <>
          <h2>Files</h2>
          {documents.length === 0 ? (
            <EmptyState title="No client-facing documents" body="No released or client-supplied documents are filed for this client." />
          ) : (
            <ul className="nav-list">
              {documents.map((d) => (
                <li key={d.id}>
                  <Link className="nav-link" href={`/documents/${d.id}`}>
                    {d.title}
                    <span className="muted">
                      {[d.documentType, d.periodLabel].filter(Boolean).join(" · ")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}

      {/* CLI06: finance is a tab of its own, gated separately. A user without
          invoice.read gets no section and no totals — not an empty one. */}
      {showFinance ? (
        <>
          <h2>Finance</h2>
          {invoices.length === 0 ? (
            <EmptyState title="No invoices" body="No invoice has been raised for this client in this practice." />
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <caption>Invoices raised by {ctx.activePractice!.name}.</caption>
                <thead>
                  <tr>
                    <th scope="col">Number</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="numeric">Total</th>
                    <th scope="col">Issued</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id}>
                      <th scope="row">{inv.sequenceNumber}</th>
                      <td>{inv.status.toLowerCase()}</td>
                      <td className="numeric">
                        {inv.currency} {inv.total.toString()}
                      </td>
                      <td>{inv.issuedAt ? inv.issuedAt.toISOString().slice(0, 10) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </Screen>
  );
}
