import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { screenContext } from "@/lib/screen-context";
import { EmptyState, PermissionState, Screen } from "@/components/states";

export const dynamic = "force-dynamic";

/**
 * Billing register — FIN02, the list side.
 *
 * The nav has linked here since T16; until now the destination did not exist.
 *
 * Scoped to the ACTIVE practice, like every other screen: an invoice register
 * is exactly the place where two firms' figures must not appear in one list,
 * and the practice comes from the session context rather than a filter the
 * user could widen. A draft has no number yet (FIN02 numbers at issue), so the
 * column shows the status instead rather than inventing a placeholder.
 */
export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const scope = await screenContext("invoice.read");
  const { status = "" } = await searchParams;

  if (scope.state === "signed-out") {
    return (
      <Screen title="Billing">
        <EmptyState title="Sign in to see the billing register" />
      </Screen>
    );
  }
  if (scope.state === "no-practice" || scope.state === "denied") {
    return (
      <Screen title="Billing">
        <PermissionState />
      </Screen>
    );
  }

  const { ctx, practiceId } = scope;

  const invoices = await prisma.invoice.findMany({
    where: {
      practiceId,
      ...(status ? { status: status as never } : {}),
    },
    orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }],
    take: 100,
    select: {
      id: true,
      displayNumber: true,
      status: true,
      total: true,
      currency: true,
      issueDate: true,
      dueDate: true,
      clientRelationship: { select: { party: { select: { legalName: true } } } },
      series: { select: { code: true, fiscalPeriod: true } },
    },
  });

  return (
    <Screen
      title="Billing"
      lede={`Invoices raised by ${ctx.activePractice!.name}.`}
      breadcrumbs={[{ href: "/", label: "Home" }]}
    >
      <form method="get" className="row" style={{ marginBottom: 16 }}>
        <label htmlFor="status-filter" className="field-label" style={{ marginBottom: 0 }}>
          Status
        </label>
        <select
          id="status-filter"
          name="status"
          defaultValue={status}
          className="field-input"
          style={{ maxWidth: "14rem", minHeight: 36 }}
        >
          <option value="">All</option>
          <option value="DRAFT">Draft</option>
          <option value="APPROVED">Approved</option>
          <option value="ISSUED">Issued</option>
          <option value="PART_PAID">Part paid</option>
          <option value="PAID">Paid</option>
          <option value="CREDITED">Credited</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <button type="submit" className="btn">
          Filter
        </button>
      </form>

      {invoices.length === 0 ? (
        <EmptyState
          title={status ? "No invoice in that state" : "No invoices raised yet"}
          body={
            status
              ? "Nothing in this practice is currently in that state."
              : "Invoices raised in this practice will appear here."
          }
          action={
            status ? (
              <Link className="btn" href="/billing">
                Clear the filter
              </Link>
            ) : null
          }
        />
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <caption>
              {invoices.length} invoice{invoices.length === 1 ? "" : "s"} in{" "}
              {ctx.activePractice!.name}.
            </caption>
            <thead>
              <tr>
                <th scope="col">Number</th>
                <th scope="col">Client</th>
                <th scope="col">Status</th>
                <th scope="col">Issued</th>
                <th scope="col">Due</th>
                <th scope="col">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td>
                    <Link href={`/billing/${invoice.id}`}>
                      {invoice.displayNumber ?? "Not yet numbered"}
                    </Link>
                  </td>
                  <td>{invoice.clientRelationship.party.legalName}</td>
                  <td>
                    <span className="status">{label(invoice.status)}</span>
                  </td>
                  <td>{invoice.issueDate ? invoice.issueDate.toISOString().slice(0, 10) : "—"}</td>
                  <td>{invoice.dueDate ? invoice.dueDate.toISOString().slice(0, 10) : "—"}</td>
                  <td>
                    {invoice.currency} {invoice.total.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Screen>
  );
}

export function label(status: string): string {
  switch (status) {
    case "PART_PAID":
      return "Part paid";
    case "NOT_APPLICABLE":
      return "Not applicable";
    default:
      return status.charAt(0) + status.slice(1).toLowerCase();
  }
}
