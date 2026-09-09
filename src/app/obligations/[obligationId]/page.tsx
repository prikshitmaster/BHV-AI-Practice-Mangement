import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { screenContext } from "@/lib/screen-context";
import { EmptyState, PermissionState, Screen } from "@/components/states";

export const dynamic = "force-dynamic";

/**
 * ObligationChange records the whole before/after as JSON rather than two date
 * columns, so the statutory date is read out of it by name. A change that did
 * not touch that field says so instead of rendering an empty cell that reads
 * like "no date".
 */
function statutoryDateIn(meta: unknown): string {
  if (meta && typeof meta === "object" && "currentStatutoryDate" in meta) {
    const value = (meta as Record<string, unknown>).currentStatutoryDate;
    if (typeof value === "string") return value.slice(0, 10);
  }
  return "Not a date change";
}

/**
 * Obligation detail — the destination behind a calendar row and behind a
 * filing-reference search hit (the acknowledgement number a client quotes on
 * the phone). Until now both 404'd.
 *
 * DUE02 is the reason this screen is laid out the way it is: the dates are
 * shown SEPARATELY and labelled by what they are, because collapsing them is
 * how an internal target quietly becomes the date people believe is statutory.
 * The original statutory date stays on screen next to the current one even
 * after an extension, so an extension reads as an extension rather than as the
 * date having always been that.
 *
 * DUE04: an obligation in REVIEW_REQUIRED says so at the top and says what is
 * unknown. It is never given a date it cannot justify, and it is not quietly
 * dismissible from here.
 */
