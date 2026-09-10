/**
 * The R0 report definitions — PRD §40's metric table.
 *
 * §40 lists seven metrics. Four are computable from R0 data and are built
 * here. The other three are NOT stubbed, because a report that renders a
 * plausible-looking number from data the system does not hold is worse than an
 * absent report:
 *
 *   - Time utilisation needs "defined available capacity", which is the R1
 *     time and capacity module. Dividing by a guessed capacity produces a
 *     number that reads like a performance score.
 *   - Engagement economics needs a recognised revenue basis and WIP, which is
 *     R1 advanced billing. §40 is explicit that cash and revenue must not be
 *     mixed, and mixing them is exactly what R0's data would force.
 *   - Practice quality needs the audit, independence and monitoring records
 *     from R1.
 *
 * Each definition below is a registry entry. Adding one of the three later is
 * another entry, not a change to the shell.
 *
 * Every definition states its status basis in words, because §40's opening
 * line requires it and because "on-time filing rate" means different things
 * depending on whether a submitted-awaiting-acknowledgement return counts.
 */

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  registerReport,
  ratio,
  statutoryDateAsAt,
  type ReportRow,
  type ResolvedScope,
} from "@/lib/reports";

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / DAY_MS;
}

function iso(date: Date | null | undefined): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

// ==================================================== on-time filing rate

registerReport({
  id: "on-time-filing-rate",
  title: "On time filing rate",
  formula:
    "Applicable obligations due in the selected period that were filed by the " +
    "approved effective due date ÷ applicable obligations due. Unknown and " +
    "disputed cases are counted separately and are in neither part of the ratio.",
  requires: "job.read",
  supportedFilters: [
    "practiceId",
    "clientRelationshipId",
    "periodStart",
    "periodEnd",
    "asAt",
  ],
  async run(scope: ResolvedScope) {
    const obligations = await prisma.obligation.findMany({
      where: {
        ...scope.where,
        archivedAt: null,
        ...(scope.filters.clientRelationshipId
          ? { clientRelationshipId: scope.filters.clientRelationshipId }
          : {}),
      },
      select: {
        id: true,
        practiceId: true,
        periodKey: true,
        status: true,
        filedAt: true,
        originalStatutoryDate: true,
        currentStatutoryDate: true,
        clientRelationship: { select: { party: { select: { legalName: true } } } },
        rule: { select: { code: true, service: true } },
      },
    });

    // §40's second evidence sentence: the date in force AT THE REPORT'S
    // as-at moment, not the date as it stands today. An extension granted
    // last week does not retrospectively rescue a filing that was late when
    // a report was published a month ago.
    const effectiveDates = await statutoryDateAsAt(obligations, scope.asAt);

    // The period filter is applied to the EFFECTIVE date, not the stored
    // current one — otherwise an extension silently moves an obligation into
    // or out of a historical report's population.
    const { periodStart, periodEnd } = scope.filters;
    const inPeriod = obligations.filter((o) => {
      const due = effectiveDates.get(o.id) ?? o.originalStatutoryDate;
      if (periodStart && due < periodStart) return false;
      if (periodEnd && due > periodEnd) return false;
      return true;
    });

    // "Applicable" is the denominator's own word. Not applicable and
    // cancelled obligations were never owed and are not failures.
    const applicable = inPeriod.filter(
      (o) => o.status !== "NOT_APPLICABLE" && o.status !== "CANCELLED",
    );

    // "Show unknown / disputed cases separately." An obligation still awaiting
    // acknowledgement is not yet a filing; one rejected by the portal is
    // disputed; one whose category could not be determined is unknown. None of
    // them is a success, and none is honestly a failure either.
    const UNRESOLVED = new Set(["SUBMITTED_AWAITING_ACK", "REJECTED", "REVIEW_REQUIRED"]);
    const unresolved = applicable.filter((o) => UNRESOLVED.has(o.status));
    const resolved = applicable.filter((o) => !UNRESOLVED.has(o.status));

    const onTime = resolved.filter((o) => {
      if (o.status !== "FILED" || !o.filedAt) return false;
      const due = effectiveDates.get(o.id) ?? o.originalStatutoryDate;
      // Date-only comparison: a return filed at 23:00 on the due date is on
      // time, and comparing an instant to a midnight date would call it late.
      return o.filedAt.toISOString().slice(0, 10) <= due.toISOString().slice(0, 10);
    });

    const rows: ReportRow[] = resolved.concat(unresolved).map((o) => {
      const due = effectiveDates.get(o.id) ?? o.originalStatutoryDate;
      return {
        recordType: "Obligation",
        recordId: o.id,
        practiceId: o.practiceId,
        label: `${o.rule.code} — ${o.periodKey}`,
        cells: {
          Client: o.clientRelationship.party.legalName,
          Rule: o.rule.code,
          Service: o.rule.service ?? "",
          Period: o.periodKey,
          "Original due": iso(o.originalStatutoryDate),
          "Due (as at report)": iso(due),
          "Due (today)": iso(o.currentStatutoryDate),
          Status: o.status,
          Filed: iso(o.filedAt),
          Outcome: UNRESOLVED.has(o.status)
            ? "Unknown or disputed"
            : o.status === "FILED" && o.filedAt &&
                o.filedAt.toISOString().slice(0, 10) <= due.toISOString().slice(0, 10)
              ? "On time"
              : "Not on time",
        },
      };
    });

    return {
      refreshedAt: new Date(),
      recordCount: rows.length,
      scope: {
        practiceIds: scope.practiceIds,
        periodStart: periodStart ?? null,
        periodEnd: periodEnd ?? null,
        asAt: scope.asAt,
        statusBasis:
          "Filed with a recorded filing date on or before the due date in force " +
          "at the as-at moment. Not applicable and cancelled obligations are " +
          "outside the population; submitted-awaiting-acknowledgement, rejected " +
          "and review-required cases are reported separately.",
      },
      measures: [
        ratio(
          "On time filing rate",
          onTime.length,
          resolved.length,
          "No applicable obligations with a resolved status fell due in this period.",
        ),
        { label: "Applicable obligations due", value: applicable.length, unit: "count" },
        { label: "Filed on time", value: onTime.length, unit: "count" },
      ],
      rows,
      excluded: {
        label: "Unknown or disputed cases, excluded from the ratio",
        count: unresolved.length,
        recordIds: unresolved.map((o) => o.id),
      },
    };
  },
});

