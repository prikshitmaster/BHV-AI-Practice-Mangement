/**
 * Reports shell — REP01 (PRD §40).
 *
 * "Provide filters by permitted practice, branch, team, service, owner, client
 *  and period. Each report shows refresh time, formula definition and record
 *  count. An empty denominator displays Not available; missing information
 *  must not silently become zero."
 *
 * §40's opening line is the one that shapes this file: "Every metric must
 * identify scope, period, status basis and drill through records." So a report
 * here is not a number. It is a number ACCOMPANIED BY the definition that
 * produced it, the scope it was computed over, the moment it was computed, the
 * count of records behind it, and a way to open those records. A figure
 * without those is not auditable, and an unauditable figure in a practice
 * management system gets quoted in a partner meeting anyway.
 *
 * The rule that costs the most to honour, and matters most:
 *
 *   A ratio with no denominator is NOT ZERO. "0% on-time" and "no obligations
 *   were due" are opposite findings and look identical once an empty
 *   denominator has been coerced to a percentage. Every ratio here returns
 *   `value: null` with a stated reason instead, and the screen prints
 *   "Not available".
 *
 * REP02 (combined reports) and REP03 (targets and baseline) are R1.
 */

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { assertCan, type Action } from "@/lib/permissions";
import { practiceScopeFilter, PracticeAccessError } from "@/lib/practice-scope";

export class ReportError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "ReportError";
  }
}

// --------------------------------------------------------------- filters

/**
 * REP01's filter surface. Every field is optional; what is NOT optional is
 * that `practiceId` is checked against live membership rather than trusted —
 * `resolveScope` below does that, and nothing in this module queries without
 * going through it.
 */
export type ReportFilters = {
  practiceId?: string;
  branchId?: string;
  teamId?: string;
  /** Engagement service code — "service" in REP01's list. */
  serviceCode?: string;
  ownerUserId?: string;
  clientRelationshipId?: string;
  periodStart?: Date;
  periodEnd?: Date;
  /**
   * The date the report is answered AS AT. Absent means now. A prior-period
   * report passes the end of that period here, and every date-sensitive
   * metric then answers as the record stood then — see `statutoryDateAsAt`.
   */
  asAt?: Date;
};

export type ResolvedScope = {
  practiceIds: string[];
  where: { practiceId: { in: string[] } };
  asAt: Date;
  filters: ReportFilters;
};

/**
 * Turns requested filters into a scope that cannot over-reach.
 *
 * The practice filter comes from `practiceScopeFilter`, so a user with no
 * memberships gets `practiceId IN ()` — a filter that matches nothing —
 * rather than an unfiltered query. Branch and team are then checked to belong
 * to a permitted practice: a branch id is a perfectly good way to reach across
 * a practice boundary if it is pasted into a query string and used as-is.
 */
export async function resolveScope(
  userId: string,
  filters: ReportFilters,
): Promise<ResolvedScope> {
  const where = await practiceScopeFilter(userId, filters.practiceId);

  if (filters.branchId) {
    const branch = await prisma.branch.findFirst({
      where: { id: filters.branchId, ...where },
      select: { id: true },
    });
    if (!branch) throw new PracticeAccessError(userId, filters.branchId);
  }
  if (filters.teamId) {
    const team = await prisma.team.findFirst({
      where: { id: filters.teamId, ...where },
      select: { id: true },
    });
    if (!team) throw new PracticeAccessError(userId, filters.teamId);
  }
  if (filters.clientRelationshipId) {
    const client = await prisma.clientRelationship.findFirst({
      where: { id: filters.clientRelationshipId, ...where },
      select: { id: true },
    });
    if (!client) throw new PracticeAccessError(userId, filters.clientRelationshipId);
  }

  if (filters.periodStart && filters.periodEnd && filters.periodStart > filters.periodEnd) {
    throw new ReportError("The period starts after it ends.", "BAD_PERIOD");
  }

  return {
    practiceIds: where.practiceId.in,
    where,
    asAt: filters.asAt ?? new Date(),
    filters,
  };
}

// --------------------------------------------------------------- results

/**
 * A measured figure. `value` is null when it could not be computed, and
 * `notAvailableReason` then says why in words a partner can act on.
 *
 * `numerator` and `denominator` are carried separately and always: a ratio
 * whose parts are hidden cannot be reconciled to an export, which is half of
 * §40's acceptance evidence.
 */
export type Measure = {
  label: string;
  /** Null means NOT AVAILABLE. It never means zero. */
  value: number | null;
  unit: "ratio" | "count" | "days" | "currency";
  numerator?: number;
  denominator?: number;
  notAvailableReason?: string;
};

