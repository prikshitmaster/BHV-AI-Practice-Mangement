import Link from "next/link";
import type { Prisma } from "@/generated/prisma/client";
import type { WorkState } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { screenContext } from "@/lib/screen-context";
import { EmptyState, PermissionState, Screen } from "@/components/states";
import { humanState } from "@/app/page";

export const dynamic = "force-dynamic";

/**
 * My work — PRD §39: "Saved views → filters → readable list / optional board →
 * detail drawer." Primary action: "Update or submit for review."
 *
 * The saved views are the filters people actually use in a practice: what is
 * mine, what is waiting on someone else, what is late. The list is a table
 * rather than a board by default because a table is readable at 200% zoom, is
 * navigable by keyboard without a drag interaction, and prints.
 */

const VIEWS = [
  { key: "mine", label: "Assigned to me" },
  { key: "review", label: "Waiting for review" },
  { key: "client", label: "Waiting for the client" },
  { key: "late", label: "Past due" },
] as const;

type ViewKey = (typeof VIEWS)[number]["key"];

export default async function MyWorkPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const scope = await screenContext("job.read");
  const params = await searchParams;
  const view = (VIEWS.find((v) => v.key === params.view)?.key ?? "mine") as ViewKey;

  if (scope.state === "signed-out") {
    return (
      <Screen title="My work">
        <EmptyState title="Sign in to see your work" />
      </Screen>
    );
  }
  if (scope.state === "no-practice" || scope.state === "denied") {
    return (
      <Screen title="My work">
        <PermissionState />
      </Screen>
    );
  }

  const { ctx, practiceId } = scope;
  const today = new Date();

  const OPEN: WorkState[] = [
    "DRAFT", "READY", "IN_PROGRESS", "WAITING_FOR_CLIENT", "WAITING_INTERNALLY",
    "IN_REVIEW", "CHANGES_REQUESTED", "APPROVED_FOR_ACTION", "SUBMITTED_DELIVERED", "REOPENED",
  ];

  const where: Prisma.JobWhereInput = {
    mine: { ownerUserId: ctx.userId, state: { in: OPEN } },
    review: { state: "IN_REVIEW" as const },
    client: { state: "WAITING_FOR_CLIENT" as const },
    late: { dueDate: { lt: today }, state: { in: OPEN } },
  }[view];

  const jobs = await prisma.job.findMany({
    where: { practiceId, archivedAt: null, ...where },
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
    take: 100,
    select: {
      id: true,
      title: true,
      periodKey: true,
      state: true,
      dueDate: true,
      priority: true,
      engagement: {
        select: {
          clientRelationship: { select: { party: { select: { legalName: true } } } },
        },
      },
    },
  });

  return (
    <Screen
      title="My work"
      lede={`Jobs in ${ctx.activePractice!.name}.`}
      breadcrumbs={[{ href: "/", label: "Home" }]}
    >
      <nav aria-label="Saved views" className="row" style={{ marginBottom: 16 }}>
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            className="theme-option"
            href={`/my-work?view=${v.key}`}
            aria-current={v.key === view ? "page" : undefined}
            style={
              v.key === view
                ? {
                    background: "var(--accent-subtle-bg)",
                    borderColor: "var(--accent)",
                    color: "var(--accent)",
                    fontWeight: 650,
                  }
                : undefined
            }
          >
            {v.label}
          </Link>
        ))}
      </nav>

      {jobs.length === 0 ? (
        <EmptyState
          title={view === "mine" ? "No work assigned" : "Nothing in this view"}
          body={
            view === "mine"
              ? "Nothing is assigned to you in this practice right now."
              : "No jobs currently match this view. Try another saved view."
          }
        />
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <caption>
              {jobs.length} job{jobs.length === 1 ? "" : "s"} — {VIEWS.find((v) => v.key === view)!.label},
              earliest deadline first.
            </caption>
            <thead>
              <tr>
                <th scope="col">Job</th>
                <th scope="col">Client</th>
                <th scope="col">Period</th>
                <th scope="col">State</th>
                <th scope="col">Due</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const late = job.dueDate !== null && job.dueDate < today;
                return (
                  <tr key={job.id}>
                    <th scope="row">
                      <Link href={`/jobs/${job.id}`}>{job.title}</Link>
                    </th>
                    <td>{job.engagement.clientRelationship.party.legalName}</td>
                    <td>{job.periodKey}</td>
                    <td>{humanState(job.state)}</td>
                    <td>
                      {job.dueDate ? (
                        <>
                          {job.dueDate.toISOString().slice(0, 10)}{" "}
                          {/* UX04: the word "Overdue" carries the meaning; the
                              colour only reinforces it. */}
                          {late ? <span className="status status--overdue">Overdue</span> : null}
                        </>
                      ) : (
                        "—"
                      )}
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
