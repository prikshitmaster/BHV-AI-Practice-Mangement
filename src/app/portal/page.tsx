import Link from "next/link";
import { redirect } from "next/navigation";
import { optionalPortalContact } from "@/lib/portal-session";
import { listPortalEntities, loadPortalHome, type PortalItemStatus } from "@/lib/portal";
import { PortalEntitySwitcher } from "@/components/portal-entity-switcher";
import { EmptyState } from "@/components/states";

export const dynamic = "force-dynamic";

/**
 * POR01 portal home.
 *
 * "Show the identified practice, authorised client entities, pending requests,
 * upcoming agreed dates, released deliverables and issued invoices. Provide a
 * clear 'Upload requested documents' action and a short help link."
 *
 * The order on screen is the order a client needs it: who this is, what they
 * owe us, when, then what we have given them. The primary action sits at the
 * top because POR01 names it as the one thing that must be obvious.
 *
 * Everything rendered comes from `loadPortalHome`, whose queries name their
 * fields explicitly — so nothing internal can reach this page by being added
 * to a model later.
 */
export default async function PortalHomePage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string }>;
}) {
  const actor = await optionalPortalContact();
  if (!actor) redirect("/portal/help");

  const { entity: requested } = await searchParams;

  const entities = await listPortalEntities({
    contactId: actor.contactId,
    practiceId: actor.practiceId,
  });

  if (entities.length === 0) {
    // Not a permission state: a contact with no live grant has nothing to be
    // refused FROM, and naming what they cannot reach would be the disclosure.
    return (
      <div className="portal-page">
        <EmptyState
          title="There is nothing here for you yet"
          body="Your access has not been set up, or it has ended. Contact the team and they can help."
        />
        <p>
          <Link href="/portal/help">Get help</Link>
        </p>
      </div>
    );
  }

  // NAV03 applied to the portal: an entity id you may not use is not honoured
  // and not announced — you land on one you do hold.
  const active =
    entities.find((e) => e.clientRelationshipId === requested) ?? entities[0];

  const home = await loadPortalHome({
    contactId: actor.contactId,
    practiceId: actor.practiceId,
    clientRelationshipId: active.clientRelationshipId,
  });

  const outstanding = home.requests.flatMap((r) =>
    r.items.filter((i) => i.status === "AWAITING_UPLOAD" || i.status === "NEEDS_CORRECTION"),
  );

  return (
    <div className="portal-page">
      <header className="portal-header">
        {/* POR01 "the identified practice" — in text, always, never only a logo. */}
        <p className="portal-firm">{home.practice.name}</p>
        <h1>{home.active.legalName}</h1>
        <PortalEntitySwitcher entities={home.entities} activeId={active.clientRelationshipId} />
      </header>

      {/* POR01's named primary action. */}
      <section className="portal-primary" aria-labelledby="portal-primary-heading">
        <h2 id="portal-primary-heading">Upload requested documents</h2>
        {outstanding.length > 0 ? (
          <>
            <p>
              {outstanding.length === 1
                ? "There is 1 document we still need from you."
                : `There are ${outstanding.length} documents we still need from you.`}
            </p>
            <Link className="btn btn--primary" href={`/portal/upload/${outstanding[0].id}`}>
              Upload requested documents
            </Link>
          </>
        ) : (
          <p>Nothing is outstanding right now. We&rsquo;ll let you know when we need something.</p>
        )}
      </section>

      <section aria-labelledby="portal-requests-heading">
        <h2 id="portal-requests-heading">What we&rsquo;ve asked for</h2>
        {home.requests.length === 0 ? (
          <EmptyState
            title="No open document requests"
            body="When the team needs something from you it will appear here."
          />
        ) : (
          home.requests.map((request) => (
            <article className="card portal-request" key={request.id}>
              <h3>{request.title}</h3>
              {request.serviceCode ? (
                <p className="muted">
                  {request.serviceCode}
                  {request.dueDate ? ` · needed by ${formatDate(request.dueDate)}` : null}
                </p>
              ) : request.dueDate ? (
                <p className="muted">Needed by {formatDate(request.dueDate)}</p>
              ) : null}
              {request.detail ? <p>{request.detail}</p> : null}

              <ul className="portal-items">
                {request.items.map((item) => (
                  <li key={item.id}>
                    <div className="row">
                      <div>
                        <strong>{item.documentType}</strong>
                        {item.periodLabel ? <span className="muted"> · {item.periodLabel}</span> : null}
                        {item.description ? <p className="muted">{item.description}</p> : null}
                        {/* Only shown when the item is actually in that state,
                            so an old reason cannot read as a live complaint. */}
                        {item.correctionReason ? (
                          <p className="portal-correction">{item.correctionReason}</p>
                        ) : null}
                      </div>
                      <div className="spacer" />
                      <span className={`status ${statusClass(item.status)}`}>{item.statusLabel}</span>
                      {item.status === "AWAITING_UPLOAD" || item.status === "NEEDS_CORRECTION" ? (
                        <Link className="btn" href={`/portal/upload/${item.id}`}>
                          Upload
                        </Link>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </article>
          ))
        )}
      </section>

      <section aria-labelledby="portal-dates-heading">
        <h2 id="portal-dates-heading">Dates we&rsquo;ve agreed</h2>
        {home.agreedDates.length === 0 ? (
          <EmptyState title="No upcoming dates for this entity" />
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <caption className="visually-hidden">Upcoming agreed dates</caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">What</th>
                </tr>
              </thead>
              <tbody>
                {home.agreedDates.map((d, i) => (
                  <tr key={`${d.kind}-${i}`}>
                    <td>{formatDate(d.date)}</td>
                    <td>{d.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="portal-deliverables-heading">
        <h2 id="portal-deliverables-heading">Documents we&rsquo;ve released to you</h2>
        {home.deliverables.length === 0 ? (
          <EmptyState
            title="Nothing has been released to you yet"
            body="Finished documents appear here once the team releases them."
          />
        ) : (
          <ul className="portal-items">
            {home.deliverables.map((d) => (
              <li key={d.releaseId}>
                <div className="row">
                  <div>
                    <strong>{d.title}</strong>
                    <p className="muted">
                      Version {d.versionNo} · released {formatDate(d.releasedAt)}
                      {d.expiresAt ? ` · available until ${formatDate(d.expiresAt)}` : null}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="portal-invoices-heading">
        <h2 id="portal-invoices-heading">Invoices</h2>
        {home.invoices.length === 0 ? (
          <EmptyState title="No issued invoices for this entity" />
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <caption className="visually-hidden">Issued invoices</caption>
              <thead>
                <tr>
                  <th scope="col">Reference</th>
                  <th scope="col">Issued</th>
                  <th scope="col">Amount</th>
                </tr>
              </thead>
              <tbody>
                {home.invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td>{inv.reference}</td>
                    <td>{formatDate(inv.issuedAt)}</td>
                    <td>
                      {inv.currency} {inv.total}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* POR01 "a short help link", POR05 support route. */}
      <footer className="portal-footer">
        <Link href="/portal/help">Help, or contact the team</Link>
      </footer>
    </div>
  );
}

function statusClass(status: PortalItemStatus): string {
  switch (status) {
    case "ACCEPTED":
      return "status--ok";
    case "NEEDS_CORRECTION":
      return "status--warn";
    case "AWAITING_UPLOAD":
      return "status--info";
    default:
      return "status--info";
  }
}

function formatDate(value: Date): string {
  return new Date(value).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}
