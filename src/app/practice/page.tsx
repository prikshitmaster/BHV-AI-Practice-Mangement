import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { screenContext } from "@/lib/screen-context";
import { EmptyState, Screen } from "@/components/states";
import { DensitySwitcher } from "@/components/density-switcher";

export const dynamic = "force-dynamic";

/**
 * Practice — PRD §39: "Role learning → service playbooks → templates → sample
 * practice → manual." Primary action: "Open relevant guide or exercise."
 *
 * This is the R0 shell of that screen. It carries the things a new joiner
 * actually needs on day one — what their role can and cannot do, and who to
 * ask — plus the display settings. The playbooks, sample practice and manual
 * are R1 content and are named here as absent rather than quietly omitted, so
 * the gap is visible to whoever picks this up.
 */
export default async function PracticePage() {
  const scope = await screenContext();

  if (scope.state === "signed-out") {
    return (
      <Screen title="Practice">
        <EmptyState title="Sign in to see practice information" />
      </Screen>
    );
  }

  const ctx = scope.ctx;

  const practice =
    scope.state === "ok"
      ? await prisma.practice.findUnique({
          where: { id: scope.practiceId },
          select: {
            name: true,
            registeredDisplayName: true,
            constitution: true,
            jurisdictionTimeZone: true,
            readOnlyFrom: true,
            registrations: {
              where: { archivedAt: null },
              select: { kind: true, value: true, effectiveFrom: true, verifiedAt: true },
            },
          },
        })
      : null;

  return (
    <Screen
      title="Practice"
      lede="Your role, your settings, and how to get help."
      breadcrumbs={[{ href: "/", label: "Home" }]}
    >
      <h2>Your access</h2>
      <div className="card">
        <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 16px" }}>
          <dt className="secondary">Signed in as</dt>
          <dd style={{ margin: 0 }}>{ctx.userName}</dd>
          <dt className="secondary">Active practice</dt>
          <dd style={{ margin: 0 }}>{ctx.activePractice?.name ?? "None"}</dd>
          <dt className="secondary">Role here</dt>
          <dd style={{ margin: 0 }}>
            {ctx.membership ? ctx.membership.role.replace(/_/g, " ").toLowerCase() : "No live membership"}
          </dd>
          <dt className="secondary">Scope</dt>
          <dd style={{ margin: 0 }}>
            {ctx.membership
              ? ctx.membership.assignmentScope.replace(/_/g, " ").toLowerCase()
              : "—"}
          </dd>
          <dt className="secondary">Practices you can reach</dt>
          <dd style={{ margin: 0 }}>{ctx.practices.map((p) => p.name).join(", ") || "None"}</dd>
        </dl>
        {ctx.membership && ctx.membership.grants.length > 0 ? (
          <p style={{ marginBottom: 0 }}>
            Additional grants:{" "}
            {ctx.membership.grants.map((g) => g.replace(/_/g, " ").toLowerCase()).join(", ")}
          </p>
        ) : (
          <p className="muted" style={{ marginBottom: 0 }}>
            You hold no additional grants over restricted areas. Restricted areas stay closed
            until one is given, whatever your role.
          </p>
        )}
      </div>

      {practice ? (
        <>
          <h2>Practice details</h2>
          <div className="card">
            <dl
              style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 16px" }}
            >
              <dt className="secondary">Registered name</dt>
              <dd style={{ margin: 0 }}>{practice.registeredDisplayName ?? practice.name}</dd>
              <dt className="secondary">Constitution</dt>
              <dd style={{ margin: 0 }}>{practice.constitution.replace(/_/g, " ").toLowerCase()}</dd>
              <dt className="secondary">Statutory time zone</dt>
              <dd style={{ margin: 0 }}>{practice.jurisdictionTimeZone}</dd>
            </dl>
            {practice.readOnlyFrom ? (
              <p className="banner banner--warning" style={{ marginTop: 16, marginBottom: 0 }}>
                <span aria-hidden="true">!</span>
                <span>
                  This practice is read only from{" "}
                  {practice.readOnlyFrom.toISOString().slice(0, 10)}. Records are retained; nothing
                  new can be created.
                </span>
              </p>
            ) : null}
          </div>

          <h3>Registrations</h3>
          {practice.registrations.length === 0 ? (
            <EmptyState
              title="No registrations recorded"
              body="Registration numbers must be verified at onboarding before they are recorded here."
            />
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <caption>Practice registrations, held as effective intervals.</caption>
                <thead>
                  <tr>
                    <th scope="col">Kind</th>
                    <th scope="col">Number</th>
                    <th scope="col">Effective from</th>
                    <th scope="col">Verified</th>
                  </tr>
                </thead>
                <tbody>
                  {practice.registrations.map((r, i) => (
                    <tr key={i}>
                      <th scope="row">{r.kind}</th>
                      <td>{r.value}</td>
                      <td>{r.effectiveFrom.toISOString().slice(0, 10)}</td>
                      <td>
                        {/* ORG02: an identifier holder is a verified fact,
                            never an assumed one — so an unverified row says
                            so rather than looking the same as a checked one. */}
                        <span className={`status status--${r.verifiedAt ? "ok" : "warn"}`}>
                          {r.verifiedAt ? r.verifiedAt.toISOString().slice(0, 10) : "Not verified"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}

      <h2>Display settings</h2>
      <div className="card">
        <p style={{ marginTop: 0 }}>
          Appearance is saved to your account and follows you to any device. Use the control in the
          top bar to change the theme; switching it keeps whatever you are working on.
        </p>
        <DensitySwitcher initial={ctx.density} />
      </div>

      <h2>Continuity</h2>
      <div className="card">
        <p style={{ marginTop: 0 }}>
          Which services are working, what you can still do during an outage, the emergency
          obligation export, and the sheet for recording work done while the system was down.
        </p>
        <Link href="/continuity">Service status and continuity</Link>
      </div>

      <h2>Privacy and incidents</h2>
      <div className="card">
        <p style={{ marginTop: 0 }}>
          Report a suspected security incident — reporting clocks run from when you became aware.
          Partners also keep the processing and regulatory registers, retention schedules and
          erasure review here.
        </p>
        <Link href="/privacy">Privacy and incidents</Link>
      </div>

      <h2>Connectors</h2>
      <div className="card">
        <p style={{ marginTop: 0 }}>
          Outside services this practice connects to — email, imports, storage — with their owner,
          purpose, environment and credential reference. Secrets are never shown or stored here.
        </p>
        <Link href="/connectors">Connectors</Link>
      </div>

      <h2>Guides</h2>
      <EmptyState
        title="Playbooks and the practice manual are not built yet"
        body="Role learning, service playbooks, templates, the sample practice and the manual are planned for a later release. Until then, ask your manager or the engagement partner."
      />
    </Screen>
  );
}