// =================================================== work and review ageing

registerReport({
  id: "work-review-ageing",
  title: "Work and review ageing",
  formula:
    "Elapsed days in the job's current state, measured from the transition " +
    "into it. Time waiting on the client and time waiting internally are " +
    "measured and reported separately, never summed into one ageing figure.",
  requires: "job.read",
  supportedFilters: ["practiceId", "ownerUserId", "clientRelationshipId", "asAt"],
  async run(scope: ResolvedScope) {
    const jobs = await prisma.job.findMany({
      where: {
        ...scope.where,
        archivedAt: null,
        state: { notIn: ["COMPLETED", "CANCELLED"] },
        ...(scope.filters.ownerUserId ? { ownerUserId: scope.filters.ownerUserId } : {}),
        ...(scope.filters.clientRelationshipId
          ? { engagement: { clientRelationshipId: scope.filters.clientRelationshipId } }
          : {}),
      },
      select: {
        id: true,
        practiceId: true,
        title: true,
        state: true,
        createdAt: true,
        ownerUserId: true,
        engagement: {
          select: { clientRelationship: { select: { party: { select: { legalName: true } } } } },
        },
      },
    });

    // One query for every transition, then grouped in memory: a per-job query
    // here is what turns a 300-job register into 300 round trips.
    const transitions = await prisma.workStateTransition.findMany({
      where: { subjectType: "JOB", subjectId: { in: jobs.map((j) => j.id) } },
      orderBy: { createdAt: "asc" },
      select: { subjectId: true, toState: true, createdAt: true },
    });

    const byJob = new Map<string, { toState: string; createdAt: Date }[]>();
    for (const t of transitions) {
      const list = byJob.get(t.subjectId) ?? [];
      list.push({ toState: t.toState, createdAt: t.createdAt });
      byJob.set(t.subjectId, list);
    }

    let clientWaitingTotal = 0;
    let clientWaitingCount = 0;
    let internalWaitingTotal = 0;
    let internalWaitingCount = 0;
    let inStateTotal = 0;

    const rows: ReportRow[] = jobs.map((job) => {
      const history = byJob.get(job.id) ?? [];
      // The moment it entered the state it is in now. With no transition
      // logged, the job has never moved, so its creation is that moment.
      const enteredCurrent =
        [...history].reverse().find((t) => t.toState === job.state)?.createdAt ?? job.createdAt;
      const ageDays = daysBetween(enteredCurrent, scope.asAt);
      inStateTotal += ageDays;

      const isClientWait = job.state === "WAITING_FOR_CLIENT";
      const isInternalWait = job.state === "WAITING_INTERNALLY";
      if (isClientWait) {
        clientWaitingTotal += ageDays;
        clientWaitingCount += 1;
      }
      if (isInternalWait) {
        internalWaitingTotal += ageDays;
        internalWaitingCount += 1;
      }

      return {
        recordType: "Job",
        recordId: job.id,
        practiceId: job.practiceId,
        label: job.title,
        cells: {
          Job: job.title,
          Client: job.engagement.clientRelationship.party.legalName,
          State: job.state,
          "Entered state": iso(enteredCurrent),
          "Days in state": ageDays.toFixed(1),
          "Waiting on": isClientWait ? "Client" : isInternalWait ? "Internal" : "",
        },
      };
    });

    return {
      refreshedAt: new Date(),
      recordCount: rows.length,
      scope: {
        practiceIds: scope.practiceIds,
        periodStart: null,
        periodEnd: null,
        asAt: scope.asAt,
        statusBasis:
          "Open jobs only — completed and cancelled work is excluded. Age is " +
          "measured from the transition into the current state, or from " +
          "creation where the job has never moved.",
      },
      measures: [
        {
          label: "Open jobs",
          value: jobs.length,
          unit: "count",
        },
        ratio(
          "Mean days in current state",
          inStateTotal,
          jobs.length,
          "No open jobs are in scope.",
        ),
        ratio(
          "Mean days waiting on the client",
          clientWaitingTotal,
          clientWaitingCount,
          "No job is currently waiting on a client.",
        ),
        ratio(
          "Mean days waiting internally",
          internalWaitingTotal,
          internalWaitingCount,
          "No job is currently waiting internally.",
        ),
      ],
      rows,
    };
  },
});

