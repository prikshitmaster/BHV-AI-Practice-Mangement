import Link from "next/link";
import { screenContext } from "@/lib/screen-context";
import { EmptyState, ErrorState, PermissionState, Screen } from "@/components/states";
import { can } from "@/lib/permissions";
import {
  isSystemAdministrator,
  localFunctionAvailability,
  serviceStatusBoard,
  unreconciledDowntimeWork,
  type FunctionAvailability,
  type ServiceStatusView,
} from "@/lib/continuity";
import { recoveryOverview, type RecoveryOverview } from "@/lib/recovery-overview";
import {
  DowntimeForm,
  EmergencyExportForm,
  NoteAction,
  ProbeButton,
  ReportStatusForm,
  RunBackupButton,
  RunDrillForm,
} from "@/components/continuity-actions";

export const dynamic = "force-dynamic";

/**
 * Continuity and recovery — BCP04 for everyone, BCP01-03/06 for system
 * administrators (PRD §37).
 *
 * The status board is shown to every member on purpose. "Show degraded status"
 * is for the people whose work stops, not for IT alone; an outage only the
 * administrator can see is one the office discovers by failing. The board
 * names services and what still works — never a record.
 *
 * Every state is written in words as well as colour (UX03), and a status that
 * has gone stale is shown as unknown rather than as its last good value.
 */

const STATE_LABEL: Record<string, { text: string; cls: string }> = {
  OPERATIONAL: { text: "Operational", cls: "status status--ok" },
  DEGRADED: { text: "Degraded", cls: "status status--warn" },
  OFFLINE: { text: "Offline", cls: "status status--overdue" },
  UNKNOWN: { text: "Unknown", cls: "status status--info" },
};
const AVAIL_LABEL: Record<FunctionAvailability["availability"], { text: string; cls: string }> = {
  AVAILABLE: { text: "Available", cls: "status status--ok" },
  DEGRADED: { text: "Degraded", cls: "status status--warn" },
  UNAVAILABLE: { text: "Unavailable", cls: "status status--overdue" },
  UNCERTAIN: { text: "Not confirmed", cls: "status status--info" },
};

const when = (d: Date | null | undefined) =>
  d ? `${d.toISOString().slice(0, 16).replace("T", " ")} UTC` : "—";
const minutes = (s: number | null) => (s === null ? "Not measured" : s < 120 ? `${s} s` : `${Math.round(s / 60)} min`);

