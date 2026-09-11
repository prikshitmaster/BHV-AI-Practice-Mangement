import { screenContext } from "@/lib/screen-context";
import { EmptyState, ErrorState, PermissionState, Screen } from "@/components/states";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { listConnectors, runtimeEnvironment } from "@/lib/connectors";
import {
  ConnectorStatusButtons,
  CreateConnectorForm,
  RotateCredentialForm,
  TestConnectorButton,
} from "@/components/connector-actions";

export const dynamic = "force-dynamic";

/**
 * Connectors — INT01 (PRD §31). Gated on connector.manage here AND in every
 * library call. The page shows credential REFERENCES only; no secret is ever
 * loaded to render it.
 */

const when = (d: Date | null | undefined) =>
  d ? `${d.toISOString().slice(0, 16).replace("T", " ")} UTC` : "—";

const STATUS_CLS: Record<string, string> = {
  DRAFT: "status status--info",
  ACTIVE: "status status--ok",
  DISABLED: "status status--warn",
  RETIRED: "status status--info",
};
const TEST_LABEL: Record<string, { text: string; cls: string }> = {
  PASSED: { text: "Passed", cls: "status status--ok" },
  FAILED: { text: "Failed", cls: "status status--overdue" },
  REFUSED: { text: "Not attempted", cls: "status status--warn" },
};

export default async function ConnectorsPage() {
  const scope = await screenContext();
  if (scope.state === "signed-out") {
    return (
      <Screen title="Connectors">
        <EmptyState title="Sign in to manage connectors" />
      </Screen>
    );
  }
  if (scope.state === "no-practice" || scope.state === "denied" || !can(scope.ctx.membership!, "connector.manage")) {
    return (
      <Screen title="Connectors">
        <PermissionState />
      </Screen>
    );
  }

  const { ctx, practiceId } = scope;
  const runtime = runtimeEnvironment();
  let connectors: Awaited<ReturnType<typeof listConnectors>> | null = null;
  let error: string | null = null;
  try {
    connectors = await listConnectors(ctx.userId, practiceId);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const members = await prisma.practiceMembership.findMany({
    where: { practiceId, revokedAt: null },
    select: { user: { select: { id: true, fullName: true } } },
    distinct: ["userId"],
  });
  const memberList = members.map((m) => m.user);
  const nameOf = new Map(memberList.map((u) => [u.id, u.fullName]));

  return (
    <Screen
      title="Connectors"
      lede={`Outside services ${ctx.activePractice!.name} connects to. This system is running as ${runtime}; a connector for another environment cannot be tested or used from here.`}
      breadcrumbs={[{ href: "/practice", label: "Practice" }]}
    >
      <section aria-labelledby="list-h">
        <h2 id="list-h">Configured connectors</h2>
        {error ? (
          <ErrorState title="Connectors could not be loaded" body={error} />
        ) : !connectors?.length ? (
          <EmptyState title="No connectors configured for this practice yet" />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Provider</th>
                  <th scope="col">Environment</th>
                  <th scope="col">Purpose and scope</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Credential reference</th>
                  <th scope="col">Status</th>
                  <th scope="col">Last test</th>
                </tr>
              </thead>
              <tbody>
                {connectors.map((c) => {
                  const test = c.lastTestResult ? TEST_LABEL[c.lastTestResult] : null;
                  return (
                    <tr key={c.id}>
                      <td>{c.name}</td>
                      <td>{c.provider}</td>
                      <td>{c.environment}</td>
                      <td>
                        {c.purpose}
                        <br />
                        <span className="muted">{c.scope.join(", ")}</span>
                      </td>
                      <td>{nameOf.get(c.ownerUserId) ?? "Former member"}</td>
                      <td>
                        <code>{c.credentialRef}</code>
                        <br />
                        <span className="muted">
                          v{c.credentialVersion}
                          {c.credentialRotatedAt ? `, rotated ${when(c.credentialRotatedAt)}` : ""}
                        </span>
                      </td>
                      <td>
                        <span className={STATUS_CLS[c.status]}>{c.status.toLowerCase()}</span>
                      </td>
                      <td>
                        {test ? <span className={test.cls}>{test.text}</span> : "Not tested on this credential"}
                        {c.lastTestMessage ? <p className="muted">{c.lastTestMessage}</p> : null}
                        <span className="muted">{when(c.lastTestedAt)}</span>
                        {c.status !== "RETIRED" ? (
                          <details>
                            <summary>Actions for {c.name} ({c.environment.toLowerCase()})</summary>
                            <TestConnectorButton connectorId={c.id} />
                            <ConnectorStatusButtons connectorId={c.id} version={c.version} status={c.status} />
                            <RotateCredentialForm connectorId={c.id} version={c.version} />
                          </details>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="new-h">
        <h2 id="new-h">Add a connector</h2>
        <p className="muted">
          Store a credential reference — for example env:SMTP_COMPANY_PROD_TOKEN — never the secret. Each
          practice and each environment needs its own credential; a reference used anywhere else is refused.
        </p>
        <CreateConnectorForm practiceId={practiceId} members={memberList} />
      </section>
    </Screen>
  );
}