// ==================================================== document completeness

registerReport({
  id: "document-completeness",
  title: "Document completeness",
  formula:
    "Requested items ACCEPTED ÷ requested items that are applicable (waived " +
    "and not-available items are outside the population). Items received but " +
    "not yet accepted are reported as a separate measure and are not counted " +
    "as complete.",
  requires: "client.read",
  supportedFilters: ["practiceId", "clientRelationshipId", "asAt"],
  async run(scope: ResolvedScope) {
    const items = await prisma.clientRequestItem.findMany({
      where: {
        ...scope.where,
        ...(scope.filters.clientRelationshipId
          ? { request: { clientRelationshipId: scope.filters.clientRelationshipId } }
          : {}),
      },
      select: {
        id: true,
        practiceId: true,
        documentType: true,
        periodLabel: true,
        dueDate: true,
        state: true,
        stateChangedAt: true,
        request: {
          select: {
            title: true,
            clientRelationship: { select: { party: { select: { legalName: true } } } },
          },
        },
      },
    });

    // Waived and not-available are decisions, not gaps: counting them as
    // incomplete would make a request nobody can ever satisfy look like a
    // failure of the people chasing it.
    const applicable = items.filter((i) => i.state !== "WAIVED" && i.state !== "NOT_AVAILABLE");
    const accepted = applicable.filter((i) => i.state === "ACCEPTED");
    // "Received alone is a separate measure" — a file that has arrived but
    // has not been looked at is not completeness, and treating it as such is
    // how a preparation start date slips.
    const received = applicable.filter((i) => i.state === "SUBMITTED");

    const rows: ReportRow[] = items.map((i) => ({
      recordType: "ClientRequestItem",
      recordId: i.id,
      practiceId: i.practiceId,
      label: i.documentType,
      cells: {
        Client: i.request.clientRelationship.party.legalName,
        Request: i.request.title,
        Item: i.documentType,
        Period: i.periodLabel ?? "",
        Due: iso(i.dueDate),
        State: i.state,
        "State changed": iso(i.stateChangedAt),
      },
    }));

    return {
      refreshedAt: new Date(),
      recordCount: rows.length,
      scope: {
        practiceIds: scope.practiceIds,
        periodStart: null,
        periodEnd: null,
        asAt: scope.asAt,
        statusBasis:
          "Accepted items only count as complete. Waived and not-available " +
          "items are outside the population; submitted-but-unaccepted items " +
          "are counted separately.",
      },
      measures: [
        ratio(
          "Document completeness",
          accepted.length,
          applicable.length,
          "No applicable requested items are in scope.",
        ),
        { label: "Applicable items requested", value: applicable.length, unit: "count" },
        { label: "Received but not yet accepted", value: received.length, unit: "count" },
      ],
      rows,
    };
  },
});