/** A row behind a figure, and the record it drills through to. */
export type ReportRow = {
  recordType: string;
  recordId: string;
  practiceId: string;
  label: string;
  /** The columns an export writes, in the order it writes them. */
  cells: Record<string, string | number | null>;
};

export type ReportResult = {
  reportId: string;
  title: string;
  /** REP01: the formula, shown with the number, not buried in documentation. */
  formula: string;
  /** REP01: when this was computed. */
  refreshedAt: Date;
  /** REP01: how many records the figures were computed over. */
  recordCount: number;
  /** §40: the scope the figures cover, stated rather than assumed. */
  scope: {
    practiceIds: string[];
    periodStart: Date | null;
    periodEnd: Date | null;
    asAt: Date;
    /** The status basis — which record states counted, in words. */
    statusBasis: string;
  };
  measures: Measure[];
  rows: ReportRow[];
  /**
   * Cases the metric refuses to classify. §40's on-time filing rate says
   * "Show unknown / disputed cases separately" — folding them into either
   * side of the ratio is how a disputed filing becomes a success.
   */
  excluded?: { label: string; count: number; recordIds: string[] };
};

export type ReportDefinition = {
  id: string;
  title: string;
  formula: string;
  /** Deny by default: the report cannot run without this. */
  requires: Action;
  /** Which REP01 filters this report actually honours, for the UI to render. */
  supportedFilters: Array<keyof ReportFilters>;
  run: (scope: ResolvedScope) => Promise<Omit<ReportResult, "reportId" | "title" | "formula">>;
};

/**
 * A ratio, built in one place so no report can accidentally publish 0/0 as 0%.
 */
export function ratio(
  label: string,
  numerator: number,
  denominator: number,
  emptyReason: string,
): Measure {
  if (denominator <= 0) {
    return {
      label,
      value: null,
      unit: "ratio",
      numerator,
      denominator: 0,
      notAvailableReason: emptyReason,
    };
  }
  return { label, value: numerator / denominator, unit: "ratio", numerator, denominator };
}

// ----------------------------------------------------------- date policy

/**
 * §40 acceptance evidence, second sentence: "A deadline extension applies the
 * documented current date policy while retaining a historical snapshot for
 * prior reports."
 *
 * The policy, stated rather than implied:
 *
 *   A report answered AS AT a moment uses the statutory date that was in force
 *   at that moment. An extension granted afterwards does not reach backwards
 *   and turn a late filing into a punctual one in a report that was already
 *   published — and, equally, does not leave a live report showing a date the
 *   authorities have moved.
 *
 * `Obligation.currentStatutoryDate` holds today's date and
 * `originalStatutoryDate` the first one. The dates in between are recoverable
 * from `ObligationChange`, which records before/after and when. So the date in
 * force at time T is: the after-value of the LAST change at or before T, or
 * the original date if no change had happened yet.
 */
export const DATE_POLICY =
  "Dates are those in force at the report's as-at moment. An extension granted " +
  "after that moment does not change this report; a report run now uses the " +
  "current statutory date.";

type ObligationDateInput = {
  id: string;
  originalStatutoryDate: Date;
  currentStatutoryDate: Date;
};

/**
 * The statutory date each obligation carried at `asAt`.
 *
 * Reads the change log once for the whole set rather than per obligation — a
 * report over a year of obligations would otherwise issue one query per row.
 */
export async function statutoryDateAsAt(
  obligations: ObligationDateInput[],
  asAt: Date,
): Promise<Map<string, Date>> {
  const result = new Map<string, Date>();
  if (obligations.length === 0) return result;

  const changes = await prisma.obligationChange.findMany({
    where: { obligationId: { in: obligations.map((o) => o.id) } },
    orderBy: { createdAt: "asc" },
    select: { obligationId: true, afterMeta: true, createdAt: true },
  });

  for (const o of obligations) {
    // No change log at all: the date has never moved.
    result.set(o.id, o.originalStatutoryDate);
  }

  for (const change of changes) {
    if (change.createdAt > asAt) continue; // hasn't happened yet, as at this report
    const after = change.afterMeta as { currentStatutoryDate?: string } | null;
    const moved = after?.currentStatutoryDate;
    if (!moved) continue;
    const parsed = new Date(moved);
    if (!Number.isNaN(parsed.getTime())) result.set(change.obligationId, parsed);
  }

  return result;
}

// ------------------------------------------------------------- registry

const REGISTRY = new Map<string, ReportDefinition>();

export function registerReport(definition: ReportDefinition): void {
  REGISTRY.set(definition.id, definition);
}

