import Link from "next/link";
import { screenContext } from "@/lib/screen-context";
import { EmptyState, ErrorState, PermissionState, Screen } from "@/components/states";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { listIncidents, type IncidentClock } from "@/lib/incidents";
import { listProcessingActivities, listRegulatoryRequirements } from "@/lib/privacy-register";
import { ictLogPosture } from "@/lib/retention";
import { listErasureRequests } from "@/lib/erasure";
import {
  ActionErasureButton,
  AssessCertInForm,
  CorrectAwarenessForm,
  ErasureRequestForm,
  ErasureReviewForm,
  RecordReportForm,
  ReportIncidentForm,
  RootCauseForm,
} from "@/components/privacy-actions";

export const dynamic = "force-dynamic";

/**
 * Privacy, retention and incidents — PRV01, PRV02, PRV04, PRV06 (PRD §36).
 *
 * Reporting an incident is open to every member (the clocks run from
 * awareness, so a report must not wait for a partner). Everything else —
 * the incident record, the registers, retention and erasure review — needs
 * incident.manage or privacy.manage, checked here AND in every library call.
 *
 * The incident table is the PRV04 acceptance screen: awareness time, then one
 * row per independent clock, each stated in words, with root cause shown
 * alongside but feeding none of them.
 */

const when = (d: Date | null | undefined) =>
  d ? `${d.toISOString().slice(0, 16).replace("T", " ")} UTC` : "—";
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "—");

const CLOCK_LABEL: Record<IncidentClock["state"], { text: string; cls: string }> = {
  RUNNING: { text: "Running", cls: "status status--warn" },
  RUNNING_ASSESSMENT_PENDING: { text: "Running — assessment pending", cls: "status status--warn" },
  OVERDUE: { text: "Overdue", cls: "status status--overdue" },
  MET: { text: "Reported in time", cls: "status status--ok" },
  LATE: { text: "Reported late", cls: "status status--overdue" },
  NOT_APPLICABLE: { text: "Not applicable", cls: "status status--info" },
  NOT_OPERATIVE: { text: "Not operative yet", cls: "status status--info" },
  NOT_TRACKED: { text: "Unknown — not in register", cls: "status status--warn" },
  WITHOUT_DELAY: { text: "Due without delay", cls: "status status--overdue" },
};