export default async function ContinuityPage() {
  const scope = await screenContext();

  if (scope.state === "signed-out") {
    return (
      <Screen title="Continuity">
        <EmptyState title="Sign in to see service status" />
      </Screen>
    );
  }
  if (scope.state === "no-practice" || scope.state === "denied") {
    return (
      <Screen title="Continuity">
        <PermissionState />
      </Screen>
    );
  }

  const { ctx, practiceId } = scope;
  const membership = ctx.membership!;
  const admin = await isSystemAdministrator(ctx.userId);

  // Each section loads independently, so a failure in one (say the drill
  // history) does not blank the status board people need during an outage.
  let board: ServiceStatusView[] | null = null;
  let boardError: string | null = null;
  try {
    board = await serviceStatusBoard();
  } catch (e) {
    boardError = e instanceof Error ? e.message : String(e);
  }

  const canReadWork = can(membership, "job.read");
  const canWriteWork = can(membership, "job.write");
  let downtime: Awaited<ReturnType<typeof unreconciledDowntimeWork>> | null = null;
  if (canReadWork) {
    try {
      downtime = await unreconciledDowntimeWork(ctx.userId, practiceId);
    } catch {
      downtime = null;
    }
  }

  let overview: RecoveryOverview | null = null;
  let overviewError: string | null = null;
  if (admin) {
    try {
      overview = await recoveryOverview();
    } catch (e) {
      overviewError = e instanceof Error ? e.message : String(e);
    }
  }

  const functions = board ? localFunctionAvailability(board) : [];

  return (
    <Screen
      title="Continuity"
      lede="Which services are working, what you can still do, and how to record work done while something was down."
      breadcrumbs={[{ href: "/", label: "Home" }]}
    >
      {/* ------------------------------------------------ service status */}
      <section aria-labelledby="status-h">
        <h2 id="status-h">Service status</h2>
        {boardError ? (
          <ErrorState
            title="Service status could not be read"
            body="If the database is down this page cannot load its records. Work from the latest emergency export and note work on paper for the downtime sheet."
            detail={boardError}
          />
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <caption>
                Measured services are checked by the system; reported ones are recorded by an administrator. A status
                not checked in the last 15 minutes is shown as unknown.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Service</th>
                  <th scope="col">State</th>
                  <th scope="col">Since</th>
                  <th scope="col">Last checked</th>
                  <th scope="col">How known</th>
                  <th scope="col">What still works</th>
                </tr>
              </thead>
              <tbody>
                {board!.map((s) => (
                  <tr key={s.service}>
                    <th scope="row">{s.service.replace("_", " ")}</th>
                    <td>
                      <span className={STATE_LABEL[s.effectiveState].cls}>{STATE_LABEL[s.effectiveState].text}</span>
                      {s.stale ? <span className="muted"> (last said {s.recordedState.toLowerCase()}, not re-checked)</span> : null}
                    </td>
                    <td>{when(s.since)}</td>
                    <td>{when(s.checkedAt)}</td>
                    <td>{s.measured ? "Measured" : "Reported"}</td>
                    <td>{s.effectiveState === "OPERATIONAL" ? "Everything." : s.guidance ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {admin ? (
          <div style={{ marginTop: 12 }}>
            <ProbeButton />
          </div>
        ) : null}
      </section>

      {board ? (
        <section aria-labelledby="fn-h" style={{ marginTop: 24 }}>
          <h2 id="fn-h">What you can do right now</h2>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Function</th>
                  <th scope="col">Availability</th>
                  <th scope="col">Depends on</th>
                </tr>
              </thead>
              <tbody>
                {functions.map((f) => (
                  <tr key={f.name}>
                    <th scope="row">{f.name}</th>
                    <td>
                      <span className={AVAIL_LABEL[f.availability].cls}>{AVAIL_LABEL[f.availability].text}</span>
                    </td>
                    <td>
                      {f.dependsOn.join(", ")}
                      {f.blockedBy.length ? <span className="muted"> — not confirmed: {f.blockedBy.join(", ")}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* ------------------------------------------------ downtime work */}
      <section aria-labelledby="dt-h" style={{ marginTop: 24 }}>
        <h2 id="dt-h">Work done during downtime — {ctx.activePractice!.name}</h2>
        {!canReadWork ? (
          <PermissionState />
        ) : downtime === null ? (
          <ErrorState title="Downtime records could not be loaded" />
        ) : (
          <>
            <p className="muted">
              Enter what was done while the system was down, dated when it actually happened. Each line stays outstanding
              until someone records where it went — entering it here does not create time entries or complete jobs.
            </p>
            {downtime.length === 0 ? (
              <EmptyState title="No downtime work waiting to be reconciled" />
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <caption>{downtime.length} line{downtime.length === 1 ? "" : "s"} outstanding.</caption>
                  <thead>
                    <tr>
                      <th scope="col">When done</th>
                      <th scope="col">Entered</th>
                      <th scope="col">What</th>
                      <th scope="col">Reconcile</th>
                    </tr>
                  </thead>
                  <tbody>
                    {downtime.map((r) => (
                      <tr key={r.id}>
                        <td>{when(r.occurredAt)}</td>
                        <td>{when(r.recordedAt)}</td>
                        <td>
                          {r.description}
                          {r.service ? <span className="muted"> ({r.service} down)</span> : null}
                        </td>
                        <td>
                          {canWriteWork ? (
                            <NoteAction
                              path={`/api/continuity/downtime/${r.id}/reconcile`}
                              label="Mark reconciled"
                              pendingLabel="Saving…"
                              noteLabel="Where it was entered"
                              noteField="note"
                              version={r.version}
                              what="this downtime record"
                            />
                          ) : (
                            <span className="muted">Needs someone who can update work</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {canWriteWork ? (
              <details style={{ marginTop: 12 }}>
                <summary>Enter a downtime sheet</summary>
                <DowntimeForm practiceId={practiceId} />
              </details>
            ) : null}
          </>
        )}
      </section>

      {/* ------------------------------------------ emergency export */}
      {can(membership, "export.run") ? (
        <section aria-labelledby="ex-h" style={{ marginTop: 24 }}>
          <h2 id="ex-h">Emergency obligation export</h2>
          <EmergencyExportForm practiceId={practiceId} practiceName={ctx.activePractice!.name} />
        </section>
      ) : null}

      {/* ------------------------------------------------ administrators */}
      {admin ? (
        <section aria-labelledby="rec-h" style={{ marginTop: 32 }}>
          <h2 id="rec-h">Backup and recovery (system administrators)</h2>
          {overviewError || !overview ? (
            <ErrorState title="Recovery records could not be loaded" detail={overviewError ?? undefined} />
          ) : (
            <RecoveryPanel overview={overview} />
          )}
          <h3 style={{ marginTop: 24 }}>Report a service the system cannot measure</h3>
          <ReportStatusForm />
        </section>
      ) : null}

      <p className="muted" style={{ marginTop: 24 }}>
        Procedures, approved backup locations and what is not yet verified are in BACKUP-RECOVERY.md.{" "}
        <Link href="/">Back to Home</Link>
      </p>
    </Screen>
  );
}

function RecoveryPanel({ overview }: { overview: RecoveryOverview }) {
  const { posture, backups, restores, schedule, gate, openDrills } = overview;
  return (
    <>
      <h3>Recovery targets (measured, not assumed)</h3>
      <dl className="definition-list">
        <dt>Recovery point — newest backup age</dt>
        <dd>
          {minutes(posture.currentRpoSeconds)} against a target of {minutes(posture.rpoTargetSeconds)}
          {posture.rpoWithinTarget === null ? " — no backup exists" : posture.rpoWithinTarget ? " — within target" : " — PAST target"}
        </dd>
        <dt>Recovery time — last measured restore</dt>
        <dd>
          {minutes(posture.lastMeasuredRtoSeconds)} against a target of {minutes(posture.rtoTargetSeconds)}
          {posture.rtoWithinTarget === null ? " — never measured" : posture.rtoWithinTarget ? " — within target" : " — PAST target"}
        </dd>
      </dl>
      {posture.warnings.length ? (
        <div className="banner banner--warning" role="status">
          <ul>{posture.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      ) : null}

      <h3 style={{ marginTop: 24 }}>Backups</h3>
      <RunBackupButton />
      {backups.length === 0 ? (
        <EmptyState title="No backup has been taken" body="Recovery is not possible until one exists." />
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Data as of</th>
                <th scope="col">Status</th>
                <th scope="col">Offsite copy</th>
                <th scope="col">Immutable copy</th>
                <th scope="col" className="numeric">Size</th>
              </tr>
            </thead>
            <tbody>
              {backups.map((b) => (
                <tr key={b.id}>
                  <td>{when(b.dataAsOf)}</td>
                  <td>{b.status}{b.failureReason ? ` — ${b.failureReason}` : ""}</td>
                  <td>{b.offsite ? "Yes" : "No — gap"}</td>
                  <td>{b.immutableCopy ? "Yes" : "No — gap"}</td>
                  <td className="numeric">{(b.sizeBytes / 1_048_576).toFixed(1)} MB</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 style={{ marginTop: 24 }}>Restores</h3>
      {restores.length === 0 ? (
        <EmptyState title="No restore has been run" body="Run a primary-server-loss drill to measure one." />
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Started</th>
                <th scope="col">Target</th>
                <th scope="col">Reconciliation</th>
                <th scope="col">RPO / RTO</th>
                <th scope="col">Outbound</th>
              </tr>
            </thead>
            <tbody>
              {restores.map((r) => (
                <tr key={r.id}>
                  <td>{when(r.startedAt)}</td>
                  <td>{r.targetLabel}</td>
                  <td>
                    {r.status} — {r.checkCount - r.failedCheckCount}/{r.checkCount} checks passed
                    {r.failureReason ? <span className="muted"> ({r.failureReason})</span> : null}
                  </td>
                  <td>
                    {minutes(r.measuredRpoSeconds)} / {minutes(r.measuredRtoSeconds)}
                    {r.targetsMet === null ? "" : r.targetsMet ? " — met" : " — MISSED"}
                  </td>
                  <td>
                    {r.outboundReleasedAt ? (
                      `Released ${when(r.outboundReleasedAt)}`
                    ) : r.status === "COMPLETED" ? (
                      <NoteAction
                        path={`/api/recovery/restores/${r.id}/release`}
                        label="Release outbound hold"
                        pendingLabel="Releasing…"
                        noteLabel="Why it is safe to send"
                        noteField="reason"
                        version={r.version}
                        what="this restore"
                      />
                    ) : (
                      "Held — reconciliation incomplete"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 style={{ marginTop: 24 }}>Drills</h3>
      <div className={gate.passed ? "banner banner--info" : "banner banner--danger"} role="status">
        <p>
          <strong>{gate.passed ? "Pre-production drill gate: passed." : "Pre-production drill gate: NOT passed."}</strong>
        </p>
        {gate.blockers.length ? <ul>{gate.blockers.map((b) => <li key={b}>{b}</li>)}</ul> : null}
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Scenario</th>
              <th scope="col">Last performed</th>
              <th scope="col">Result</th>
              <th scope="col">Next due</th>
              <th scope="col" className="numeric">Open remediations</th>
            </tr>
          </thead>
          <tbody>
            {schedule.map((s) => (
              <tr key={s.scenario}>
                <th scope="row">{s.scenario.replaceAll("_", " ").toLowerCase()}</th>
                <td>{s.lastPerformedAt ? when(s.lastPerformedAt) : "Never"}</td>
                <td>{s.lastClean === null ? "—" : s.lastClean ? "No findings" : "Findings recorded"}</td>
                <td>
                  {s.nextDueAt ? when(s.nextDueAt) : "Now"}
                  {s.overdue ? <strong> — overdue</strong> : null}
                </td>
                <td className="numeric">{s.openRemediations}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {openDrills.length ? (
        <>
          <h4 style={{ marginTop: 16 }}>Open remediations</h4>
          {openDrills.map((d) => (
            <div key={d.id} className="card" style={{ marginBottom: 12 }}>
              <p>
                <strong>{d.scenario.replaceAll("_", " ").toLowerCase()}</strong>, {when(d.performedAt)} — owner{" "}
                {d.remediationOwnerName}, due {d.remediationDueAt ? when(d.remediationDueAt) : "not set"}
              </p>
              <ul>
                {d.missingItems.map((m) => <li key={m}>Missing: {m}</li>)}
                {d.exceptions.map((m) => <li key={m}>Exception: {m}</li>)}
              </ul>
              <NoteAction
                path={`/api/recovery/drills/${d.id}/close`}
                label="Close remediation"
                pendingLabel="Closing…"
                noteLabel="What was done"
                noteField="note"
                version={d.version}
                what="this drill"
              />
            </div>
          ))}
        </>
      ) : null}

      <details style={{ marginTop: 16 }}>
        <summary>Run a drill</summary>
        <RunDrillForm />
      </details>
    </>
  );
}
