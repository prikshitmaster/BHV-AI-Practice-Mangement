import { prisma } from "@/lib/prisma";
import { screenContext } from "@/lib/screen-context";
import { EmptyState, PermissionState, Screen } from "@/components/states";

export const dynamic = "force-dynamic";

/**
 * Calendar — the statutory obligations view (DUE02/DUE04).
 *
 * The table shows BOTH the original statutory date and the current one,
 * because DUE02 keeps them as separate fields and an extension must never
 * erase what the original deadline was. A single "due date" column would
 * quietly destroy that distinction the first time a notification moved
 * something.
 *
 * REVIEW_REQUIRED is shown as its own status rather than folded into
 * "pending": DUE04 requires an obligation with an unknown form or category to
 * stay visible as needing review, and not be silently treated as fine.
 */
export default async function CalendarPage() {
  const scope = await screenContext("job.read");

  if (scope.state === "signed-out") {
    return (
      <Screen title="Calendar">
        <EmptyState title="Sign in to see the calendar" />
      </Screen>
    );
  }
  if (scope.state === "no-practice" || scope.state === "denied") {
    return (
      <Screen title="Calendar">
        <PermissionState />
      </Screen>
    );
  }

  const { ctx, practiceId } = scope;
  const today = new Date();

  const obligations = await prisma.obligation.findMany({
    where: { practiceId, status: { notIn: ["FILED", "NOT_APPLICABLE"] } },
    orderBy: { currentStatutoryDate: "asc" },
    take: 100,
    select: {
      id: true,
      status: true,
      originalStatutoryDate: true,
      currentStatutoryDate: true,
      internalTargetDate: true,
      clientRelationship: { select: { party: { select: { legalName: true } } } },
      rule: { select: { code: true, service: true, governingLaw: true } },
    },
  });

  return (
    <Screen
      title="Calendar"
      lede={`Open statutory obligations in ${ctx.activePractice!.name}, earliest first.`}
      breadcrumbs={[{ href: "/", label: "Home" }]}
    >
      {obligations.length === 0 ? (
        <EmptyState
          title="No open obligations"
          body="Nothing is currently outstanding for this practice. Filed and not-applicable obligations are not listed here."
        />
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <caption>
              Both the original and the current statutory date are shown. An extension moves the
              current date and never rewrites the original.
            </caption>
            <thead>
              <tr>
                <th scope="col">Client</th>
                <th scope="col">Obligation</th>
                <th scope="col">Original statutory date</th>
                <th scope="col">Current statutory date</th>
                <th scope="col">Internal target</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {obligations.map((o) => {
                const late = o.currentStatutoryDate < today;
                const extended =
                  o.originalStatutoryDate.getTime() !== o.currentStatutoryDate.getTime();
                return (
                  <tr key={o.id}>
                    <th scope="row">{o.clientRelationship.party.legalName}</th>
                    <td>
                      {o.rule.code}
                      <span className="muted" style={{ display: "block", fontSize: 13 }}>
                        {o.rule.service} · {o.rule.governingLaw.replace(/_/g, " ").toLowerCase()}
                      </span>
                    </td>
                    <td>{o.originalStatutoryDate.toISOString().slice(0, 10)}</td>
                    <td>
                      {o.currentStatutoryDate.toISOString().slice(0, 10)}
                      {extended ? (
                        <span className="status status--info" style={{ marginLeft: 8 }}>
                          Extended
                        </span>
                      ) : null}
                    </td>
                    <td>
                      {o.internalTargetDate
                        ? o.internalTargetDate.toISOString().slice(0, 10)
                        : "—"}
                    </td>
                    <td>
                      <span
                        className={`status status--${
                          o.status === "OVERDUE" || late
                            ? "overdue"
                            : o.status === "REVIEW_REQUIRED"
                              ? "warn"
                              : "info"
                        }`}
                      >
                        {o.status.replace(/_/g, " ").toLowerCase()}
                      </span>
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
