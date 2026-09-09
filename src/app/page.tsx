import Link from "next/link";
import { cookies } from "next/headers";
import { loadUxContext } from "@/lib/ux";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import { EmptyState, PermissionState, Screen } from "@/components/states";

export const dynamic = "force-dynamic";

/**
 * Home — NAV01's first destination.
 *
 * PRD §39 hierarchy: "Practice context → personal priorities → exceptions →
 * small set of relevant metrics." Primary action: "Open next work item."
 *
 * The order on screen is that order. The metrics are last and few, because a
 * dashboard of numbers is not what someone opening the app at 9am needs —
 * they need the next thing to do, and the things that have gone wrong.
 */
export default async function HomePage() {
  const cookieStore = await cookies();
  const ctx = await loadUxContext(cookieStore.get("bhv_practice")?.value ?? null);

  if (!ctx) {
    return (
      <Screen title="Sign in" lede="This is a private system for authorised staff.">
        <div className="card">
          <p>
            You are not signed in. If you have been invited but have no account yet, use the link
            in your invitation.
          </p>
          <Link className="btn btn--primary" href="/login">
            Sign in
          </Link>
        </div>
      </Screen>
    );
  }

  if (!ctx.activePractice || !ctx.membership) {
    // NAV03 permission state, at the top level: an account with no live
    // membership sees a route to ask, and no practice names.
    return (
      <Screen title={`Welcome, ${ctx.userName}`}>
        <PermissionState />
      </Screen>
    );
  }

  const practiceId = ctx.activePractice.id;
  const readsJobs = can(ctx.membership, "job.read");

  const [myJobs, overdue, awaitingClient, openRequests] = await Promise.all([
    readsJobs
      ? prisma.job.findMany({
          where: {
            practiceId,
            archivedAt: null,
            ownerUserId: ctx.userId,
            state: { notIn: ["COMPLETED", "CANCELLED"] },
          },
          orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
          take: 5,
          select: { id: true, title: true, periodKey: true, state: true, dueDate: true },
        })
      : [],
    readsJobs
      ? prisma.obligation.count({
          where: { practiceId, status: { in: ["OVERDUE", "REVIEW_REQUIRED"] } },
        })
      : 0,
    readsJobs
      ? prisma.job.count({
          where: { practiceId, archivedAt: null, state: "WAITING_FOR_CLIENT" },
        })
      : 0,
    readsJobs
      ? prisma.clientRequestItem.count({
          where: { practiceId, remindersStoppedAt: null },
        })
      : 0,
  ]);

  const next = myJobs[0];

  return (
    <Screen
      title={`Welcome, ${ctx.userName}`}
      lede={`You are working in ${ctx.activePractice.name}.`}
      actions={
        next ? (
          <Link className="btn btn--primary" href={`/jobs/${next.id}`}>
            Open next work item
          </Link>
        ) : null
      }
    >
      {!readsJobs ? (
        <PermissionState />
      ) : (
        <>
          <h2>Your priorities</h2>
          {myJobs.length === 0 ? (
            // NAV03 quotes this wording directly.
            <EmptyState
              title="No work assigned"
              body="Nothing is assigned to you in this practice right now. If you expect work here, check with your manager or look at the team's queue."
              action={
                <Link className="btn" href="/my-work">
                  Open My work
                </Link>
              }
            />
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <caption>Your open jobs, earliest deadline first.</caption>
                <thead>
                  <tr>
                    <th scope="col">Job</th>
                    <th scope="col">Period</th>
                    <th scope="col">State</th>
                    <th scope="col">Due</th>
                  </tr>
                </thead>
                <tbody>
                  {myJobs.map((job) => (
                    <tr key={job.id}>
                      <th scope="row">
                        <Link href={`/jobs/${job.id}`}>{job.title}</Link>
                      </th>
                      <td>{job.periodKey}</td>
                      <td>{humanState(job.state)}</td>
                      <td>{job.dueDate ? job.dueDate.toISOString().slice(0, 10) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h2>Exceptions</h2>
          <div className="card-grid">
            <ExceptionCard
              label="Deadlines overdue or needing review"
              count={overdue}
              href="/calendar"
              tone={overdue > 0 ? "overdue" : "ok"}
            />
            <ExceptionCard
              label="Jobs waiting for the client"
              count={awaitingClient}
              href="/my-work"
              tone={awaitingClient > 0 ? "warn" : "ok"}
            />
            <ExceptionCard
              label="Requested items still outstanding"
              count={openRequests}
              href="/my-work"
              tone={openRequests > 0 ? "warn" : "ok"}
            />
          </div>
        </>
      )}
    </Screen>
  );
}

/**
 * UX04: "Never use colour alone for overdue / complete." Each card states the
 * condition in words; the pill carries a glyph as well as a colour.
 */
function ExceptionCard({
  label,
  count,
  href,
  tone,
}: {
  label: string;
  count: number;
  href: string;
  tone: "ok" | "warn" | "overdue";
}) {
  return (
    <div className="card">
      <p style={{ margin: 0, fontSize: 28, fontWeight: 650 }}>{count}</p>
      <p style={{ margin: "4px 0 12px" }}>{label}</p>
      <p style={{ margin: "0 0 12px" }}>
        <span className={`status status--${tone}`}>
          {count === 0 ? "Nothing outstanding" : tone === "overdue" ? "Needs attention" : "To chase"}
        </span>
      </p>
      <Link className="btn" href={href}>
        Review
      </Link>
    </div>
  );
}

export function humanState(state: string): string {
  const text = state.replace(/_/g, " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