export function listReportDefinitions(): ReportDefinition[] {
  return [...REGISTRY.values()];
}

export function reportDefinition(id: string): ReportDefinition {
  const definition = REGISTRY.get(id);
  if (!definition) throw new ReportError("No such report.", "NO_SUCH_REPORT", 404);
  return definition;
}

/**
 * Run a report. The only entry point — permission is checked here, once, for
 * every practice in scope, so a report cannot be reached through a definition
 * that forgot to check.
 */
export async function runReport(
  userId: string,
  reportId: string,
  filters: ReportFilters,
): Promise<ReportResult> {
  const definition = reportDefinition(reportId);
  const scope = await resolveScope(userId, filters);

  if (scope.practiceIds.length === 0) {
    throw new PracticeAccessError(userId, filters.practiceId ?? "any");
  }

  // Every practice, not just the requested one: a combined figure that
  // includes a practice the reader lacks the capability in is a disclosure.
  for (const practiceId of scope.practiceIds) {
    await assertCan(userId, practiceId, definition.requires);
  }

  const body = await definition.run(scope);

  return {
    reportId: definition.id,
    title: definition.title,
    formula: definition.formula,
    ...body,
  };
}

/**
 * §40 evidence, first sentence: "Drill from a chart to its underlying
 * authorised records."
 *
 * The drill deliberately re-runs the report rather than trusting an id list
 * the caller hands back. A drill that accepts record ids from the client is a
 * way to read records the aggregate never included — and the aggregate's own
 * scope is exactly what was authorised.
 */
export async function drillThrough(
  userId: string,
  reportId: string,
  filters: ReportFilters,
): Promise<{ rows: ReportRow[]; recordCount: number; reconcilesTo: Measure[] }> {
  const result = await runReport(userId, reportId, filters);
  return {
    rows: result.rows,
    recordCount: result.recordCount,
    reconcilesTo: result.measures,
  };
}

/**
 * The export. Built from the SAME result object the screen renders, so the
 * two cannot disagree — "reconcile totals to an exported report" is not a
 * property you can test into two separate query paths.
 */
export function toCsv(result: ReportResult): string {
  const lines: string[] = [];

  // The header block is part of the export, not decoration: an exported
  // figure with no definition, scope or refresh time is the thing REP01 is
  // written to prevent, and an export outlives the screen it came from.
  lines.push(`# ${result.title}`);
  lines.push(`# Formula: ${result.formula}`);
  lines.push(`# Refreshed at: ${result.refreshedAt.toISOString()}`);
  lines.push(`# As at: ${result.scope.asAt.toISOString()}`);
  lines.push(`# Status basis: ${result.scope.statusBasis}`);
  lines.push(`# Date policy: ${DATE_POLICY}`);
  lines.push(`# Practices in scope: ${result.scope.practiceIds.length}`);
  lines.push(`# Record count: ${result.recordCount}`);
  for (const measure of result.measures) {
    const value =
      measure.value === null
        ? `Not available (${measure.notAvailableReason ?? "no denominator"})`
        : formatMeasure(measure);
    const parts =
      measure.numerator !== undefined && measure.denominator !== undefined
        ? ` [${measure.numerator} / ${measure.denominator}]`
        : "";
    lines.push(`# ${measure.label}: ${value}${parts}`);
  }
  if (result.excluded) {
    lines.push(`# ${result.excluded.label}: ${result.excluded.count}`);
  }

  const columns = result.rows.length > 0 ? Object.keys(result.rows[0].cells) : [];
  lines.push(["Record type", "Record id", ...columns].map(csvCell).join(","));
  for (const row of result.rows) {
    lines.push(
      [row.recordType, row.recordId, ...columns.map((c) => row.cells[c])].map(csvCell).join(","),
    );
  }

  return lines.join("\n");
}

export function formatMeasure(measure: Measure): string {
  if (measure.value === null) return "Not available";
  switch (measure.unit) {
    case "ratio":
      return `${(measure.value * 100).toFixed(1)}%`;
    case "days":
      return `${measure.value.toFixed(1)} days`;
    case "currency":
      return measure.value.toFixed(2);
    default:
      return String(measure.value);
  }
}

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Shared date-window helper: a period filter that tolerates an open end. */
export function periodWindow(scope: ResolvedScope): Prisma.DateTimeFilter | undefined {
  const { periodStart, periodEnd } = scope.filters;
  if (!periodStart && !periodEnd) return undefined;
  return {
    ...(periodStart ? { gte: periodStart } : {}),
    ...(periodEnd ? { lte: periodEnd } : {}),
  };
}