export default async function ObligationDetailPage({
  params,
}: {
  params: Promise<{ obligationId: string }>;
}) {
  const scope = await screenContext("job.read");
  const { obligationId } = await params;

  if (scope.state === "signed-out") {
    return (
      <Screen title="Obligation">
        <EmptyState title="Sign in to see this obligation" />
      </Screen>
    );
  }
  if (scope.state === "no-practice" || scope.state === "denied") {
    return (
      <Screen title="Obligation">
        <PermissionState />
      </Screen>
    );
  }

  const { practiceId } = scope;

  const obligation = await prisma.obligation.findFirst({
    where: { id: obligationId, practiceId, archivedAt: null },
    select: {
      id: true,
      periodKey: true,
      status: true,
      originalStatutoryDate: true,
      currentStatutoryDate: true,
      internalTargetDate: true,
      reviewTargetDate: true,
      clientDocumentCutoff: true,
      paymentDeadline: true,
      governingLaw: true,
      assessmentYear: true,
      taxYear: true,
      taxpayerCategory: true,
      formVersion: true,
      filedAt: true,
      rule: { select: { code: true, version: true, service: true, authoritativeSource: true } },
      clientRelationship: {
        select: { id: true, party: { select: { legalName: true } } },
      },
      changes: {
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          reason: true,
          beforeMeta: true,
          afterMeta: true,
          changedByName: true,
          sourceReference: true,
          createdAt: true,
        },
      },
      filingEvidence: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          acknowledgementReference: true,
          filedAt: true,
          reviewerName: true,
          reviewerConfirmedAt: true,
        },
      },
    },
  });

  if (!obligation) {
    return (
      <Screen
        title="Obligation"
        breadcrumbs={[
          { href: "/", label: "Home" },
          { href: "/calendar", label: "Calendar" },
        ]}
      >
        <PermissionState />
      </Screen>
    );
  }

  const readable = (value: string) => value.replace(/_/g, " ").toLowerCase();
  const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "Not set");
  const extended =
    obligation.currentStatutoryDate.getTime() !== obligation.originalStatutoryDate.getTime();

  return (
    <Screen
      title={`${obligation.rule.service ?? obligation.rule.code} · ${obligation.periodKey}`}
      lede={obligation.clientRelationship.party.legalName}
      breadcrumbs={[
        { href: "/", label: "Home" },
        { href: "/calendar", label: "Calendar" },
        {
          href: `/clients/${obligation.clientRelationship.id}`,
          label: obligation.clientRelationship.party.legalName,
        },
      ]}
    >
      {obligation.status === "REVIEW_REQUIRED" ? (
        <div className="banner banner--warning" role="status">
          <span aria-hidden="true">!</span>
          <span>
            <strong>This obligation needs review before a date can be relied on.</strong>
            <p style={{ marginBottom: 0 }}>
              {[
                obligation.taxpayerCategory ? null : "the taxpayer category is not determined",
                obligation.formVersion ? null : "the form version is not recorded",
              ]
                .filter(Boolean)
                .join(" and ") || "Particulars are incomplete."}
              . It stays visible here until that is resolved — it cannot be part-resolved or
              dismissed.
            </p>
          </span>
        </div>
      ) : null}

      <h2>Dates</h2>
      <div className="card">
        <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 16px" }}>
          <dt className="secondary">Statutory date (current)</dt>
          <dd style={{ margin: 0 }}>
            {iso(obligation.currentStatutoryDate)}
            {extended ? <span className="status status--info"> Extended</span> : null}
          </dd>
          {/* DUE02: the original is kept on screen, not overwritten by the
              extension. An extension must read as an extension. */}
          <dt className="secondary">Statutory date (original)</dt>
          <dd style={{ margin: 0 }}>{iso(obligation.originalStatutoryDate)}</dd>
          <dt className="secondary">Internal target</dt>
          <dd style={{ margin: 0 }}>{iso(obligation.internalTargetDate)}</dd>
          <dt className="secondary">Review target</dt>
          <dd style={{ margin: 0 }}>{iso(obligation.reviewTargetDate)}</dd>
          <dt className="secondary">Client document cutoff</dt>
          <dd style={{ margin: 0 }}>{iso(obligation.clientDocumentCutoff)}</dd>
          <dt className="secondary">Payment deadline</dt>
          <dd style={{ margin: 0 }}>{iso(obligation.paymentDeadline)}</dd>
        </dl>
        <p className="muted" style={{ marginBottom: 0 }}>
          These are six different dates on purpose. Only the statutory date is fixed by law; the
          others are the firm&rsquo;s own planning and are not a defence if missed.
        </p>
      </div>

      <h2>Particulars</h2>
      <div className="card">
        <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 16px" }}>
          <dt className="secondary">Status</dt>
          <dd style={{ margin: 0 }}>
            <span
              className={`status status--${
                obligation.status === "FILED"
                  ? "ok"
                  : obligation.status === "OVERDUE"
                    ? "warn"
                    : "info"
              }`}
            >
              {readable(obligation.status)}
            </span>
          </dd>
          <dt className="secondary">Governing law</dt>
          <dd style={{ margin: 0 }}>
            {obligation.governingLaw ? readable(obligation.governingLaw) : "Not determined"}
          </dd>
          {/* Law, assessment year and tax year are stored and shown
              independently, so a filing date can never select the Act. */}
          <dt className="secondary">Assessment year</dt>
          <dd style={{ margin: 0 }}>{obligation.assessmentYear ?? "Not applicable"}</dd>
          <dt className="secondary">Tax year</dt>
          <dd style={{ margin: 0 }}>{obligation.taxYear ?? "Not applicable"}</dd>
          <dt className="secondary">Taxpayer category</dt>
          <dd style={{ margin: 0 }}>
            {obligation.taxpayerCategory ? readable(obligation.taxpayerCategory) : "Not determined"}
          </dd>
          <dt className="secondary">Form version</dt>
          <dd style={{ margin: 0 }}>{obligation.formVersion ?? "Not recorded"}</dd>
          <dt className="secondary">Rule</dt>
          <dd style={{ margin: 0 }}>
            {obligation.rule.code} v{obligation.rule.version}
            {obligation.rule.authoritativeSource ? (
              <span className="muted"> · {obligation.rule.authoritativeSource}</span>
            ) : null}
          </dd>
        </dl>
      </div>

      <h2>Date changes</h2>
      {obligation.changes.length === 0 ? (
        <EmptyState
          title="No date has been changed"
          body="The statutory date is as it was when this obligation was created."
        />
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <caption>
              Every change to a date on this obligation, with what authorised it. Appended to,
              never edited.
            </caption>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">From</th>
                <th scope="col">To</th>
                <th scope="col">Changed by</th>
                <th scope="col">Reason</th>
                <th scope="col">Authority</th>
              </tr>
            </thead>
            <tbody>
              {obligation.changes.map((c) => (
                <tr key={c.id}>
                  <th scope="row">{c.createdAt.toISOString().slice(0, 10)}</th>
                  <td>{statutoryDateIn(c.beforeMeta)}</td>
                  <td>{statutoryDateIn(c.afterMeta)}</td>
                  <td>{c.changedByName}</td>
                  <td>{c.reason}</td>
                  {/* DUE03: the notification that authorised an extension is
                      part of the record, not a note someone remembers. */}
                  <td>{c.sourceReference ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Filing evidence</h2>
      {obligation.filingEvidence.length === 0 ? (
        <EmptyState
          title="Nothing has been filed against this obligation"
          body="A filing is recorded here with its acknowledgement reference once it is submitted and acknowledged."
        />
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <caption>Filings recorded against this obligation.</caption>
            <thead>
              <tr>
                <th scope="col">Reference</th>
                <th scope="col">Filed</th>
                <th scope="col">Confirmed by</th>
              </tr>
            </thead>
            <tbody>
              {obligation.filingEvidence.map((e) => (
                <tr key={e.id}>
                  <th scope="row">{e.acknowledgementReference}</th>
                  <td>{iso(e.filedAt)}</td>
                  <td>
                    {e.reviewerName}
                    <span className="muted">
                      {" "}
                      · {e.reviewerConfirmedAt.toISOString().slice(0, 10)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ marginTop: 24 }}>
        <Link href="/calendar">Back to Calendar</Link>
      </p>
    </Screen>
  );
}
