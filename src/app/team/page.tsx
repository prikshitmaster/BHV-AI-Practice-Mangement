import { prisma } from "@/lib/prisma";
import { screenContext } from "@/lib/screen-context";
import { EmptyState, PermissionState, Screen } from "@/components/states";

export const dynamic = "force-dynamic";

/**
 * Team — the destination behind NAV01's manager pin ("managers can pin
 * Team / Reports").
 *
 * It shows who holds live authority IN THE ACTIVE PRACTICE and what that
 * authority is. Nothing here is a control surface: changing a role is an IAM
 * action that goes through the permission engine, and this screen deliberately
 * does not offer it, so a manager cannot promote someone from a list view.
 *
 * Two things it must not do, both learned from earlier modules:
 *   - It must not list the firm's people across practices. A membership is
 *     per-practice (ORG01/IAM02); showing a colleague's role in the OTHER
 *     practice from this screen would be exactly the cross-practice
 *     disclosure T03 exists to prevent. The query is bound to
 *     scope.practiceId and to nothing else.
 *   - It must not quietly drop revoked or expired members. It shows live
 *     authority, and says in words that it is showing live authority, because
 *     "who can approve this today" is the question a manager is actually
 *     asking.
 */
export default async function TeamPage() {
  // A manager pins this, so `job.read` in the active practice is the gate —
  // the same capability the pin itself requires in ux.ts. If the two ever
  // disagree the menu is lying, so they are deliberately the same string.
  const scope = await screenContext("job.read");

  if (scope.state === "signed-out") {
    return (
      <Screen title="Team">
        <EmptyState title="Sign in to see your team" />
      </Screen>
    );
  }

  if (scope.state === "no-practice") {
    return (
      <Screen title="Team" breadcrumbs={[{ href: "/", label: "Home" }]}>
        <EmptyState
          title="You have no live membership in any practice"
          body="A team list belongs to a practice. Ask an owner to add you to one."
        />
      </Screen>
    );
  }

  if (scope.state === "denied") {
    return (
      <Screen title="Team" breadcrumbs={[{ href: "/", label: "Home" }]}>
        <PermissionState />
      </Screen>
    );
  }

  const ctx = scope.ctx;
  const now = new Date();

  const memberships = await prisma.practiceMembership.findMany({
    where: {
      practiceId: scope.practiceId,
      revokedAt: null,
      effectiveFrom: { lte: now },
      AND: [
        { OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
        { OR: [{ grantExpiresAt: null }, { grantExpiresAt: { gt: now } }] },
      ],
    },
    select: {
      id: true,
      role: true,
      assignmentScope: true,
      effectiveFrom: true,
      grantExpiresAt: true,
      user: { select: { id: true, fullName: true, email: true, status: true } },
    },
    orderBy: [{ role: "asc" }, { user: { fullName: "asc" } }],
  });

  // Open work per member, counted in this practice only. It is what makes the
  // screen worth opening: a role list on its own answers nothing a manager
  // asks on a Monday morning.
  const openByUser = new Map<string, number>();
  const grouped = await prisma.job.groupBy({
    by: ["ownerUserId"],
    where: {
      practiceId: scope.practiceId,
      archivedAt: null,
      state: { notIn: ["COMPLETED", "CANCELLED"] },
      ownerUserId: { not: null },
    },
    _count: { _all: true },
  });
  for (const row of grouped) {
    if (row.ownerUserId) openByUser.set(row.ownerUserId, row._count._all);
  }

  const readable = (value: string) => value.replace(/_/g, " ").toLowerCase();

  return (
    <Screen
      title="Team"
      lede={`Live authority in ${ctx.activePractice?.name ?? "this practice"}.`}
      breadcrumbs={[{ href: "/", label: "Home" }]}
    >
      {memberships.length === 0 ? (
        <EmptyState
          title="No one holds live authority in this practice"
          body="Memberships may have been revoked or have not started yet. An owner can grant one."
        />
      ) : (
        <>
          <div className="table-scroll">
            <table className="data-table">
              <caption>
                People with a live membership in {ctx.activePractice?.name ?? "this practice"}.
                Memberships in other practices are not shown here and are not implied by this
                list.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Role here</th>
                  <th scope="col">Scope</th>
                  <th scope="col">Account</th>
                  <th scope="col">Open work</th>
                  <th scope="col">Since</th>
                </tr>
              </thead>
              <tbody>
                {memberships.map((m) => {
                  const open = openByUser.get(m.user.id) ?? 0;
                  return (
                    <tr key={m.id}>
                      <th scope="row">
                        {m.user.fullName}
                        <span className="muted"> · {m.user.email}</span>
                      </th>
                      <td>{readable(m.role)}</td>
                      <td>{readable(m.assignmentScope)}</td>
                      <td>
                        {/* UX04: state is in words, not carried by colour. */}
                        <span
                          className={`status status--${m.user.status === "ACTIVE" ? "ok" : "warn"}`}
                        >
                          {readable(m.user.status)}
                        </span>
                      </td>
                      <td>
                        {/* Deliberately not a link: /my-work has no assignee
                            filter, so a link would quietly show the READER's
                            own work under someone else's name. The count is
                            true; a link would not be. */}
                        {open === 0 ? <span className="muted">None</span> : `${open} open`}
                      </td>
                      <td>
                        {m.effectiveFrom.toISOString().slice(0, 10)}
                        {m.grantExpiresAt ? (
                          <span className="muted">
                            {" "}
                            · expires {m.grantExpiresAt.toISOString().slice(0, 10)}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="muted">
            Roles are changed by an owner through membership administration, not from this list —
            so a role cannot be raised from a screen that only reports on it.
          </p>
        </>
      )}
    </Screen>
  );
}
