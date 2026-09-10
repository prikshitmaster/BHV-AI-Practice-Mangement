/**
 * The one entry point for reports — REP01 (PRD §40).
 *
 * `reports.ts` holds the shell and an empty registry; `report-metrics.ts`
 * fills that registry when it is imported. Nothing else may import either
 * directly, because a caller that imports the shell alone gets a registry with
 * no reports in it and a "no such report" 404 that looks like a routing bug.
 *
 * The bare import below is the registration. The assertion under it is there
 * because a side-effect import is exactly the kind of line a refactor deletes
 * as unused: if that happens, this fails loudly on first use instead of
 * quietly reporting that the practice has no reports.
 */

import "@/lib/report-metrics";
import { listReportDefinitions } from "@/lib/reports";

if (listReportDefinitions().length === 0) {
  throw new Error(
    "No report definitions registered — the side-effect import of " +
      "@/lib/report-metrics has been removed or failed.",
  );
}

export {
  DATE_POLICY,
  ReportError,
  drillThrough,
  formatMeasure,
  listReportDefinitions,
  reportDefinition,
  runReport,
  toCsv,
  type Measure,
  type ReportDefinition,
  type ReportFilters,
  type ReportResult,
  type ReportRow,
} from "@/lib/reports";
