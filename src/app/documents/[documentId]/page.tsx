import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { screenContext } from "@/lib/screen-context";
import { can } from "@/lib/permissions";
import { EmptyState, PermissionState, Screen } from "@/components/states";

export const dynamic = "force-dynamic";

/**
 * Document detail — the destination behind every document row in a list, a
 * search result and a client workspace. Until now those links 404'd.
 *
 * PRD §39's shape for a document: what it is → which version → who prepared and
 * approved it → what has been released to whom. The version history is the
 * point of the screen, because DOC02's guarantee is that a second upload
 * becomes version n+1 and the earlier version is never edited or moved. A
 * screen that showed only "the current file" would hide exactly the property
 * the module exists to provide.
 *
 * Two deliberate refusals:
 *   - A protected working paper needs its own grant (DOC03 / IAM03). Holding
 *     document.read is not enough, and the refusal uses PermissionState, which
 *     cannot name the record — naming it would be the disclosure.
 *   - No download link is offered from here. DOC04 links are
 *     DocumentAccessToken redemptions re-authorised on every use, not URLs a
 *     page can hand out; the release route issues them.
 */
export default async function DocumentDetailPage({
  params,
}: {
  params: Promise<{ documentId: string }>;
}) {
  const scope = await screenContext("document.read");
  const { documentId } = await params;

  if (scope.state === "signed-out") {
    return (
      <Screen title="Document">
        <EmptyState title="Sign in to see this document" />
      </Screen>
    );
  }
  if (scope.state === "no-practice" || scope.state === "denied") {
    return (
      <Screen title="Document">
        <PermissionState />
      </Screen>
    );
  }

  const { ctx, practiceId } = scope;

  const document = await prisma.document.findFirst({
    where: { id: documentId, practiceId, archivedAt: null },
    select: {
      id: true,
      title: true,
      kind: true,
      classification: true,
      workingPaper: true,
      documentType: true,
      periodLabel: true,
      legalHold: true,
      retentionUntil: true,
      lockedAt: true,
      clientRelationship: {
        select: { id: true, party: { select: { legalName: true } } },
      },
      versions: {
        orderBy: { versionNo: "desc" },
        select: {
          id: true,
          versionNo: true,
          status: true,
          scanVerdict: true,
          filename: true,
          mimeType: true,
          sizeBytes: true,
          sha256: true,
          source: true,
          derivation: true,
          approvedByUserName: true,
          approvedAt: true,
          supersededAt: true,
          createdAt: true,
        },
      },
    },
  });

  // Out of practice, archived, or simply not a real id — all one answer, so
  // the response cannot be used to prove the record exists elsewhere.
  if (!document) {
    return (
      <Screen
        title="Document"
        breadcrumbs={[
          { href: "/", label: "Home" },
          { href: "/documents", label: "Documents" },
        ]}
      >
        <PermissionState />
      </Screen>
    );
  }

  if (document.workingPaper && !can(ctx.membership!, "workpaper.protected.read")) {
    return (
      <Screen
        title="Document"
        breadcrumbs={[
          { href: "/", label: "Home" },
          { href: "/documents", label: "Documents" },
        ]}
      >
        <PermissionState />
      </Screen>
    );
  }

  const readable = (value: string) => value.replace(/_/g, " ").toLowerCase();
  const current = document.versions.find((v) => v.supersededAt === null) ?? document.versions[0];

  return (
    <Screen
      title={document.title}
      lede={[document.clientRelationship?.party.legalName, document.periodLabel]
        .filter(Boolean)
        .join(" · ")}
      breadcrumbs={[
        { href: "/", label: "Home" },
        { href: "/documents", label: "Documents" },
        ...(document.clientRelationship
          ? [
              {
                href: `/clients/${document.clientRelationship.id}`,
                label: document.clientRelationship.party.legalName,
              },
            ]
          : []),
      ]}
    >
      <div className="card">
        <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 16px" }}>
          <dt className="secondary">Record class</dt>
          <dd style={{ margin: 0 }}>{readable(document.kind)}</dd>
          <dt className="secondary">Document type</dt>
          <dd style={{ margin: 0 }}>{document.documentType ?? "Not classified"}</dd>
          <dt className="secondary">Sensitivity</dt>
          <dd style={{ margin: 0 }}>{readable(document.classification)}</dd>
          <dt className="secondary">Working paper</dt>
          <dd style={{ margin: 0 }}>
            {document.workingPaper
              ? "Yes — internal, not automatically a client deliverable"
              : "No"}
          </dd>
          <dt className="secondary">Versions</dt>
          <dd style={{ margin: 0 }}>{document.versions.length}</dd>
        </dl>

        {document.legalHold ? (
          <p className="banner banner--warning" style={{ marginTop: 16, marginBottom: 0 }}>
            <span aria-hidden="true">!</span>
            <span>
              This document is under legal hold. It cannot be deleted, and retention rules do not
              apply while the hold stands.
            </span>
          </p>
        ) : null}
        {document.lockedAt ? (
          <p className="muted" style={{ marginBottom: 0 }}>
            Locked into a finalised set on {document.lockedAt.toISOString().slice(0, 10)} — its
            contents are fixed so the set&rsquo;s manifest stays true.
          </p>
        ) : null}
      </div>

      {current ? (
        <>
          <h2>Current version</h2>
          <div className="card">
            <dl
              style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 16px" }}
            >
              <dt className="secondary">Version</dt>
              <dd style={{ margin: 0 }}>{current.versionNo}</dd>
              <dt className="secondary">Status</dt>
              <dd style={{ margin: 0 }}>
                <span
                  className={`status status--${current.status === "APPROVED" ? "ok" : "info"}`}
                >
                  {readable(current.status)}
                </span>
              </dd>
              <dt className="secondary">Scan</dt>
              <dd style={{ margin: 0 }}>
                {/* DOC01 fails closed: anything but CLEAN is stated plainly
                    rather than shown as an absence of a warning. */}
                <span
                  className={`status status--${current.scanVerdict === "CLEAN" ? "ok" : "warn"}`}
                >
                  {readable(current.scanVerdict)}
                </span>
              </dd>
              <dt className="secondary">Approved by</dt>
              <dd style={{ margin: 0 }}>
                {current.approvedByUserName
                  ? `${current.approvedByUserName} on ${current.approvedAt?.toISOString().slice(0, 10)}`
                  : "Not approved"}
              </dd>
              <dt className="secondary">Content hash</dt>
              <dd style={{ margin: 0, fontFamily: "monospace", wordBreak: "break-all" }}>
                {current.sha256}
              </dd>
            </dl>
            <p className="muted" style={{ marginBottom: 0 }}>
              Files are not linked from this page. A recipient reaches a version through a release
              link that is re-authorised each time it is opened, so withdrawing access takes effect
              on the next use rather than whenever a URL happens to expire.
            </p>
          </div>
        </>
      ) : null}

      <h2>Version history</h2>
      {document.versions.length === 0 ? (
        <EmptyState
          title="No versions stored"
          body="This record exists but no file has been accepted against it yet."
        />
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <caption>
              Every version ever accepted. A new upload becomes the next version; earlier versions
              are marked superseded and are never edited or replaced.
            </caption>
            <thead>
              <tr>
                <th scope="col">Version</th>
                <th scope="col">Filename</th>
                <th scope="col">Origin</th>
                <th scope="col">Status</th>
                <th scope="col">Size</th>
                <th scope="col">Added</th>
              </tr>
            </thead>
            <tbody>
              {document.versions.map((v) => (
                <tr key={v.id}>
                  <th scope="row">{v.versionNo}</th>
                  <td>{v.filename || "—"}</td>
                  <td>
                    {readable(v.source)}
                    {v.derivation !== "ORIGINAL" ? (
                      <span className="muted"> · {readable(v.derivation)}</span>
                    ) : null}
                  </td>
                  <td>
                    <span
                      className={`status status--${v.supersededAt ? "info" : v.status === "APPROVED" ? "ok" : "warn"}`}
                    >
                      {v.supersededAt ? "Superseded" : readable(v.status)}
                    </span>
                  </td>
                  <td>{Number(v.sizeBytes).toLocaleString()} bytes</td>
                  <td>{v.createdAt.toISOString().slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ marginTop: 24 }}>
        <Link href="/documents">Back to Documents</Link>
      </p>
    </Screen>
  );
}
