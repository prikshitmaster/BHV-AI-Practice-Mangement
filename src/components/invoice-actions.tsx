"use client";

import { useRouter } from "next/navigation";
import { mutate } from "@/lib/client-fetch";
import { SafeAction, type ActionOutcome } from "@/components/safe-action";

/**
 * FIN02 approve / issue / cancel, as screen actions.
 *
 * The version the screen loaded is passed back on every call. That is what
 * turns "two people had this invoice open" from a silent overwrite into a
 * refusal the second person can see (API02) — and it is why the buttons carry
 * the version rather than re-reading it at click time, which would defeat the
 * check by always sending whatever the server currently holds.
 *
 * Issue is confirmed explicitly (NAV04): it takes a statutory number and locks
 * the particulars, and the dialog says so in those words rather than "Are you
 * sure?".
 */
export function InvoiceActions({
  invoiceId,
  status,
  version,
  total,
  currency,
  canApprove,
  canIssue,
}: {
  invoiceId: string;
  status: string;
  version: number;
  total: string;
  currency: string;
  canApprove: boolean;
  canIssue: boolean;
}) {
  const router = useRouter();

  async function post(path: string, body: Record<string, unknown>): Promise<ActionOutcome> {
    const response = await mutate(path, { method: "POST", body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return {
        ok: false,
        message: data.error ?? "The action did not complete.",
        // 409 is the conflict shape: someone else moved first, or a rule
        // refused. Either way the screen is out of date, so it reloads.
        conflict: response.status === 409,
      };
    }

    router.refresh();
    return { ok: true, message: data.number ? `Issued as ${data.number}.` : "Done." };
  }

  return (
    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
      {status === "DRAFT" && canApprove ? (
        <SafeAction
          label="Approve"
          pendingLabel="Approving…"
          onConfirm={() => post(`/api/invoices/${invoiceId}/approve`, { expectedVersion: version })}
        />
      ) : null}

      {status === "APPROVED" && canIssue ? (
        <SafeAction
          label="Issue"
          pendingLabel="Issuing invoice…"
          confirm={{
            title: "Issue this invoice?",
            body: (
              <>
                It takes the next number in the series and the particulars are locked
                from then on. {currency} {total} will be payable by the client. A
                correction after this needs a reviewed credit note.
              </>
            ),
            confirmLabel: "Issue invoice",
          }}
          onConfirm={() => post(`/api/invoices/${invoiceId}/issue`, { expectedVersion: version })}
        />
      ) : null}

      {(status === "DRAFT" || status === "APPROVED" || status === "ISSUED") && canIssue ? (
        <SafeAction
          label="Cancel invoice"
          pendingLabel="Cancelling…"
          danger
          confirm={{
            title: "Cancel this invoice?",
            body: (
              <>
                The invoice stays in the register as cancelled — it is not deleted.
                If money has already been received against it, cancel is refused and
                the correction is a credit note.
              </>
            ),
            confirmLabel: "Cancel invoice",
          }}
          onConfirm={() =>
            post(`/api/invoices/${invoiceId}/cancel`, {
              expectedVersion: version,
              reason: "Cancelled from the billing screen",
            })
          }
        />
      ) : null}
    </div>
  );
}
