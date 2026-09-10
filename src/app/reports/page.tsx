import Link from "next/link";
import { screenContext } from "@/lib/screen-context";
import { EmptyState, PermissionState, Screen } from "@/components/states";
import { listReportDefinitions } from "@/lib/report-catalogue";
import { can } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/**
 * The report catalogue — REP01 (PRD §40).
 *
 * The nav has linked here since T16 with the pin withheld, because the
 * destination did not exist. This is it.
 *
 * Each entry shows its FORMULA on the index, not only on the report. §40 says
 * every metric must identify its definition, and a partner deciding which
 * report to open is exactly when the definition matters — "on time filing
 * rate" sounds unambiguous until you learn whether a return awaiting
 * acknowledgement counts.
 *
 * A report the reader lacks the capability for is not listed. It is not shown
 * greyed out either: a disabled "Receivables ageing" tells an article that
 * this practice has receivables worth reporting on, which is a small
 * disclosure the list has no reason to make.
 */
export default async function ReportsPage() {
  const scope = await screenContext();

  if (scope.state === "signed-out") {
    return (
      <Screen title="Reports">
        <EmptyState title="Sign in to see reports" />
      </Screen>
    );
  }
  if (scope.state === "no-practice" || scope.state === "denied") {
    return (
      <Screen title="Reports">
        <PermissionState />
      </Screen>
    );
  }

  const { ctx } = scope;
  const permitted = listReportDefinitions().filter((def) => can(ctx.membership!, def.requires));

  return (
    <Screen
      title="Reports"
      lede={`Management reports for ${ctx.activePractice!.name}. Every figure states its own definition, the scope it covers and when it was computed.`}
      breadcrumbs={[{ href: "/", label: "Home" }]}
    >
      {permitted.length === 0 ? (
        <EmptyState
          title="No reports available to you"
          body="Reports are shown to the roles that hold the underlying records. Ask a partner if you need one of them."
        />
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <caption>
              {permitted.length} report{permitted.length === 1 ? "" : "s"} available in{" "}
              {ctx.activePractice!.name}.
            </caption>
            <thead>
              <tr>
                <th scope="col">Report</th>
                <th scope="col">Definition</th>
              </tr>
            </thead>
            <tbody>
              {permitted.map((def) => (
                <tr key={def.id}>
                  <th scope="row">
                    <Link href={`/reports/${def.id}`}>{def.title}</Link>
                  </th>
                  <td>{def.formula}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="muted" style={{ marginTop: 16 }}>
        Reports covering time utilisation, engagement economics and practice quality
        need records this release does not yet keep. They are deliberately absent
        rather than estimated.
      </p>
    </Screen>
  );
}