export default async function PrivacyPage() {
  const scope = await screenContext();
  if (scope.state === "signed-out") {
    return (
      <Screen title="Privacy and incidents">
        <EmptyState title="Sign in to report an incident or manage privacy records" />
      </Screen>
    );
  }
  if (scope.state === "no-practice" || scope.state === "denied") {
    return (
      <Screen title="Privacy and incidents">
        <PermissionState />
      </Screen>
    );
  }

  const { ctx, practiceId } = scope;
  const membership = ctx.membership!;
  const canReport = can(membership, "incident.report");
  const canManageIncidents = can(membership, "incident.manage");
  const canManagePrivacy = can(membership, "privacy.manage");
  const practiceName = ctx.activePractice!.name;

  if (!canReport && !canManageIncidents && !canManagePrivacy) {
    return (
      <Screen title="Privacy and incidents">
        <PermissionState />
      </Screen>
    );
  }

  // Each section loads on its own, so one failure does not blank the others.
  async function load<T>(fn: () => Promise<T>): Promise<{ data: T | null; error: string | null }> {
    try {
      return { data: await fn(), error: null };
    } catch (e) {
      return { data: null, error: e instanceof Error ? e.message : String(e) };
    }
  }

  const incidents = canManageIncidents ? await load(() => listIncidents(ctx.userId, practiceId)) : null;
  const register = canManagePrivacy ? await load(() => listProcessingActivities(ctx.userId, practiceId)) : null;
  const regulatory = canManagePrivacy ? await load(() => listRegulatoryRequirements(ctx.userId, practiceId)) : null;
  const posture = canManagePrivacy ? await load(() => ictLogPosture(practiceId)) : null;
  const policies = canManagePrivacy
    ? await load(() =>
        prisma.retentionPolicy.findMany({
          where: { practiceId },
          orderBy: [{ recordClass: "asc" }, { direction: "asc" }],
        }),
      )
    : null;
  const erasures = canManagePrivacy ? await load(() => listErasureRequests(ctx.userId, practiceId)) : null;
  const engagements = canManagePrivacy
    ? await prisma.engagement.findMany({
        where: { practiceId, archivedAt: null },
        select: { id: true, serviceCode: true, periodStart: true, clientRelationship: { select: { party: { select: { legalName: true } } } } },
        orderBy: { createdAt: "desc" },
        take: 200,
      })
    : [];
  const contacts = canManagePrivacy
    ? await prisma.contactAuthority.findMany({
        where: { practiceId, revokedAt: null },
        select: { contact: { select: { id: true, fullName: true } } },
        distinct: ["contactId"],
        take: 200,
      })
    : [];

  return (
    <Screen
      title="Privacy and incidents"
      lede={`Incident reporting clocks, the processing and regulatory registers, retention schedules and erasure review for ${practiceName}.`}
      breadcrumbs={[{ href: "/practice", label: "Practice" }]}
    >
      {/* --------------------------------------------------- incidents */}
      <section aria-labelledby="inc-h">
        <h2 id="inc-h">Incidents</h2>
        {canReport ? (
          <details open={!canManageIncidents}>
            <summary>Report a suspected incident</summary>
            <p className="muted">
              Report as soon as you are aware — reporting clocks start from awareness, not from when the cause is found.
            </p>
            <ReportIncidentForm practiceId={practiceId} />
          </details>
        ) : null}

        {!canManageIncidents ? (
          <p className="muted">Reports go to the partners and IT administrators who manage incidents.</p>
        ) : incidents!.error ? (
          <ErrorState title="Incidents could not be loaded" detail={incidents!.error} />
        ) : incidents!.data!.length === 0 ? (
          <EmptyState title="No incidents recorded for this practice" />
        ) : (
          incidents!.data!.map((inc) => (
            <article key={inc.id} className="card" style={{ marginTop: 16 }} aria-labelledby={`inc-${inc.id}`}>
              <h3 id={`inc-${inc.id}`} style={{ marginTop: 0 }}>
                {inc.title}{" "}
                <span className="status status--info">{inc.track === "SECURITY" ? "Security" : "Routine support"}</span>
              </h3>
              <dl className="definition-list">
                <dt>Aware since</dt>
                <dd><strong>{when(inc.awarenessAt)}</strong> (recorded {when(inc.recordedAt)} by {inc.reportedByName})</dd>
                <dt>Root cause</dt>
                <dd>
                  {inc.rootCause === "UNKNOWN" ? "Unknown" : inc.rootCause === "INVESTIGATING" ? "Investigating" : "Identified"}
                  {inc.rootCauseNote ? ` — ${inc.rootCauseNote}` : ""}
                  <span className="muted"> (does not affect any clock)</span>
                </dd>
                {inc.track === "SECURITY" ? (
                  <>
                    <dt>CERT-In assessment</dt>
                    <dd>
                      {inc.certInAssessment === "PENDING"
                        ? "Pending"
                        : inc.certInAssessment === "APPLICABLE"
                          ? `Applicable — ${inc.certInCategory}`
                          : "Not applicable"}
                      {inc.certInReason ? ` (${inc.certInReason}${inc.assessedByName ? `, ${inc.assessedByName}` : ""})` : ""}
                    </dd>
                  </>
                ) : null}
              </dl>
              {inc.clocks.length === 0 ? (
                <p className="muted">Routine support — no regulatory reporting clock applies.</p>
              ) : (
                <div className="table-scroll">
                  <table className="data-table">
                    <caption>Each clock is independent and runs from the awareness time.</caption>
                    <thead>
                      <tr>
                        <th scope="col">Reporting duty</th>
                        <th scope="col">State</th>
                        <th scope="col">Due</th>
                        <th scope="col">Reported</th>
                        <th scope="col">Why</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inc.clocks.map((c) => (
                        <tr key={c.regime}>
                          <th scope="row">{c.label}</th>
                          <td><span className={CLOCK_LABEL[c.state].cls}>{CLOCK_LABEL[c.state].text}</span></td>
                          <td>{c.dueAt ? when(c.dueAt) : c.state === "WITHOUT_DELAY" ? "Without delay" : "—"}</td>
                          <td>{c.reportedAt ? `${when(c.reportedAt)} — ${c.reference}` : "—"}</td>
                          <td>{c.explanation}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {inc.track === "SECURITY" ? (
                <details style={{ marginTop: 12 }}>
                  <summary>Assess, record a report, or correct</summary>
                  <div className="stack">
                    {inc.certInAssessment === "PENDING" ? (
                      <>
                        <h4>CERT-In applicability</h4>
                        <AssessCertInForm incidentId={inc.id} version={inc.version} />
                      </>
                    ) : null}
                    <h4>Record a report made</h4>
                    <RecordReportForm
                      incidentId={inc.id}
                      regimes={inc.clocks
                        .filter((c) => !c.reportedAt && ["RUNNING", "RUNNING_ASSESSMENT_PENDING", "OVERDUE", "WITHOUT_DELAY"].includes(c.state))
                        .map((c) => ({ regime: c.regime, label: c.label }))}
                    />
                    <h4>Root cause</h4>
                    <RootCauseForm incidentId={inc.id} version={inc.version} current={inc.rootCause} />
                    <h4>Correct the awareness time</h4>
                    <CorrectAwarenessForm incidentId={inc.id} version={inc.version} />
                  </div>
                </details>
              ) : null}
            </article>
          ))
        )}
      </section>

      {!canManagePrivacy ? null : (
        <>
          {/* ---------------------------------------------- erasure */}
          <section aria-labelledby="er-h" style={{ marginTop: 32 }}>
            <h2 id="er-h">Erasure requests</h2>
            <p className="muted">
              Every item is decided separately, with a reason. Items under legal hold, inside a retention period, or
              forming audit evidence cannot be erased. The person who logs a request cannot review it.
            </p>
            {erasures!.error ? (
              <ErrorState title="Erasure requests could not be loaded" detail={erasures!.error} />
            ) : erasures!.data!.length === 0 ? (
              <EmptyState title="No erasure requests for this practice" />
            ) : (
              erasures!.data!.map((r) => (
                <article key={r.id} className="card" style={{ marginTop: 12 }}>
                  <h3 style={{ marginTop: 0 }}>
                    {r.engagement.serviceCode} — {r.state.replace("_", " ").toLowerCase()}
                  </h3>
                  <p className="muted">
                    Logged {when(r.requestedAt)} by {r.requestedByName} ({r.receivedVia}): “{r.requestText}”
                    {r.reviewedByName ? ` · reviewed by ${r.reviewedByName}` : ""}
                    {r.outcomeSummary ? ` · ${r.outcomeSummary}` : ""}
                  </p>
                  {r.state === "REQUESTED" ? (
                    r.requestedByUserId === ctx.userId ? (
                      <p className="muted">Waiting for review by another partner.</p>
                    ) : (
                      <ErasureReviewForm requestId={r.id} version={r.version} items={r.items} />
                    )
                  ) : (
                    <div className="table-scroll">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th scope="col">Item</th>
                            <th scope="col">Decision</th>
                            <th scope="col">Reason</th>
                            <th scope="col">Done</th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.items.map((i) => (
                            <tr key={i.id}>
                              <th scope="row">{i.label}</th>
                              <td>{i.decision === "ERASE" ? "Erase" : "Retain"}</td>
                              <td>{i.reason}</td>
                              <td>{i.actionedAt ? when(i.actionedAt) : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {r.state === "REVIEWED" && r.reviewedByUserId === ctx.userId ? (
                    <ActionErasureButton
                      requestId={r.id}
                      version={r.version}
                      eraseCount={r.items.filter((i) => i.decision === "ERASE").length}
                    />
                  ) : null}
                </article>
              ))
            )}
            {engagements.length ? (
              <details style={{ marginTop: 12 }}>
                <summary>Log an erasure request</summary>
                <ErasureRequestForm
                  practiceId={practiceId}
                  engagements={engagements.map((e) => ({
                    id: e.id,
                    label: `${e.clientRelationship.party.legalName} — ${e.serviceCode} (${day(e.periodStart)})`,
                  }))}
                  contacts={contacts.map((c) => ({ id: c.contact.id, label: c.contact.fullName }))}
                />
              </details>
            ) : null}
          </section>

          {/* ---------------------------------------------- retention */}
          <section aria-labelledby="ret-h" style={{ marginTop: 32 }}>
            <h2 id="ret-h">Retention schedules</h2>
            {posture!.data ? (
              <div className={posture!.data.meetsCertInMinimum ? "banner banner--info" : "banner banner--warning"} role="status">
                <p>
                  ICT logs: {posture!.data.meetsCertInMinimum ? `kept for at least ${posture!.data.floorDays} days` : "no 180-day minimum is configured"}.
                  The audit trail is append-only and never purged by this system. Hosting in Indian jurisdiction:{" "}
                  {posture!.data.hostingConfirmedIndia ? "confirmed" : "NOT confirmed"}
                  {posture!.data.hostingLocation ? ` (${posture!.data.hostingLocation})` : " (no ICT-log entry in the processing register)"}.
                </p>
              </div>
            ) : null}
            {policies!.error ? (
              <ErrorState title="Retention schedules could not be loaded" detail={policies!.error} />
            ) : policies!.data!.length === 0 ? (
              <EmptyState title="No retention schedules configured" body="Until one exists, nothing in this practice can be deleted." />
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <caption>
                    A minimum is never a purge timer: reaching it makes deletion allowed, not due. The longest applicable
                    minimum wins.
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Record class</th>
                      <th scope="col">Rule</th>
                      <th scope="col">Period</th>
                      <th scope="col">From</th>
                      <th scope="col">Covers</th>
                      <th scope="col">Governing rule</th>
                    </tr>
                  </thead>
                  <tbody>
                    {policies!.data!.map((p) => (
                      <tr key={p.id}>
                        <th scope="row">{p.recordClass}</th>
                        <td>{p.direction === "RETAIN_AT_LEAST" ? "Keep at least" : "Delete after"}{p.regulatoryRequirementId ? " (while its requirement is operative)" : ""}</td>
                        <td>{p.retainDays !== null ? `${p.retainDays} days` : `${p.retainYears} years`} from {p.trigger.replaceAll("_", " ").toLowerCase()}</td>
                        <td>{day(p.effectiveFrom)}</td>
                        <td>{p.covers.join(", ").toLowerCase()}</td>
                        <td>{p.basis}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ---------------------------------------------- registers */}
          <section aria-labelledby="reg-h" style={{ marginTop: 32 }}>
            <h2 id="reg-h">Processing register</h2>
            {register!.error ? (
              <ErrorState title="The processing register could not be loaded" detail={register!.error} />
            ) : register!.data!.length === 0 ? (
              <EmptyState title="No processing purposes recorded for this practice" />
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <caption>Consent is recorded only where it is the actual basis; most professional records rest on a legal or professional duty.</caption>
                  <thead>
                    <tr>
                      <th scope="col">Purpose</th>
                      <th scope="col">Data</th>
                      <th scope="col">Basis and authority</th>
                      <th scope="col">Recipients</th>
                      <th scope="col">Hosting</th>
                      <th scope="col">Retention</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {register!.data!.map((a) => (
                      <tr key={a.id}>
                        <th scope="row">{a.name}<div className="muted">{a.purpose}</div></th>
                        <td>{a.dataCategories.join(", ")}<div className="muted">from {a.source}</div></td>
                        <td>{a.legalBasis.replaceAll("_", " ").toLowerCase()} — {a.legalAuthority}</td>
                        <td>{a.recipients.join(", ") || "—"}{a.vendor ? <div className="muted">vendor: {a.vendor}</div> : null}</td>
                        <td>{a.hostingLocation}</td>
                        <td>{a.retentionClass}</td>
                        <td>{a.status.toLowerCase()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <h2 style={{ marginTop: 24 }}>Regulatory register</h2>
            <p className="muted">
              Legal state is recorded from a source, never assumed. A requirement is Operational only from a known effective
              date that has arrived; the history of every change is kept.
            </p>
            {regulatory!.error ? (
              <ErrorState title="The regulatory register could not be loaded" detail={regulatory!.error} />
            ) : regulatory!.data!.length === 0 ? (
              <EmptyState
                title="No regulatory requirements recorded"
                body="Incident clocks that depend on a requirement will show its status as unknown until it is recorded here."
              />
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Requirement</th>
                      <th scope="col">State</th>
                      <th scope="col">Effective</th>
                      <th scope="col">Source</th>
                      <th scope="col">History</th>
                    </tr>
                  </thead>
                  <tbody>
                    {regulatory!.data!.map((r) => (
                      <tr key={r.id}>
                        <th scope="row">{r.code}<div className="muted">{r.title} — {r.instrument}</div></th>
                        <td>{r.state.toLowerCase()}</td>
                        <td>{day(r.effectiveFrom)}</td>
                        <td>{r.sourceReference} ({day(r.sourceDate)})</td>
                        <td>{r.stateChanges.map((c) => `${c.toState.toLowerCase()} ${day(c.changedAt)}`).join(" → ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      <p className="muted" style={{ marginTop: 24 }}>
        This screen supports privacy readiness; it is not a DPDP or CERT-In compliance certificate. Confirm current
        obligations before relying on it. <Link href="/practice">Back to Practice</Link>
      </p>
    </Screen>
  );
}
