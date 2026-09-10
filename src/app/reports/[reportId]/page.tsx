import Link from "next/link";
import { screenContext } from "@/lib/screen-context";
import {
  EmptyState,
  ErrorState,
  PermissionState,
  Screen,
} from "@/components/states";
import {
  formatMeasure,
  reportDefinition,
  runReport,
  ReportError,
  type ReportFilters,
} from "@/lib/report-catalogue";
import { PracticeAccessError } from "@/lib/practice-scope";
import { PermissionDeniedError } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/**
 * One report — REP01 (PRD §40).
 *
 * The layout is the requirement, in order: what this measures, over what
 * scope, on what status basis, computed when, from how many records — and only
 * then the figures. A dashboard that leads with a number and hides its
 * definition behind a tooltip is the thing §40 is written against.
 *
 * "Not available" is rendered as words, never as a dash, an empty cell or 0%.
 * A reader who sees "—" fills it in themselves, usually with zero.
 *
 * The rows underneath ARE the drill-through: the same records the export
 * carries, re-computed under the reader's own authority on every load rather
 * than cached from whoever ran it last.
 */
export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ reportId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { reportId } = await params;
  const query = await searchParams;
  const scope = await screenContext();

  if (scope.state === "signed-out") {
    return (
      <Screen title="Report">
        <EmptyState title="Sign in to see this report" />
      </Screen>
    );
  }
  if (scope.state === "no-practice") {
    return (
      <Screen title="Report">
        <PermissionState />
      </Screen>
    );
  }

  const { ctx, practiceId } = scope;

  let definitionTitle = "Report";
  try {
    definitionTitle = reportDefinition(reportId).title;
  } catch {
    return (
      <Screen title="Report" breadcrumbs={[{ href: "/reports", label: "Reports" }]}>
        <EmptyState
          title="No such report"
          body="This report does not exist in this deployment."
          action={
            <Link className="btn" href="/reports">
              Back to reports
            </Link>
          }
        />
      </Screen>
    );
  }

  const toDate = (raw: string | undefined) => {
    if (!raw) return undefined;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  };

  const filters: ReportFilters = {
    practiceId,
    periodStart: toDate(query.periodStart),
    periodEnd: toDate(query.periodEnd),
    asAt: toDate(query.asAt),
  };

  let result;
  try {
    result = await runReport(ctx.userId, reportId, filters);
  } catch (e) {
    // A report the reader may not run, in a practice they may not read, is
    // one refusal — and it must not distinguish the two.
    if (e instanceof PermissionDeniedError || e instanceof PracticeAccessError) {
      return (
        <Screen title={definitionTitle} breadcrumbs={[{ href: "/reports", label: "Reports" }]}>
          <PermissionState />
        </Screen>
      );
    }
    if (e instanceof ReportError) {
      return (
        <Screen title={definitionTitle} breadcrumbs={[{ href: "/reports", label: "Reports" }]}>
          <ErrorState
            title="This report could not be produced"
            detail={e.message}
            retry={
              <Link className="btn" href={`/reports/${reportId}`}>
                Clear the filters and try again
              </Link>
            }
          />
        </Screen>
      );
    }
    throw e;
  }

  const exportHref =
    `/api/reports?reportId=${encodeURIComponent(reportId)}&practiceId=${encodeURIComponent(practiceId)}` +
    `&format=csv` +
    (query.periodStart ? `&periodStart=${encodeURIComponent(query.periodStart)}` : "") +
    (query.periodEnd ? `&periodEnd=${encodeURIComponent(query.periodEnd)}` : "") +
    (query.asAt ? `&asAt=${encodeURIComponent(query.asAt)}` : "");

  const columns = result.rows.length > 0 ? Object.keys(result.rows[0].cells) : [];
  const iso = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);

  return (
    <Screen
      title={result.title}
      lede={result.formula}
      breadcrumbs={[
        { href: "/", label: "Home" },
        { href: "/reports", label: "Reports" },
      ]}
      actions={
        <a className="btn" href={exportHref}>
          Export CSV
        </a>
      }
    >
      {/* REP01: scope, basis, refresh time and record count travel WITH the
          figure. A number quoted without them cannot be checked later. */}
      <dl className="definition-list">
        <div>
          <dt>Scope</dt>
          <dd>
            {ctx.activePractice!.name}
            {result.scope.periodStart || result.scope.periodEnd
              ? ` · ${iso(result.scope.periodStart) ?? "any date"} to ${iso(result.scope.periodEnd) ?? "any date"}`
              : " · all periods"}
          </dd>
        </div>
        <div>
          <dt>Status basis</dt>
          <dd>{result.scope.statusBasis}</dd>
        </div>
        <div>
          <dt>Refreshed</dt>
          <dd>{result.refreshedAt.toISOString().replace("T", " ").slice(0, 19)} UTC</dd>
        </div>
        <div>
          <dt>As at</dt>
          <dd>{result.scope.asAt.toISOString().replace("T", " ").slice(0, 19)} UTC</dd>
        </div>
        <div>
          <dt>Records</dt>
          <dd>{result.recordCount}</dd>
        </div>
      </dl>

      <form method="get" className="row" style={{ marginBottom: 16 }}>
        <label htmlFor="periodStart" className="field-label" style={{ marginBottom: 0 }}>
          From
        </label>
        <input
          id="periodStart"
          name="periodStart"
          type="date"
          className="field-input"
          defaultValue={query.periodStart ?? ""}
          style={{ maxWidth: "12rem" }}
        />
        <label htmlFor="periodEnd" className="field-label" style={{ marginBottom: 0 }}>
          To
        </label>
        <input
          id="periodEnd"
          name="periodEnd"
          type="date"
          className="field-input"
          defaultValue={query.periodEnd ?? ""}
          style={{ maxWidth: "12rem" }}
        />
        <button type="submit" className="btn">
          Apply filters
        </button>
      </form>

      <ul className="measure-list">
        {result.measures.map((m) => (
          <li key={m.label} className="measure">
            <span className="measure-label">{m.label}</span>
            <span className={m.value === null ? "measure-value measure-value--absent" : "measure-value"}>
              {formatMeasure(m)}
            </span>
            {m.numerator !== undefined && m.denominator !== undefined ? (
              <span className="muted">
                {m.numerator} of {m.denominator}
              </span>
            ) : null}
            {/* Why a figure is missing is as much a finding as the figure. */}
            {m.value === null && m.notAvailableReason ? (
              <span className="muted">{m.notAvailableReason}</span>
            ) : null}
          </li>
        ))}
      </ul>

      {result.excluded && result.excluded.count > 0 ? (
        <p className="muted">
          {result.excluded.label}: {result.excluded.count}. These are counted in neither
          part of the ratio above.
        </p>
      ) : null}

      {result.rows.length === 0 ? (
        <EmptyState
          title="No records in this scope"
          body="Nothing matched these filters. The figures above say Not available rather than zero, because there is nothing to measure."
          action={
            <Link className="btn" href={`/reports/${reportId}`}>
              Clear the filters
            </Link>
          }
        />
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <caption>
              The {result.rows.length} record{result.rows.length === 1 ? "" : "s"} behind
              these figures. The export carries exactly these rows.
            </caption>
            <thead>
              <tr>
                {columns.map((column) => (
                  <th scope="col" key={column}>
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr key={row.recordId}>
                  {columns.map((column, index) =>
                    index === 0 ? (
                      <th scope="row" key={column}>
                        {row.cells[column] ?? "Not recorded"}
                      </th>
                    ) : (
                      <td key={column}>{row.cells[column] ?? "Not recorded"}</td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Screen>
  );
}
