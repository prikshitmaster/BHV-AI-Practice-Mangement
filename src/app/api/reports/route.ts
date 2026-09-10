import { NextResponse } from "next/server";
import { badRequest, errorResponse, withApiContext } from "@/lib/api";
import { requireUserId } from "@/lib/session";
import {
  drillThrough,
  formatMeasure,
  listReportDefinitions,
  runReport,
  toCsv,
  type ReportFilters,
} from "@/lib/report-catalogue";

export const dynamic = "force-dynamic";

/**
 * REP01 — run a report, drill through it, or export it (PRD §40).
 *
 * One endpoint for all three because they must be the SAME computation: an
 * export that runs its own query is an export that can disagree with the
 * screen, and "reconcile totals to an exported report" is then a property
 * nobody can hold. `format=csv` serialises the very object the JSON branch
 * returns.
 */

function parseFilters(url: URL): ReportFilters | { error: string } {
  const date = (name: string): Date | undefined | null => {
    const raw = url.searchParams.get(name);
    if (!raw) return undefined;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const periodStart = date("periodStart");
  const periodEnd = date("periodEnd");
  const asAt = date("asAt");
  if (periodStart === null) return { error: "periodStart is not a date" };
  if (periodEnd === null) return { error: "periodEnd is not a date" };
  if (asAt === null) return { error: "asAt is not a date" };

  const text = (name: string) => url.searchParams.get(name) ?? undefined;

  return {
    practiceId: text("practiceId"),
    branchId: text("branchId"),
    teamId: text("teamId"),
    serviceCode: text("serviceCode"),
    ownerUserId: text("ownerUserId"),
    clientRelationshipId: text("clientRelationshipId"),
    periodStart,
    periodEnd,
    asAt,
  };
}

export async function GET(request: Request) {
  return withApiContext(request, async () => {
    try {
      const userId = await requireUserId();
      const url = new URL(request.url);

      const reportId = url.searchParams.get("reportId");
      if (!reportId) {
        // No report named: list what this deployment offers, with the formula
        // for each. The catalogue itself discloses nothing about any practice.
        return NextResponse.json({
          reports: listReportDefinitions().map((def) => ({
            id: def.id,
            title: def.title,
            formula: def.formula,
            supportedFilters: def.supportedFilters,
          })),
        });
      }

      const filters = parseFilters(url);
      if ("error" in filters) return badRequest(filters.error);

      const mode = url.searchParams.get("mode") ?? "summary";
      if (mode === "drill") {
        const drill = await drillThrough(userId, reportId, filters);
        return NextResponse.json({
          rows: drill.rows,
          recordCount: drill.recordCount,
          reconcilesTo: drill.reconcilesTo,
        });
      }

      const result = await runReport(userId, reportId, filters);

      if (url.searchParams.get("format") === "csv") {
        const csv = toCsv(result);
        return new NextResponse(csv, {
          status: 200,
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": `attachment; filename="${result.reportId}.csv"`,
          },
        });
      }

      return NextResponse.json({
        reportId: result.reportId,
        title: result.title,
        formula: result.formula,
        refreshedAt: result.refreshedAt,
        recordCount: result.recordCount,
        scope: result.scope,
        measures: result.measures.map((m) => ({ ...m, display: formatMeasure(m) })),
        rows: result.rows,
        excluded: result.excluded,
      });
    } catch (e) {
      return errorResponse(e);
    }
  });
}