// ======================================================= receivables ageing

const AGEING_BUCKETS = [
  { label: "Not yet due", min: Number.NEGATIVE_INFINITY, max: 0 },
  { label: "1-30 days", min: 0, max: 30 },
  { label: "31-60 days", min: 30, max: 60 },
  { label: "61-90 days", min: 60, max: 90 },
  { label: "Over 90 days", min: 90, max: Number.POSITIVE_INFINITY },
];

registerReport({
  id: "receivables-ageing",
  title: "Receivables ageing",
  formula:
    "Issued invoice amount less approved receipts, tax deducted at source, " +
    "amounts written off and credit notes, aged in days from the invoice due " +
    "date. Reversed allocations and their reversals are both ignored, in " +
    "equal measure, so a corrected allocation nets to nothing.",
  requires: "invoice.read",
  supportedFilters: ["practiceId", "clientRelationshipId", "periodStart", "periodEnd", "asAt"],
  async run(scope: ResolvedScope) {
    const invoices = await prisma.invoice.findMany({
      where: {
        ...scope.where,
        // Only issued invoices are receivable. A draft is not owed by anyone,
        // and including one would inflate the ledger with an internal document.
        // PAID and CREDITED are settled, so nothing is receivable; DRAFT and
        // APPROVED are not yet owed by anyone. The enum has no OVERDUE or
        // DISPUTED member — overdue is derived from the due date here, and a
        // dispute is an R1 collections concept (FIN05).
        status: { in: ["ISSUED", "PART_PAID"] },
        ...(scope.filters.clientRelationshipId
          ? { clientRelationshipId: scope.filters.clientRelationshipId }
          : {}),
        ...(scope.filters.periodStart || scope.filters.periodEnd
          ? {
              issueDate: {
                ...(scope.filters.periodStart ? { gte: scope.filters.periodStart } : {}),
                ...(scope.filters.periodEnd ? { lte: scope.filters.periodEnd } : {}),
              },
            }
          : {}),
      },
      select: {
        id: true,
        practiceId: true,
        displayNumber: true,
        total: true,
        currency: true,
        issueDate: true,
        dueDate: true,
        status: true,
        clientRelationship: { select: { party: { select: { legalName: true } } } },
        allocations: {
          where: { reversedAt: null, reversalOfId: null },
          select: { kind: true, amount: true },
        },
      },
    });

    const bucketTotals = new Map<string, Prisma.Decimal>(
      AGEING_BUCKETS.map((b) => [b.label, new Prisma.Decimal(0)]),
    );
    let outstandingTotal = new Prisma.Decimal(0);
    let weightedAgeDays = 0;

    const rows: ReportRow[] = invoices.map((invoice) => {
      // Every settlement kind is subtracted, but they are NOT summed into one
      // "received" figure anywhere a reader can see: FIN04's whole point is
      // that ₹90 cash and ₹10 TDS are not ₹100 received, because the ₹10 is
      // recoverable against a certificate.
      let cash = new Prisma.Decimal(0);
      let tds = new Prisma.Decimal(0);
      let written = new Prisma.Decimal(0);
      let credited = new Prisma.Decimal(0);
      let refunded = new Prisma.Decimal(0);

      for (const a of invoice.allocations) {
        if (a.kind === "PAYMENT" || a.kind === "ADVANCE") cash = cash.plus(a.amount);
        else if (a.kind === "TDS") tds = tds.plus(a.amount);
        else if (a.kind === "WRITE_OFF") written = written.plus(a.amount);
        else if (a.kind === "CREDIT_NOTE") credited = credited.plus(a.amount);
        else if (a.kind === "REFUND") refunded = refunded.plus(a.amount);
      }

      const outstanding = new Prisma.Decimal(invoice.total)
        .minus(cash)
        .minus(tds)
        .minus(written)
        .minus(credited)
        .plus(refunded);

      const agedFrom = invoice.dueDate ?? invoice.issueDate;
      const ageDays = agedFrom ? daysBetween(agedFrom, scope.asAt) : 0;
      const bucket =
        AGEING_BUCKETS.find((b) => ageDays > b.min && ageDays <= b.max) ?? AGEING_BUCKETS[0];

      bucketTotals.set(bucket.label, (bucketTotals.get(bucket.label) ?? new Prisma.Decimal(0)).plus(outstanding));
      outstandingTotal = outstandingTotal.plus(outstanding);
      weightedAgeDays += Math.max(ageDays, 0) * Number(outstanding);

      return {
        recordType: "Invoice",
        recordId: invoice.id,
        practiceId: invoice.practiceId,
        label: invoice.displayNumber ?? invoice.id,
        cells: {
          Invoice: invoice.displayNumber ?? "",
          Client: invoice.clientRelationship.party.legalName,
          Currency: invoice.currency,
          Total: new Prisma.Decimal(invoice.total).toFixed(2),
          "Cash received": cash.toFixed(2),
          "Tax deducted": tds.toFixed(2),
          "Written off": written.toFixed(2),
          Credited: credited.toFixed(2),
          Refunded: refunded.toFixed(2),
          Outstanding: outstanding.toFixed(2),
          Due: iso(invoice.dueDate ?? invoice.issueDate),
          "Days overdue": ageDays > 0 ? ageDays.toFixed(0) : "0",
          Bucket: bucket.label,
        },
      };
    });

    return {
      refreshedAt: new Date(),
      recordCount: rows.length,
      scope: {
        practiceIds: scope.practiceIds,
        periodStart: scope.filters.periodStart ?? null,
        periodEnd: scope.filters.periodEnd ?? null,
        asAt: scope.asAt,
        statusBasis:
          "Issued and part paid invoices. Drafts, approved-but-unissued, " +
          "cancelled, credited and fully paid invoices are outside the " +
          "population. Overdue is derived from the due date rather than stored, " +
          "and disputes are R1 (FIN05). Reversed allocations and their " +
          "reversals are both excluded.",
      },
      measures: [
        { label: "Invoices outstanding", value: rows.length, unit: "count" },
        {
          label: "Total outstanding",
          value: Number(outstandingTotal.toFixed(2)),
          unit: "currency",
        },
        ...AGEING_BUCKETS.map((b) => ({
          label: `Outstanding — ${b.label}`,
          value: Number((bucketTotals.get(b.label) ?? new Prisma.Decimal(0)).toFixed(2)),
          unit: "currency" as const,
        })),
        ratio(
          "Weighted average days overdue",
          weightedAgeDays,
          Number(outstandingTotal),
          "Nothing is outstanding, so there is no balance to weight an age against.",
        ),
      ],
      rows,
    };
  },
});
