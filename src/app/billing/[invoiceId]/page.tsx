import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import { screenContext } from "@/lib/screen-context";
import { EmptyState, PermissionState, Screen } from "@/components/states";
import { InvoiceActions } from "@/components/invoice-actions";
import { settlementOf, listAllocations } from "@/lib/receipts";
import { label } from "../page";

export const dynamic = "force-dynamic";

/**
 * One invoice — FIN02 particulars and the FIN04 settlement.
 *
 * The settlement is shown as separate figures (cash received, tax deducted,
 * credited, written off, balance) and never rolled into a single "received"
 * line. That is not presentation: netting ₹90 cash and ₹10 TDS into "₹100
 * received" loses the fact that the ₹10 is recoverable against a certificate,
 * which is the distinction FIN04 exists to keep.
 *
 * An invoice from another practice is not rendered as "forbidden" — it is not
 * found, the same answer the API gives, so this screen cannot be used to
 * confirm that a Company invoice exists.
 */
export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ invoiceId: string }>;
}) {
  const scope = await screenContext("invoice.read");
  const { invoiceId } = await params;

  if (scope.state === "signed-out") {
    return (
      <Screen title="Invoice">
        <EmptyState title="Sign in to see this invoice" />
      </Screen>
    );
  }
  if (scope.state === "no-practice" || scope.state === "denied") {
    return (
      <Screen title="Invoice">
        <PermissionState />
      </Screen>
    );
  }

  const { ctx, practiceId } = scope;

  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, practiceId },
    include: {
      lines: { orderBy: { sortOrder: "asc" } },
      series: { select: { code: true, fiscalPeriod: true } },
      clientRelationship: { select: { party: { select: { legalName: true } } } },
      creditNotes: {
        orderBy: { createdAt: "asc" },
        select: { id: true, displayNumber: true, status: true, amount: true, reason: true },
      },
    },
  });

  if (!invoice) {
    return (
      <Screen title="Invoice" breadcrumbs={[{ href: "/billing", label: "Billing" }]}>
        <EmptyState
          title="No such invoice in this practice"
          body="It may belong to another practice, or it may never have existed."
          action={
            <Link className="btn" href="/billing">
              Back to billing
            </Link>
          }
        />
      </Screen>
    );
  }

  const [settlement, allocations] = await Promise.all([
    settlementOf({ practiceId, invoiceId: invoice.id }),
    listAllocations({ practiceId, invoiceId: invoice.id }),
  ]);

  const live = allocations.filter((a) => a.reversedAt === null);
  const reversed = allocations.filter((a) => a.reversedAt !== null);

  return (
    <Screen
      title={invoice.displayNumber ?? "Draft invoice"}
      lede={`${invoice.clientRelationship.party.legalName} — ${ctx.activePractice!.name}`}
      breadcrumbs={[
        { href: "/", label: "Home" },
        { href: "/billing", label: "Billing" },
      ]}
    >
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <p className="field-label" style={{ marginBottom: 4 }}>
              Status
            </p>
            <span className="status">{label(invoice.status)}</span>
          </div>
          <div>
            <p className="field-label" style={{ marginBottom: 4 }}>
              Series
            </p>
            <p>
              {invoice.series.code} · {invoice.series.fiscalPeriod}
            </p>
          </div>
          <div>
            <p className="field-label" style={{ marginBottom: 4 }}>
              Total
            </p>
            <p>
              {invoice.currency} {invoice.total.toFixed(2)}
            </p>
          </div>
        </div>

        <InvoiceActions
          invoiceId={invoice.id}
          status={invoice.status}
          version={invoice.version}
          total={invoice.total.toFixed(2)}
          currency={invoice.currency}
          canApprove={can(ctx.membership!, "invoice.approve")}
          canIssue={can(ctx.membership!, "invoice.issue")}
        />
      </div>

      <h2>Particulars</h2>
      <div className="table-scroll">
        <table className="data-table">
          <caption>
            {invoice.status === "DRAFT" || invoice.status === "APPROVED"
              ? "Still editable until the invoice is issued."
              : "Locked at issue. A correction needs a reviewed credit note."}
          </caption>
          <thead>
            <tr>
              <th scope="col">Description</th>
              <th scope="col">Quantity</th>
              <th scope="col">Unit</th>
              <th scope="col">Tax %</th>
              <th scope="col">Line total</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line) => (
              <tr key={line.id}>
                <td>{line.description}</td>
                <td>{line.quantity.toString()}</td>
                <td>{line.unitAmount.toFixed(2)}</td>
                <td>{line.taxRatePercent.toFixed(2)}</td>
                <td>{line.lineTotal.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Settlement</h2>
      <div className="table-scroll">
        <table className="data-table">
          <caption>
            Cash, tax deducted and credits are reported separately. They are not one
            figure, because they are not one fact.
          </caption>
          <tbody>
            <tr>
              <th scope="row">Invoice total</th>
              <td>{settlement.invoiceTotal}</td>
            </tr>
            <tr>
              <th scope="row">Cash received</th>
              <td>{settlement.cashReceived}</td>
            </tr>
            <tr>
              <th scope="row">Tax deducted (TDS)</th>
              <td>{settlement.taxDeducted}</td>
            </tr>
            <tr>
              <th scope="row">Credited by note</th>
              <td>{settlement.creditedByNote}</td>
            </tr>
            <tr>
              <th scope="row">Written off</th>
              <td>{settlement.writtenOff}</td>
            </tr>
            <tr>
              <th scope="row">Refunded</th>
              <td>{settlement.refunded}</td>
            </tr>
            <tr>
              <th scope="row">Balance</th>
              <td>{settlement.balance}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Allocations</h2>
      {live.length === 0 ? (
        <EmptyState
          title="Nothing allocated yet"
          body="Receipts, TDS credits and write-offs recorded against this invoice will appear here."
        />
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Kind</th>
                <th scope="col">Amount</th>
                <th scope="col">Source</th>
              </tr>
            </thead>
            <tbody>
              {live.map((a) => (
                <tr key={a.id}>
                  <td>{label(a.kind)}</td>
                  <td>{a.amount.toFixed(2)}</td>
                  <td>
                    {a.receipt
                      ? `${a.receipt.method}${a.receipt.reference ? ` · ${a.receipt.reference}` : ""}`
                      : a.creditNote
                        ? (a.creditNote.displayNumber ?? "Credit note")
                        : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {reversed.length > 0 ? (
        <>
          <h2>Reconciliation adjustments</h2>
          <div className="table-scroll">
            <table className="data-table">
              <caption>
                Reversed entries are kept, not deleted, so the correction is visible to
                whoever reconciles.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Kind</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Reason</th>
                </tr>
              </thead>
              <tbody>
                {reversed.map((a) => (
                  <tr key={a.id}>
                    <td>{label(a.kind)}</td>
                    <td>{a.amount.toFixed(2)}</td>
                    <td>{a.reversalReason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {invoice.creditNotes.length > 0 ? (
        <>
          <h2>Credit notes</h2>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Number</th>
                  <th scope="col">Status</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Reason</th>
                </tr>
              </thead>
              <tbody>
                {invoice.creditNotes.map((n) => (
                  <tr key={n.id}>
                    <td>{n.displayNumber ?? "Not yet issued"}</td>
                    <td>
                      <span className="status">{label(n.status)}</span>
                    </td>
                    <td>{n.amount.toFixed(2)}</td>
                    <td>{n.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </Screen>
  );
}
