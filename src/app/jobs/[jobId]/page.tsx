import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { screenContext } from "@/lib/screen-context";
import { blockingReasons } from "@/lib/work";
import { EmptyState, PermissionState, Screen } from "@/components/states";
import { humanState } from "@/app/page";

export const dynamic = "force-dynamic";

/**
 * Job detail — PRD §39: "Service / period / deadline → owner and blocker →
 * checklist → evidence → review history." Primary action: "Complete current
 * permitted step."
 *
 * The blocker sits high on the page deliberately. A job that cannot move is
 * the most useful thing to surface, and burying it under a checklist is how
 * people spend a morning on work that was never going to progress.
 */
export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const scope = await screenContext("job.read");
  const { jobId } = await params;

  if (scope.state === "signed-out") {
    return (
      <Screen title="Job">
        <EmptyState title="Sign in to see this job" />
      </Screen>
    );
  }
  if (scope.state === "no-practice" || scope.state === "denied") {
    return (
      <Screen title="Job">
        <PermissionState />
      </Screen>
    );
  }

  const { practiceId } = scope;

  const job = await prisma.job.findFirst({
    where: { id: jobId, practiceId, archivedAt: null },
    select: {
      id: true,
      title: true,
      periodKey: true,
      state: true,
      version: true,
      priority: true,
      dueDate: true,
      completedAt: true,
      reopenCount: true,
      ownerUserId: true,
      reviewerUserId: true,
      engagement: {
        select: {
          id: true,
          serviceCode: true,
          clientRelationship: {
            select: { id: true, party: { select: { legalName: true } } },
          },
        },
      },
      tasks: {
        select: {
          id: true,
          title: true,
          state: true,
          checklistItems: {
            select: { id: true, label: true, completedAt: true, notApplicableReason: true },
          },
        },
      },
    },
  });

  if (!job) {
    return (
      <Screen title="Job" breadcrumbs={[{ href: "/", label: "Home" }, { href: "/my-work", label: "My work" }]}>
        <PermissionState />
      </Screen>
    );
  }

  const [owner, reviewer, transitions] = await Promise.all([
    job.ownerUserId
      ? prisma.user.findUnique({ where: { id: job.ownerUserId }, select: { fullName: true } })
      : null,
    job.reviewerUserId
      ? prisma.user.findUnique({ where: { id: job.reviewerUserId }, select: { fullName: true } })
      : null,
    prisma.workStateTransition.findMany({
      where: { practiceId, subjectId: job.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        fromState: true,
        toState: true,
        reason: true,
        actorName: true,
        createdAt: true,
      },
    }),
  ]);

  const blockers = await Promise.all(
    job.tasks.map(async (t) => ({ task: t.title, reasons: await blockingReasons(t.id) })),
  );
  const blocked = blockers.filter((b) => b.reasons.length > 0);

  return (
    <Screen
      title={job.title}
      lede={`${job.engagement.clientRelationship.party.legalName} · ${job.periodKey}`}
      breadcrumbs={[
        { href: "/", label: "Home" },
        { href: "/my-work", label: "My work" },
        {
          href: `/clients/${job.engagement.clientRelationship.id}`,
          label: job.engagement.clientRelationship.party.legalName,
        },
      ]}
    >
      <div className="card">
        <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 16px" }}>
          <dt className="secondary">State</dt>
          <dd style={{ margin: 0 }}>{humanState(job.state)}</dd>
          <dt className="secondary">Deadline</dt>
          <dd style={{ margin: 0 }}>
            {job.dueDate ? job.dueDate.toISOString().slice(0, 10) : "Not set"}
          </dd>
          <dt className="secondary">Owner</dt>
          <dd style={{ margin: 0 }}>{owner?.fullName ?? "Unassigned"}</dd>
          <dt className="secondary">Reviewer</dt>
          <dd style={{ margin: 0 }}>{reviewer?.fullName ?? "Not yet assigned"}</dd>
          {job.reopenCount > 0 ? (
            <>
              <dt className="secondary">Reopened</dt>
              <dd style={{ margin: 0 }}>{job.reopenCount} time(s)</dd>
            </>
          ) : null}
        </dl>
      </div>

      {blocked.length > 0 ? (
        <div className="banner banner--warning" style={{ marginTop: 16 }} role="status">
          <span aria-hidden="true">!</span>
          <span>
            <strong>This job cannot move yet.</strong>
            {blocked.map((b) => (
              <p key={b.task}>
                {b.task}: {b.reasons.join("; ")}
              </p>
            ))}
          </span>
        </div>
      ) : null}

      <h2>Checklist</h2>
      {job.tasks.length === 0 ? (
        <EmptyState title="No tasks yet" body="This job has no tasks recorded against it." />
      ) : (
        job.tasks.map((task) => (
          <section key={task.id}>
            <h3>
              {task.title} <span className="status status--info">{humanState(task.state)}</span>
            </h3>
            {task.checklistItems.length === 0 ? (
              <p className="muted">No checklist items on this task.</p>
            ) : (
              <ul className="nav-list">
                {task.checklistItems.map((item) => (
                  <li key={item.id}>
                    <span className="nav-link">
                      {/* UX04: state is stated in words as well as marked. */}
                      <span
                        className={`status status--${item.completedAt ? "ok" : item.notApplicableReason ? "info" : "warn"}`}
                      >
                        {item.completedAt
                          ? "Done"
                          : item.notApplicableReason
                            ? "Not applicable"
                            : "Outstanding"}
                      </span>
                      <span>
                        {item.label}
                        {item.notApplicableReason ? (
                          <span className="muted" style={{ display: "block", fontSize: 13 }}>
                            {item.notApplicableReason}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))
      )}

      <h2>Review history</h2>
      {transitions.length === 0 ? (
        <EmptyState title="No recorded transitions" body="This job has not changed state yet." />
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <caption>
              Every state change, most recent first. History is appended to, never edited.
            </caption>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">From</th>
                <th scope="col">To</th>
                <th scope="col">By</th>
                <th scope="col">Reason</th>
              </tr>
            </thead>
            <tbody>
              {transitions.map((t) => (
                <tr key={t.id}>
                  <th scope="row">{t.createdAt.toISOString().slice(0, 16).replace("T", " ")}</th>
                  <td>{humanState(t.fromState)}</td>
                  <td>{humanState(t.toState)}</td>
                  <td>{t.actorName}</td>
                  <td>{t.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ marginTop: 24 }}>
        <Link href={`/clients/${job.engagement.clientRelationship.id}`}>
          Back to {job.engagement.clientRelationship.party.legalName}
        </Link>
      </p>
    </Screen>
  );
}
