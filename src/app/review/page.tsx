import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { screenContext } from "@/lib/screen-context";
import { EmptyState, PermissionState, Screen } from "@/components/states";
import { humanState } from "@/app/page";

export const dynamic = "force-dynamic";

/**
 * Review queue — PRD §39: "Risk / due date order → exact version → exceptions
 * → decision with reason." Primary action: "Approve or request changes."
 *
 * "Exact version" is the column that matters. A reviewer approves version 4,
 * not "the job" — which is what makes WRK02's rule work: a later change
 * request bumps the version and the old approval goes stale on its own rather
 * than being edited away. Showing the version here is what lets a reviewer
 * notice they are looking at something that has moved under them.
 */
export default async function ReviewQueuePage() {
  const scope = await screenContext("filing.approve");

  if (scope.state === "signed-out") {
    return (
      <Screen title="Review queue">
        <EmptyState title="Sign in to see the review queue" />
      </Screen>
    );
  }
  if (scope.state === "no-practice" || scope.state === "denied") {
    return (
      <Screen title="Review queue">
        <PermissionState />
      </Screen>
    );
  }

  const { ctx, practiceId } = scope;
  const today = new Date();

  const jobs = await prisma.job.findMany({
    where: { practiceId, archivedAt: null, state: "IN_REVIEW" },
    orderBy: [{ priority: "desc" }, { dueDate: "asc" }],
    take: 100,
    select: {
      id: true,
      title: true,
      periodKey: true,
      version: true,
      priority: true,
      dueDate: true,
      ownerUserId: true,
      engagement: {
        select: { clientRelationship: { select: { party: { select: { legalName: true } } } } },
      },
    },
  });

  const preparerIds = [...new Set(jobs.map((j) => j.ownerUserId).filter((id): id is string => !!id))];
  const preparers = await prisma.user.findMany({
    where: { id: { in: preparerIds } },
    select: { id: true, fullName: true },
  });
  const nameOf = (id: string | null) =>
    id ? (preparers.find((p) => p.id === id)?.fullName ?? "Unknown") : "Unassigned";

  return (
    <Screen
      title="Review queue"
      lede={`Work awaiting review in ${ctx.activePractice!.name}, most urgent first.`}
      breadcrumbs={[{ href: "/", label: "Home" }]}
    >
      {jobs.length === 0 ? (
        <EmptyState
          title="Nothing waiting for review"
          body="No work in this practice is currently submitted for review."
        />
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <caption>
              {jobs.length} item{jobs.length === 1 ? "" : "s"} awaiting review. Approving applies to
              the exact version shown.
            </caption>
            <thead>
              <tr>
                <th scope="col">Job</th>
                <th scope="col">Client</th>
                <th scope="col">Period</th>
                <th scope="col">Prepared by</th>
                <th scope="col" className="numeric">
                  Version
                </th>
                <th scope="col">Due</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const late = job.dueDate !== null && job.dueDate < today;
                // IAM04 / separation of duties: a preparer cannot review their
                // own work. Flagged in the queue so a reviewer is not led into
                // a decision the server is going to refuse anyway.
                const ownWork = job.ownerUserId === ctx.userId;
                return (
                  <tr key={job.id}>
                    <th scope="row">
                      <Link href={`/jobs/${job.id}`}>{job.title}</Link>
                      {ownWork ? (
                        <span className="status status--warn" style={{ marginLeft: 8 }}>
                          Your own work — you cannot review this
                        </span>
                      ) : null}
                    </th>
                    <td>{job.engagement.clientRelationship.party.legalName}</td>
                    <td>{job.periodKey}</td>
                    <td>{nameOf(job.ownerUserId)}</td>
                    <td className="numeric">{job.version}</td>
                    <td>
                      {job.dueDate ? job.dueDate.toISOString().slice(0, 10) : "—"}{" "}
                      {late ? <span className="status status--overdue">Overdue</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Screen>
  );
}

export { humanState };
